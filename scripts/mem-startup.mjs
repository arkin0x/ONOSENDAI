/**
 * mem-startup.mjs: what a heavy returning player's tab holds after it opens,
 * and what it allocates while it sits there (2026-11-18).
 *
 * arkinox, 2026-11-19, ?diag=1 on Brave/Windows: a 1.6 GB heap 21 s after
 * opening at his spot, about 850 MB left after each major GC, and the heap
 * climbing 13 to 20 MB/s while nothing happens, even with the tab hidden, so
 * the GCs that follow freeze the page for one to two and a half seconds.
 *
 * Opens a COPY of the profile mem-startup-seed.mjs built (so every run starts
 * from the same IndexedDB and localStorage) on the given build, serves the
 * seed's relay.jsonl from an in-process relay (what the page sends is answered
 * and kept in memory, never written back), and aborts every HTTP request to
 * another origin. Then, all to <out>/:
 * - loaded: after LOAD s, the heap collected and measured, workers alive,
 *   localStorage size (and the biggest keys, names cut short), DOM counters;
 * - an allocation sampling profile over IDLE s of standing still (alloc.txt,
 *   by function and the three frames above it), and the heap every 5 s;
 * - idle: the heap collected again after the idle stretch;
 * - menu: the same with the menu open (MENU=1), with its DOM node count;
 * - SNAPSHOT=1: a heap snapshot after the load.
 *
 * Usage: node scripts/mem-startup.mjs <url> <seed dir> <out dir>
 * Env: LOAD (30), IDLE (60), MENU (1), SNAPSHOT (0), W (1440), H (771), DPR (1).
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { matchFilter } from 'nostr-tools'

const [base, seed, out] = process.argv.slice(2)
if (!base || !seed || !out) { console.log('usage: mem-startup.mjs <url> <seed dir> <out dir>'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
const LOAD = Number(process.env.LOAD ?? 30)
const IDLE = Number(process.env.IDLE ?? 60)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const log = (...a) => console.log(String(Math.round((Date.now() - t0) / 1000)).padStart(4), ...a)

const profile = path.join(out, 'profile')
fs.rmSync(profile, { recursive: true, force: true })
execFileSync('cp', ['-a', path.join(seed, 'profile'), profile])
const kept = fs.readFileSync(path.join(seed, 'relay.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

const ctx = await chromium.launchPersistentContext(profile, {
  viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 771) },
  deviceScaleFactor: Number(process.env.DPR ?? 1),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--max-old-space-size=4096'],
})
const shutdown = async (code) => { try { await ctx.close() } catch {} process.exit(code) }
process.on('SIGTERM', () => void shutdown(143))
process.on('SIGINT', () => void shutdown(130))
const stats = { reqs: 0, sent: 0, aborted: 0, published: 0 }
const LOCAL = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/
await ctx.route((u) => !LOCAL.test(u.toString()), (r) => { stats.aborted++; return r.abort() })
await ctx.routeWebSocket(/.*/, (ws) => {
  if (LOCAL.test(ws.url())) { ws.connectToServer(); return }
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') {
      stats.reqs++
      const [, id, ...filters] = m
      for (const f of filters) for (const ev of kept.filter((e) => matchFilter(f, e)).slice(-(f.limit ?? 500))) { stats.sent++; ws.send(JSON.stringify(['EVENT', id, ev])) }
      ws.send(JSON.stringify(['EOSE', id]))
    } else if (m[0] === 'EVENT') { stats.published++; ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }
    else if (m[0] === 'AUTH') ws.send(JSON.stringify(['OK', m[1].id, true, '']))
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
})
const page = ctx.pages()[0] ?? await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)))
await page.addInitScript(() => {
  const w = { made: 0, ended: 0, urls: {} }
  const N = window.Worker
  window.Worker = new Proxy(N, { construct(t, a) { w.made++; const u = String(a[0]).replace(/^.*\/(workers\/)?/, '').replace(/[?-].*$/, ''); w.urls[u] = (w.urls[u] ?? 0) + 1; return Reflect.construct(t, a) } })
  const ended = new WeakSet()
  const term = N.prototype.terminate
  N.prototype.terminate = function () { if (!ended.has(this)) { ended.add(this); w.ended++ } return term.call(this) }
  window.__memWorkers = w
  window.__memLs = () => {
    const rows = []
    let chars = 0
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const n = k.length + (localStorage.getItem(k)?.length ?? 0); chars += n; rows.push([k.replace(/[0-9a-f]{64}/g, '<pk>'), n]) }
    rows.sort((a, b) => b[1] - a[1])
    return { keys: localStorage.length, chars, top: rows.slice(0, 8) }
  }
})
const cdp = await ctx.newCDPSession(page)
await cdp.send('HeapProfiler.enable')
const heapNow = async (collect) => {
  if (collect) for (let i = 0; i < 2; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(300) }
  const h = await cdp.send('Runtime.getHeapUsage')
  return { usedMB: +(h.usedSize / 1048576).toFixed(1), totalMB: +(h.totalSize / 1048576).toFixed(1), backingMB: +(((h.backingStorageSize ?? 0) + (h.embedderHeapUsedSize ?? 0)) / 1048576).toFixed(1) }
}
const sample = async (label) => {
  const heap = await heapNow(true)
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => ({}))
  const page_ = await page.evaluate(() => ({ workers: { ...window.__memWorkers, live: window.__memWorkers.made - window.__memWorkers.ended }, ls: window.__memLs() }))
  const row = { t: Math.round((Date.now() - t0) / 1000), label, ...heap, nodes: dom.nodes, listeners: dom.jsEventListeners, ...page_, relay: { ...stats } }
  fs.appendFileSync(path.join(out, 'samples.jsonl'), JSON.stringify(row) + '\n')
  log(label, `heap ${heap.usedMB} MB (total ${heap.totalMB}, backing ${heap.backingMB})`, `nodes ${dom.nodes}`, `workers ${row.workers.live}/${row.workers.made}`, `ls ${row.ls.keys} keys ${row.ls.chars} chars`)
  return row
}
async function allocProfile(name, seconds) {
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  const ticks = []
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) { await sleep(5000); ticks.push((await heapNow(false)).usedMB) }
  const { profile } = await cdp.send('HeapProfiler.stopSampling')
  const by = new Map(), self = new Map()
  const walk = (n, stack) => {
    const f = n.callFrame
    const here = `${f.functionName || '(anon)'} ${f.url.replace(/^.*?\/(src|node_modules|assets)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`
    const st = [...stack, here]
    if (n.selfSize) {
      const k = st.slice(-4).reverse().join(' < ')
      by.set(k, (by.get(k) ?? 0) + n.selfSize)
      for (const fr of new Set(st)) self.set(fr, (self.get(fr) ?? 0) + n.selfSize)
    }
    for (const c of n.children) walk(c, st)
  }
  walk(profile.head, [])
  const total = [...by.values()].reduce((a, b) => a + b, 0)
  const mb = (v) => (v / 1048576).toFixed(1).padStart(8)
  const lines = [...by].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${mb(v)} MB  ${k}`)
  const incl = [...self].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${mb(v)} MB  ${k}`)
  fs.writeFileSync(path.join(out, `${name}.txt`), `allocated (sampled) ${(total / 1048576).toFixed(1)} MB over ${seconds} s; heap every 5 s: ${ticks.join(' ')}\n\nBY STACK (self, 4 frames)\n${lines.join('\n')}\n\nINCLUSIVE BY FRAME\n${incl.join('\n')}\n`)
  log(name, `allocated ${(total / 1048576).toFixed(1)} MB over ${seconds} s (${(total / 1048576 / seconds).toFixed(1)} MB/s)`)
  return +(total / 1048576 / seconds).toFixed(2)
}
async function snapshot(name) {
  const fd = fs.openSync(path.join(out, `${name}.heapsnapshot`), 'w')
  const on = (p) => fs.writeSync(fd, p.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on)
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', on)
  fs.closeSync(fd)
  log('snapshot', name)
}

await page.goto(base, { waitUntil: 'domcontentloaded' })
// The peak while it loads: sampled each second, never collected.
let peak = 0
for (let i = 0; i < LOAD; i++) { await sleep(1000); peak = Math.max(peak, (await heapNow(false)).usedMB) }
log('peak while loading', peak, 'MB')
const loaded = await sample('loaded')
if (process.env.SNAPSHOT === '1') await snapshot('loaded')
const rate = await allocProfile('alloc-idle', IDLE)
const idle = await sample('idle')
let menu = null, menuRate = null
if (process.env.MENU !== '0') {
  const opened = await page.evaluate(async () => {
    const b = document.querySelector('.hamburger-menu')
    if (!b) return null
    const was = b.getAttribute('aria-expanded')
    b.click()
    return { was, now: b.getAttribute('aria-expanded') }
  })
  await sleep(3000)
  menuRate = await allocProfile('alloc-menu', Math.min(30, IDLE))
  menu = { opened, ...(await sample('menu')) }
}
const summary = { peakWhileLoadingMB: peak, loaded, idle, idleAllocMBps: rate, menu, menuAllocMBps: menuRate, relay: stats, errors: errors.slice(0, 10) }
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1))
log('done')
await shutdown(0)
