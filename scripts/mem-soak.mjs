/**
 * mem-soak.mjs: watch ONOSENDAI's memory over a long session (2026-10-13).
 *
 * arkinox came back to a tab at 13 GB, which then crashed. This drives the
 * dev build (DEV hooks: __store, __gl) through one scenario for a long time
 * and samples, every SAMPLE seconds: the JS heap (Runtime.getHeapUsage,
 * which counts ArrayBuffer backing stores too), DOM nodes and listeners
 * (Memory.getDOMCounters), and three.js renderer.info (geometries, textures,
 * programs). Writes <out>/<scenario>.jsonl, one sample per line.
 *
 * Reads are live, writes never leave: a fresh throwaway identity, LOCAL
 * before anything, and every WebSocket frame from the page that is an EVENT
 * or an AUTH is dropped (and counted) before it reaches a relay. Every
 * non-GET request to anything but localhost is refused.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright \
 *   node scripts/mem-soak.mjs <url> <out dir> <scenario> [minutes]
 * Scenarios: idle, hidden, spectate, spectate-hidden, walk, modal.
 * Env: SAMPLE=<seconds> (default 30), SNAPSHOTS=1 writes heap snapshots at
 * the start and the end, CHAIN=<dir> starts as a long-chain.mjs identity.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const [url, out, scenario, minutes = '25'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const SAMPLE = Number(process.env.SAMPLE ?? 30) * 1000
const until = Date.now() + Number(minutes) * 60_000
const browser = await chromium.launch({ headless: !process.env.HEADED, args: ['--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] })
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } })
await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
const dropped = { EVENT: 0, AUTH: 0 }
const passed = {}
await ctx.routeWebSocket(/.*/, (ws) => {
  if (/localhost|127\.0\.0\.1/.test(ws.url())) { ws.connectToServer(); return }
  const server = ws.connectToServer()
  ws.onMessage((raw) => {
    let m = null
    try { m = JSON.parse(String(raw)) } catch { /* not JSON: pass */ }
    if (Array.isArray(m) && (m[0] === 'EVENT' || m[0] === 'AUTH')) { dropped[m[0]]++; return }
    if (Array.isArray(m)) passed[m[0]] = (passed[m[0]] ?? 0) + 1
    server.send(raw)
  })
})
const page = await ctx.newPage()
// CHAIN=<dir from long-chain.mjs>: start as that throwaway identity, with
// its long LOCAL chain, instead of a fresh one.
const chainDir = process.env.CHAIN
const chainKey = chainDir ? JSON.parse(fs.readFileSync(`${chainDir}/key.json`, 'utf8')) : null
const chainStorage = chainDir ? JSON.parse(fs.readFileSync(`${chainDir}/storage.json`, 'utf8')) : null
await page.addInitScript(([k, st]) => {
  try {
    if (st && !sessionStorage.getItem('restored')) { for (const [a, b] of Object.entries(st)) localStorage.setItem(a, b); sessionStorage.setItem('restored', '1') }
    localStorage.setItem('onosendai:live', '0')
    if (k) localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: k.pubkey, nsec: k.nsec }))
  } catch {}
}, [chainKey, chainStorage])
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(8000)
const live = await page.evaluate(() => window.__store.getState().live)
if (live !== false) { console.log('ABORT: not LOCAL'); await browser.close(); process.exit(2) }
const cdp = await ctx.newCDPSession(page)
await cdp.send('Performance.enable')
if (scenario === 'spectate' || scenario === 'spectate-hidden') {
  // XOR, read-only: his chain and presence are live relay traffic.
  await page.evaluate(async () => { const m = await import('/src/lib/spectator.ts'); await m.spectate('d4e4c079ad8e2f84af0da56f95c161431226934398e78c7a3c244e2547f6f3d4') })
  await page.waitForTimeout(5000)
  console.log('spectating', await page.evaluate(() => window.__store.getState().spectate?.npub ?? null))
}
if (process.env.BGTAB) {
  // A real background tab: a second tab in the same window, in front. Only a
  // headed browser (DISPLAY, HEADED=1) throttles a background tab's timers
  // and stops its frames the way Chrome and Brave do.
  const b = await browser.newBrowserCDPSession()
  const { targetInfo } = await cdp.send('Target.getTargetInfo')
  const { targetId } = await b.send('Target.createTarget', { url: 'about:blank', newWindow: false, background: false, browserContextId: targetInfo.browserContextId })
  await b.send('Target.activateTarget', { targetId })
  await page.waitForTimeout(1500)
  console.log('visibility', await page.evaluate(() => document.visibilityState))
} else if (scenario === 'hidden' || scenario === 'spectate-hidden') {
  // A background tab, as arkinox's was: no frames at all (rAF never fires,
  // as in a hidden tab) and the document says it is hidden. Timers keep
  // running unthrottled here, which only makes timer-driven growth faster.
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(1000)
  console.log('visibility', await page.evaluate(() => document.visibilityState))
}

const sample = async (t) => {
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const gl = await page.evaluate(() => {
    const r = window.__gl
    const s = window.__store?.getState?.()
    return {
      gl: r ? { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null } : null,
      events: s?.events?.length ?? null,
      sceneRenders: window.__sceneRenders ?? null,
      visibility: document.visibilityState,
    }
  })
  const row = { t, passed: { ...passed }, used: heap.usedSize, total: heap.totalSize, embedder: heap.embedderHeapUsedSize, backing: heap.backingStorageSize, nodes: dom.nodes, listeners: dom.jsEventListeners, docs: dom.documents, jsHeapUsed: metrics.JSHeapUsedSize, ...gl, dropped: { ...dropped } }
  fs.appendFileSync(`${out}/${scenario}.jsonl`, JSON.stringify(row) + '\n')
  return row
}

const snapshot = async (name) => {
  if (!process.env.SNAPSHOTS) return
  const chunks = []
  const h = (p) => chunks.push(p.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', h)
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', h)
  fs.writeFileSync(`${out}/${scenario}-${name}.heapsnapshot`, chunks.join(''))
}

const keys = ['w', 'a', 'w', 'd', 'w', 's', 'w', 'r', 'f']
let k = 0
const act = async () => {
  if (scenario === 'walk') {
    for (let i = 0; i < 6; i++) { await page.keyboard.press(keys[k++ % keys.length]); await page.waitForTimeout(400) }
  } else if (scenario === 'modal') {
    await page.evaluate(() => window.__soakModal?.())
    await page.waitForTimeout(1500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  } else {
    await page.waitForTimeout(3000)
  }
}

if (scenario === 'walk') {
  const slot = () => page.locator('.touchops__commit').dispatchEvent('pointerdown')
  await slot(); await page.waitForTimeout(300); await slot(); await page.waitForTimeout(1200)
  console.log('walking', await page.evaluate(() => window.__store.getState().walking))
}

// ALLOC=<seconds>: after the first minute, record every allocation for that
// long, garbage included (V8's sampling heap profiler with collected objects
// kept), and print the total and the functions that allocated most. A tab
// that churns gigabytes shows here even when what it keeps is small.
const allocProfile = async (seconds) => {
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  await page.waitForTimeout(seconds * 1000)
  const { profile } = await cdp.send('HeapProfiler.stopSampling')
  const by = new Map()
  let total = 0
  const walk = (node, stack) => {
    const f = node.callFrame
    const label = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`
    total += node.selfSize
    by.set(label, (by.get(label) ?? 0) + node.selfSize)
    for (const c of node.children) walk(c, stack)
  }
  walk(profile.head, [])
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  const rate = total / seconds
  console.log(`ALLOC ${scenario}: ${Math.round(total / 1e6)} MB in ${seconds} s = ${Math.round(rate * 60 / 1e6)} MB/min`)
  for (const [k, v] of top) console.log(`  ${String(Math.round(v / 1e6 * 10) / 10).padStart(8)} MB  ${k}`)
  fs.writeFileSync(`${out}/${scenario}-alloc.json`, JSON.stringify({ seconds, total, top }))
}

const t0 = Date.now()
await snapshot('start')
if (process.env.ALLOC) { await page.waitForTimeout(60_000); await allocProfile(Number(process.env.ALLOC)) }
let next = 0
while (Date.now() < until) {
  if (Date.now() >= next) {
    const r = await sample(Math.round((Date.now() - t0) / 1000))
    console.log(scenario, r.t, 'used', Math.round(r.used / 1e6), 'MB backing', Math.round((r.backing ?? 0) / 1e6), 'nodes', r.nodes, 'listeners', r.listeners, 'gl', JSON.stringify(r.gl), 'events', r.events, 'sceneRenders', r.sceneRenders, 'dropped', JSON.stringify(dropped), 'passed', JSON.stringify(passed))
    next = Date.now() + SAMPLE
  }
  await act()
}
await snapshot('end')
console.log('done', scenario, 'dropped', JSON.stringify(dropped), 'passed', JSON.stringify(passed), 'errors', errors.slice(0, 5))
await browser.close()
