/**
 * mem-soak2.mjs: ONOSENDAI's memory as a desktop tab sees it (2026-10-14).
 *
 * arkinox's 10 to 13 GB tabs happen in Windows + Brave desktop TABS and never
 * in the Android PWA. Android freezes a backgrounded app; a desktop tab keeps
 * its timers and sockets running while its frames stop. mem-soak.mjs ran a
 * phone-sized, mostly headless page; this one is the desktop case:
 *
 * - a HEADED Chromium (run it under xvfb-run) at a desktop viewport and a
 *   Windows display scale (DPR=1, 1.25, 1.5);
 * - arkinox's own surroundings, read-only, by spectating him (SPECT=<hex>,
 *   default arkinox), so his shards and avatars are what is drawn;
 * - a background that is really a background: a second tab brought to the
 *   front (BG=1), checked to be hidden and NOT frozen (timers still fire).
 *
 * Scenarios (argv[3]): idle, mouse (continuous pointer movement, hovers,
 * drags, wheel), bg (the background tab), resize (window size and DPR changing
 * every few seconds, as a screenshare can), modal (shard modal and avatar card
 * opened and closed), scale (Q/E repeatedly).
 *
 * Every SAMPLE seconds it writes one JSON line: JS heap, DOM counters,
 * renderer.info, WebGL contexts alive and created, timers and intervals
 * pending, sockets open, rAF calls, and the RSS of each browser process from
 * /proc (renderer, GPU, browser), so memory outside the JS heap shows too.
 *
 * Nothing is published. A throwaway identity, LOCAL before anything; every
 * client frame that is an EVENT or an AUTH bound for a real relay is dropped
 * and counted; non-GET HTTP to anything but localhost is refused.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright xvfb-run -a -s "-screen 0 2560x1440x24" \
 *   node scripts/mem-soak2.mjs <url> <out dir> <scenario> [minutes]
 * Env: DPR (1), W (1920), H (1080), SAMPLE (30), ALLOC=<s> (sampling profile
 * after the first minute), SNAPSHOTS=1, BG=1 (background tab, any scenario).
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const [url, out, scenario, minutes = '15'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const SAMPLE = Number(process.env.SAMPLE ?? 30) * 1000
const DPR = Number(process.env.DPR ?? 1)
const W = Number(process.env.W ?? 1920)
const H = Number(process.env.H ?? 1080)
const SPECT = process.env.SPECT ?? 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const tag = `${scenario}${process.env.BG ? '-bg' : ''}-dpr${DPR}`
const until = Date.now() + Number(minutes) * 60_000

const browser = await chromium.launch({
  headless: false,
  // Playwright turns background throttling off by default; a real desktop
  // tab has it on, which is the case being reproduced.
  ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  args: ['--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc', `--window-size=${W},${H + 120}`],
})
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR })
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

// Counters the page keeps for us: WebGL contexts (created, and still alive
// on a connected canvas), timers and intervals pending, sockets open, rAF
// calls. Installed before any app code runs.
await ctx.addInitScript(() => {
  const c = { glCreated: 0, intervals: 0, timeouts: 0, sockets: 0, socketsCreated: 0, raf: 0 }
  const gl = []
  const getContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const r = getContext.call(this, type, ...rest)
    if (r && /webgl/i.test(String(type)) && !this.__counted) { this.__counted = true; c.glCreated++; gl.push(new WeakRef(this)) }
    return r
  }
  const si = window.setInterval, ci = window.clearInterval, st = window.setTimeout, ct = window.clearTimeout
  const liveIntervals = new Set(), liveTimeouts = new Set()
  window.setInterval = function (...a) { const id = si.apply(this, a); liveIntervals.add(id); return id }
  window.clearInterval = function (id) { liveIntervals.delete(id); return ci.call(this, id) }
  window.setTimeout = function (fn, ...a) {
    let id
    const wrapped = typeof fn === 'function' ? function (...x) { liveTimeouts.delete(id); return fn.apply(this, x) } : fn
    id = st.call(this, wrapped, ...a); liveTimeouts.add(id); return id
  }
  window.clearTimeout = function (id) { liveTimeouts.delete(id); return ct.call(this, id) }
  const raf = window.requestAnimationFrame
  window.requestAnimationFrame = function (cb) { c.raf++; return raf.call(this, cb) }
  const Wk = window.Worker
  c.workersCreated = 0; c.workersTerminated = 0
  window.Worker = new Proxy(Wk, { construct(t, args) { const w = new t(...args); c.workersCreated++; const term = w.terminate.bind(w); w.terminate = () => { c.workersTerminated++; term() }; return w } })
  const WS = window.WebSocket
  window.WebSocket = new Proxy(WS, { construct(t, args) { const s = new t(...args); c.socketsCreated++; c.sockets++; s.addEventListener('close', () => { c.sockets-- }); return s } })
  window.__soak = () => ({
    ...c,
    intervals: liveIntervals.size,
    timeouts: liveTimeouts.size,
    glAlive: gl.filter((w) => { const el = w.deref(); return el && el.isConnected }).length,
    glHeld: gl.filter((w) => w.deref()).length,
    canvases: document.querySelectorAll('canvas').length,
  })
  try { localStorage.setItem('onosendai:live', '0') } catch {}
})

const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(10_000)
const live = await page.evaluate(() => window.__store?.getState().live)
if (live !== false) { console.log('ABORT: not LOCAL', live); await browser.close(); process.exit(2) }
const cdp = await ctx.newCDPSession(page)
await cdp.send('Performance.enable')

// arkinox's surroundings, read-only.
await page.evaluate(async (pk) => { const m = await import('/src/lib/spectator.ts'); await m.spectate(pk) }, SPECT)
await page.waitForTimeout(20_000)
// SHARDS=<objects.jsonl>: a crowd of shards around the spectated head, as
// arkinox's own finds put one around him. Public kind 33331 objects (read
// from the relays beforehand, read-only), each placed COPIES times at random
// offsets within RADIUS gibsons, injected as found items on this page only.
if (process.env.SHARDS) {
  const objs = fs.readFileSync(process.env.SHARDS, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((e) => !e.tags.some((t) => t[0] === 'encrypted'))
  const n = await page.evaluate(async ({ objs, copies, radius }) => {
    const { useShards } = await import('/src/store/useShards.ts')
    const { avatarFromEvent } = await import('/src/lib/avatar.ts')
    const s = window.__store.getState()
    const a = s.anchor
    const items = []
    let k = 0
    for (const ev of objs) {
      const shard = avatarFromEvent({ ...ev, kind: 11333 })
      if (!shard) continue
      for (let c = 0; c < copies; c++) {
        const off = () => BigInt(Math.round((Math.random() * 2 - 1) * radius))
        const id = (k++).toString(16).padStart(64, '0')
        items.push({ eventId: id, bagId: 'soak', lookupId: 'soak', author: ev.pubkey, at: { x: a.x + off(), y: a.y + off(), z: a.z + off() }, plane: s.anchorPlane, height: 6, createdAt: ev.created_at, type: 'shard', shard })
      }
    }
    useShards.getState().addDiscovered(items)
    return items.length
  }, { objs, copies: Number(process.env.COPIES ?? 3), radius: Number(process.env.RADIUS ?? 24) })
  console.log('injected shards', n)
  await page.waitForTimeout(8000)
}
if (process.env.SHOT) await page.screenshot({ path: `${out}/${tag}-start.png` })
console.log('spectating', await page.evaluate(() => window.__store.getState().spectate?.npub ?? null))

// The browser's process tree, by role, from /proc.
// Everything this node process started (Playwright's driver, then the browser).
const rootPid = process.pid
const procTree = () => {
  const all = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))
  const parent = new Map(), cmd = new Map()
  for (const p of all) {
    try {
      const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8')
      parent.set(p, st.slice(st.lastIndexOf(')') + 2).split(' ')[1])
      cmd.set(p, fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' '))
    } catch { /* gone */ }
  }
  const mine = new Set(rootPid ? [String(rootPid)] : [])
  let grew = true
  while (grew) { grew = false; for (const [p, pp] of parent) if (!mine.has(p) && mine.has(pp)) { mine.add(p); grew = true } }
  const rss = { renderer: 0, gpu: 0, other: 0 }
  for (const p of mine) {
    let kb = 0
    try { kb = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p}/status`, 'utf8'))?.[1] ?? 0) } catch { continue }
    const c = cmd.get(p) ?? ''
    const role = /--type=renderer/.test(c) ? 'renderer' : /--type=gpu-process/.test(c) ? 'gpu' : 'other'
    rss[role] += kb * 1024
  }
  return rss
}

let bgPage = null
if (process.env.BG) {
  // Playwright emulates focus and visibility on every page, so a page in a
  // tab behind another still says "visible" and keeps drawing. Turned off
  // here on both pages, a tab in front really hides the one behind it.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  // A new TAB in the same window (window.open from the page), not a new
  // window: Playwright's newPage opens a window, and two windows side by
  // side are both visible.
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.evaluate(() => { window.open('about:blank', '_blank') })])
  bgPage = popup
  const bgCdp = await ctx.newCDPSession(bgPage)
  await bgCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  await bgPage.bringToFront()
  await bgCdp.send('Page.bringToFront').catch(() => {})
  await page.waitForTimeout(3000)
  // Hidden, and not frozen: a timer still fires.
  const check = await page.evaluate(() => new Promise((res) => { const t0 = performance.now(); let raf = false; requestAnimationFrame(() => { raf = true }); setTimeout(() => res({ vis: document.visibilityState, raf, timerMs: Math.round(performance.now() - t0) }), 1000) }))
  console.log('background check', JSON.stringify(check))
}

const sample = async (t) => {
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const app = await page.evaluate(() => {
    const r = window.__gl
    const s = window.__store?.getState?.()
    return {
      gl: r ? { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null, calls: r.info.render.calls } : null,
      soak: window.__soak?.(),
      sceneRenders: window.__sceneRenders ?? null,
      visibility: document.visibilityState,
      spectating: !!s?.spectate,
    }
  })
  const row = { t, used: heap.usedSize, total: heap.totalSize, backing: heap.backingStorageSize, nodes: dom.nodes, listeners: dom.jsEventListeners, docs: dom.documents, jsHeapTotal: metrics.JSHeapTotalSize, rss: procTree(), ...app, dropped: { ...dropped }, passed: { ...passed } }
  fs.appendFileSync(`${out}/${tag}.jsonl`, JSON.stringify(row) + '\n')
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
  fs.writeFileSync(`${out}/${tag}-${name}.heapsnapshot`, chunks.join(''))
}

const allocProfile = async (seconds) => {
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) await act()
  const { profile } = await cdp.send('HeapProfiler.stopSampling')
  const by = new Map()
  let total = 0
  const walk = (node) => {
    const f = node.callFrame
    const label = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`
    total += node.selfSize
    by.set(label, (by.get(label) ?? 0) + node.selfSize)
    for (const c of node.children) walk(c)
  }
  walk(profile.head)
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  console.log(`ALLOC ${tag}: ${Math.round(total / 1e6)} MB in ${seconds} s = ${Math.round(total / seconds * 60 / 1e6)} MB/min`)
  for (const [k, v] of top) console.log(`  ${String(Math.round(v / 1e6 * 10) / 10).padStart(8)} MB  ${k}`)
  fs.writeFileSync(`${out}/${tag}-alloc.json`, JSON.stringify({ seconds, total, top }))
}

let step = 0
const sizes = [[1920, 1080, 1], [1280, 720, 1], [1920, 1080, 1.5], [2560, 1440, 1.25], [1600, 900, 1]]
const act = async () => {
  step++
  if (bgPage) { await page.waitForTimeout(2000); return }
  if (scenario === 'mouse') {
    // Hover sweeps across the canvas, a drag now and then, a wheel turn.
    for (let i = 0; i < 40; i++) {
      const x = W * (0.2 + 0.6 * ((Math.sin((step * 40 + i) / 7) + 1) / 2))
      const y = H * (0.2 + 0.6 * ((Math.cos((step * 40 + i) / 11) + 1) / 2))
      await page.mouse.move(x, y)
      await page.waitForTimeout(25)
    }
    if (step % 5 === 0) { await page.mouse.move(W / 2, H / 2); await page.mouse.down(); await page.mouse.move(W / 2 + 200, H / 2 + 60, { steps: 20 }); await page.mouse.up() }
    if (step % 7 === 0) { await page.mouse.move(W / 2, H / 2); await page.mouse.wheel(0, step % 14 === 0 ? 300 : -300) }
  } else if (scenario === 'resize') {
    const [w, h, d] = sizes[step % sizes.length]
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: d, mobile: false })
    await page.waitForTimeout(3000)
  } else if (scenario === 'modal') {
    await page.evaluate(async (i) => {
      const { useShards } = await import('/src/store/useShards.ts')
      const items = useShards.getState().worldItems().filter((w) => w.type === 'shard')
      if (items.length) useShards.getState().selectSecret(items[i % items.length].key)
    }, step)
    await page.waitForTimeout(1500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  } else if (scenario === 'scale') {
    for (let i = 0; i < 4; i++) { await page.keyboard.press(step % 2 ? 'q' : 'e'); await page.waitForTimeout(300) }
  } else {
    await page.waitForTimeout(3000)
  }
}

const t0 = Date.now()
await snapshot('start')
if (process.env.ALLOC) await allocProfile(Number(process.env.ALLOC))
let next = 0
while (Date.now() < until) {
  if (Date.now() >= next) {
    const r = await sample(Math.round((Date.now() - t0) / 1000))
    console.log(tag, r.t, 'heap', Math.round(r.used / 1e6), '/', Math.round(r.total / 1e6), 'backing', Math.round((r.backing ?? 0) / 1e6), 'MB rss r/g', Math.round(r.rss.renderer / 1e6), Math.round(r.rss.gpu / 1e6), 'MB nodes', r.nodes, 'gl', JSON.stringify(r.gl), 'soak', JSON.stringify(r.soak), 'vis', r.visibility, 'dropped', JSON.stringify(dropped))
    next = Date.now() + SAMPLE
  }
  await act()
}
await snapshot('end')
console.log('done', tag, 'dropped', JSON.stringify(dropped), 'passed', JSON.stringify(passed), 'errors', errors.slice(0, 5))
await browser.close()
