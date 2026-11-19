/**
 * walk-fps-probe.mjs: fluid WALK's frame times at a heavy spot, with a slow
 * remote signer, on a throttled CPU (2026-11-19).
 *
 * arkinox, 2026-11-19: WALK "unbearable" on his phone since 2026-11-18,
 * where before it was "silky smooth... even when signing with bunker". This
 * opens a COPY of the profile scripts/mem-startup-seed.mjs built (a long
 * chain, its head among about 120 placed shards), serves the seed's
 * relay.jsonl from an in-process relay, aborts every HTTP request to another
 * origin, throttles the CPU (CPU=4), wraps the store's signEvent so every
 * signature comes back SIGN_LAG ms later (a NIP-46 bunker's round trip), and
 * walks for WALK_S seconds in a fixed pattern of held keys. Every animation
 * frame's time is recorded, and the walk's state each second.
 *
 * Needs a build that exposes window.__store and window.__walk (a dev build,
 * or a production build with their DEV guards lifted).
 *
 * Writes <out>/summary.json: frame time p50, p95, p99, max, frames over 50
 * and 100 ms per 10 s, main-thread time per frame (Performance.getMetrics),
 * long tasks, events landed, the most ahead; <out>/frames.json, every frame.
 *
 * Usage: node scripts/walk-fps-probe.mjs <url> <seed dir> <out dir>
 * Env:
 * | Name | Default | What |
 * |---|---|---|
 * | CPU | 4 | Chromium's CPU throttling, for a phone |
 * | SIGN_LAG | 900 | ms each signature takes (+-30%), a bunker's round trip |
 * | RELAY_LAG | 0 | ms before the in-process relay answers anything |
 * | PROOF_MS | 0 | each proof held back this long, with progress posts meanwhile (a slower device); PROOF_BURN=1 spends it on a busy worker |
 * | FLOOR | 0 | 1: a flat floor 300 gibsons square under the spot, so the walk stands on ground |
 * | ECHO | 0 | 1: the relay keeps what it is sent and pushes it to matching subscriptions |
 * | WALK_S, HOLD | 30, 1200 | seconds walked; ms each key pattern is held |
 * | LOAD, GRAVITY, W, H, DPR | 25, 1, 393, 851, 1 | |
 * | PROFILE | 0 | 1: <out>/cpu.txt and walk.cpuprofile, a JS sampling profile of the walk (build unminified for names) |
 * | COMMITS | 0 | 1: React commits and which components rendered, in summary.json |
 *
 * Production builds keep window.__store and window.__walk out; build with
 * their DEV guards lifted (the `if (import.meta.env.DEV && typeof window`
 * lines in the stores) to run this against one.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { matchFilter } from 'nostr-tools'

const [base, seed, out] = process.argv.slice(2)
if (!base || !seed || !out) { console.log('usage: walk-fps-probe.mjs <url> <seed dir> <out dir>'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
const CPU = Number(process.env.CPU ?? 4)
const SIGN_LAG = Number(process.env.SIGN_LAG ?? 900)
const WALK_S = Number(process.env.WALK_S ?? 30)
const LOAD = Number(process.env.LOAD ?? 25)
const RELAY_LAG = Number(process.env.RELAY_LAG ?? 0)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const log = (...a) => console.log(String(Math.round((Date.now() - t0) / 1000)).padStart(4), ...a)

const profile = path.join(out, 'profile')
fs.rmSync(profile, { recursive: true, force: true })
execFileSync('cp', ['-a', path.join(seed, 'profile'), profile])
const kept = fs.readFileSync(path.join(seed, 'relay.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

const ctx = await chromium.launchPersistentContext(profile, {
  viewport: { width: Number(process.env.W ?? 393), height: Number(process.env.H ?? 851) },
  deviceScaleFactor: Number(process.env.DPR ?? 1),
  isMobile: true,
  hasTouch: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=4096'],
})
const shutdown = async (code) => { try { await ctx.close() } catch {} process.exit(code) }
process.on('SIGTERM', () => void shutdown(143))
process.on('SIGINT', () => void shutdown(130))
const stats = { reqs: 0, sent: 0, aborted: 0, published: 0 }
const LOCAL = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/
await ctx.route((u) => !LOCAL.test(u.toString()), (r) => { stats.aborted++; return r.abort() })
// ECHO=1: a relay that keeps what it is sent and pushes it to every open subscription it matches, as a real one does.
const ECHO = process.env.ECHO === '1'
const subs = new Set()
await ctx.routeWebSocket(/.*/, (ws) => {
  if (LOCAL.test(ws.url())) { ws.connectToServer(); return }
  const mine = new Map()
  ws.onMessage(async (raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    // A relay a round trip away.
    if (RELAY_LAG) await sleep(RELAY_LAG)
    if (m[0] === 'REQ') {
      stats.reqs++
      const [, id, ...filters] = m
      for (const f of filters) for (const ev of kept.filter((e) => matchFilter(f, e)).slice(-(f.limit ?? 500))) { stats.sent++; ws.send(JSON.stringify(['EVENT', id, ev])) }
      ws.send(JSON.stringify(['EOSE', id]))
      if (ECHO) { const sub = { ws, id, filters }; mine.set(id, sub); subs.add(sub) }
    } else if (m[0] === 'CLOSE') { const sub = mine.get(m[1]); if (sub) { subs.delete(sub); mine.delete(m[1]) } }
    else if (m[0] === 'EVENT') {
      stats.published++
      ws.send(JSON.stringify(['OK', m[1].id, true, '']))
      if (ECHO && m[1].kind !== 24133) {
        kept.push(m[1])
        for (const sub of subs) if (sub.filters.some((f) => matchFilter(f, m[1]))) { stats.echoed = (stats.echoed ?? 0) + 1; try { sub.ws.send(JSON.stringify(['EVENT', sub.id, m[1]])) } catch {} }
      }
    }
    else if (m[0] === 'AUTH') ws.send(JSON.stringify(['OK', m[1].id, true, '']))
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
  ws.onClose(() => { for (const sub of mine.values()) subs.delete(sub) })
})
const page = ctx.pages()[0] ?? await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)))
const cdp = await ctx.newCDPSession(page)
// A phone's proofs: each proof worker answer held back PROOF_MS, with the
// worker's progress posts (every 60 ms, workers/proof.worker.ts) meanwhile,
// as a proof that takes that long on the device sends them.
await page.addInitScript(([proofMs, burn]) => {
  if (!proofMs) return
  const Native = window.Worker
  const burner = burn ? new Native(URL.createObjectURL(new Blob(['onmessage = (e) => { const end = performance.now() + e.data; let x = 0; while (performance.now() < end) x += Math.sqrt(x + 1); postMessage(x) }'], { type: 'text/javascript' }))) : null
  window.Worker = class extends Native {
    constructor(url, opts) {
      super(url, opts)
      if (!/proof/.test(String(url))) return
      let handler = null
      let chain = Promise.resolve()
      const deliver = (data) => handler?.call(this, new MessageEvent('message', { data }))
      super.onmessage = (event) => {
        const d = event.data
        if (!d || (d.type !== 'done' && d.type !== 'error')) { deliver(d); return }
        chain = chain.then(() => new Promise((resolve) => {
          const t0 = performance.now()
          const ms = proofMs * (0.7 + Math.random() * 0.6)
          const tick = setInterval(() => deliver({ type: 'progress', id: d.id, fraction: Math.min(0.99, (performance.now() - t0) / proofMs), elapsedMs: performance.now() - t0 }), 60)
          const finish = () => { clearInterval(tick); deliver(d); resolve() }
          if (!burn) { setTimeout(finish, ms); return }
          // The proof's CPU, spent on a core of its own as the worker's would be.
          burner.onmessage = finish
          burner.postMessage(ms)
        }))
      }
      Object.defineProperty(this, 'onmessage', { get: () => handler, set: (h) => { handler = h }, configurable: true })
    }
  }
}, [Number(process.env.PROOF_MS ?? 0), process.env.PROOF_BURN === '1'])

// COMMITS=1: a minimal React devtools hook (as scripts/perf-probe.mjs): commits, and which components rendered.
if (process.env.COMMITS === '1') await page.addInitScript(() => {
  const rendered = new Map(); let commits = 0
  const nameOf = (f) => { const t = f.type; if (!t || typeof t === 'string') return null; return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || null }
  const upd = (next, prev) => {
    if (prev && next === prev) return
    if (prev && (next.flags & 1)) { const n = nameOf(next); if (n) rendered.set(n, (rendered.get(n) || 0) + 1) }
    if (prev && next.child === prev.child) return
    let c = next.child
    while (c) { upd(c, c.alternate); c = c.sibling }
  }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1 }, onScheduleFiberRoot() {}, onCommitFiberRoot(_id, root) { commits++; try { upd(root.current, root.current.alternate) } catch {} }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} }
  window.__react = () => { const o = { commits, rendered: Object.fromEntries([...rendered.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) }; commits = 0; rendered.clear(); return o }
})

await page.goto(base, { waitUntil: 'domcontentloaded' })
await sleep(LOAD * 1000)
const st = await page.evaluate(() => ({ store: !!window.__store, walk: !!window.__walk, events: window.__store?.getState().events.length, live: window.__store?.getState().live }))
log('loaded', JSON.stringify(st))
// #813's SET A PASSWORD over a key the seed kept in the clear: the key is loaded either way, so the gate is put away unanswered.
await page.evaluate(() => { if (window.__store.getState().keyLock?.mode === 'set') window.__store.setState({ keyLock: null }) })
await sleep(500)
if (!st.store || !st.walk) { log('ABORT: no window.__store / __walk in this build'); await shutdown(2) }

// A bunker: each signature SIGN_LAG ms (+-30%) later, several out at once as a relay round trip allows.
await page.evaluate((lag) => {
  const S = window.__store
  const sign = S.getState().signEvent
  window.__signs = { asked: 0, done: 0 }
  S.setState({ signEvent: async (t) => { window.__signs.asked++; await new Promise((r) => setTimeout(r, lag * (0.7 + Math.random() * 0.6))); const e = await sign(t); window.__signs.done++; return e } })
}, SIGN_LAG)

// FLOOR=1: a wide flat floor (300 gibsons square) a gibson under the spot, as the owner walks on a landscape's ground, so the walk stands rather than hovering.
if (process.env.FLOOR === '1') {
  await page.evaluate(() => {
    const S = window.__store.getState()
    const shards = window.__shards
    const vertices = []
    const faces = []
    const lo = [-150, -1, -150], hi = [150, 0, 150]
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) vertices.push({ p: [x, y, z], c: [0.1, 0.3, 0.12] })
    for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) faces.push([a, b, c], [a, c, d])
    const shard = { id: 'floor-probe', name: 'Floor', unit: 0, extent: 8, mode: 'solid', vertices, faces, up: false, spin: 0, updatedAt: Date.now(), extra: { constrain: 'all' } }
    const item = { key: 'floor-probe', type: 'shard', at: { x: S.position.x, y: S.position.y - 1n, z: S.position.z }, plane: S.plane, height: 84, mine: false, shard }
    const orig = shards.getState().worldItems
    shards.setState({ worldItems: () => [item, ...orig()] })
  })
  await sleep(1000)
}
const gravity = process.env.GRAVITY !== '0'
await page.evaluate((g) => { window.__walk.getState().setGravity(g); window.__walk.getState().enter() }, gravity)
await sleep(2500)
if (!(await page.evaluate(() => window.__store.getState().walking))) { log('ABORT: not in WALK'); await shutdown(2) }
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
await sleep(1500)

// Frame times, long tasks and the walk's state each second, recorded in the page.
await page.evaluate(() => {
  const f = []
  const lt = []
  const states = []
  window.__fps = { f, lt, states, on: true }
  let last = performance.now()
  const tick = (t) => { f.push(t - last); last = t; if (window.__fps.on) requestAnimationFrame(tick) }
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick) })
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(e.duration) }).observe({ type: 'longtask', buffered: false }) } catch {}
  const S = window.__store, W = window.__walk
  const sample = () => {
    if (!window.__fps.on) return
    const w = W.getState()
    states.push({ events: S.getState().events.length, behind: w.behind, queue: w.queue.length, walking: S.getState().walking, warn: !!document.querySelector('.syncwarn.is-on'), signs: { ...window.__signs }, at: ['x', 'y', 'z'].map((a) => String(S.getState().position[a] % 100000n)).join(','), open: !!w.open, falling: w.falling })
    setTimeout(sample, 1000)
  }
  sample()
})
await cdp.send('Performance.enable')
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
const m0 = await metrics()
if (process.env.COMMITS === '1') await page.evaluate(() => window.__react?.())
if (process.env.PROFILE === '1') { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start') }

// The walk: held keys in turn, straight runs and turns, as a player explores.
const PATTERN = [['w'], ['w', 'd'], ['d'], ['w'], ['w', 'a'], ['a'], ['s'], ['s', 'd'], ['w']]
const end = Date.now() + WALK_S * 1000
let k = 0
while (Date.now() < end) {
  const keys = PATTERN[k++ % PATTERN.length]
  for (const key of keys) await page.keyboard.down(key)
  await sleep(Math.min(Number(process.env.HOLD ?? 1200), end - Date.now()))
  for (const key of keys) await page.keyboard.up(key)
  if (!(await page.evaluate(() => window.__store.getState().walking))) { await page.evaluate(() => window.__walk.getState().enter()); log('re-entered WALK') }
  await sleep(150)
}
let cpu = null
if (process.env.PROFILE === '1') cpu = (await cdp.send('Profiler.stop')).profile
const m1 = await metrics()
const react = process.env.COMMITS === '1' ? await page.evaluate(() => window.__react?.()) : null
const rec = await page.evaluate(() => { window.__fps.on = false; return { f: window.__fps.f, lt: window.__fps.lt, states: window.__fps.states } })
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

const f = rec.f.filter((x) => x > 0).sort((a, b) => a - b)
const q = (p) => +(f[Math.min(f.length - 1, Math.floor(p * f.length))] ?? NaN).toFixed(1)
const seconds = rec.f.reduce((a, b) => a + b, 0) / 1000
const per10 = (ms) => +(rec.f.filter((x) => x > ms).length / seconds * 10).toFixed(1)
const ev = rec.states.map((s) => s.events)
const summary = {
  build: base, cpu: CPU, signLag: SIGN_LAG, walkS: WALK_S, gravity,
  frames: rec.f.length, seconds: +seconds.toFixed(1), fps: +(rec.f.length / seconds).toFixed(1),
  p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +(f[f.length - 1] ?? 0).toFixed(1),
  over50per10s: per10(50), over100per10s: per10(100),
  longTasks: rec.lt.length, longTaskMs: Math.round(rec.lt.reduce((a, b) => a + b, 0)),
  mainMsPerFrame: Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map((k) => [k, +((m1[k] - m0[k]) * 1000 / rec.f.length).toFixed(2)])),
  mainBusyPct: +((m1.TaskDuration - m0.TaskDuration) / seconds * 100).toFixed(1),
  layouts: m1.LayoutCount - m0.LayoutCount, styleRecalcs: m1.RecalcStyleCount - m0.RecalcStyleCount,
  landed: ev.length ? ev[ev.length - 1] - ev[0] : 0, mostBehind: Math.max(0, ...rec.states.map((s) => s.behind)),
  warnSeen: rec.states.some((s) => s.warn), signs: rec.states.at(-1)?.signs,
  relay: stats, errors: errors.slice(0, 10), react,
}
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1))
fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify(rec))
log('summary', JSON.stringify(summary))

if (cpu) {
  fs.writeFileSync(path.join(out, 'walk.cpuprofile'), JSON.stringify(cpu))
  const byId = new Map(cpu.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of cpu.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const dt = new Map()
  for (let i = 0; i < cpu.samples.length; i++) dt.set(cpu.samples[i], (dt.get(cpu.samples[i]) ?? 0) + (cpu.timeDeltas[i] ?? 0))
  const name = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.replace(/^.*\/assets\//, '').replace(/\?.*$/, '')}:${n.callFrame.lineNumber + 1}`
  const self = new Map(), total = new Map()
  for (const [id, us] of dt) {
    const n = byId.get(id)
    self.set(name(n), (self.get(name(n)) ?? 0) + us)
    const seen = new Set()
    for (let at = id; at !== undefined; at = parent.get(at)) { const k2 = name(byId.get(at)); if (!seen.has(k2)) { seen.add(k2); total.set(k2, (total.get(k2) ?? 0) + us) } }
  }
  const all = [...dt.values()].reduce((a, b) => a + b, 0)
  const fmt = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k2, v]) => `${(v / 1000).toFixed(0).padStart(7)} ms ${(100 * v / all).toFixed(1).padStart(5)}%  ${k2}`).join('\n')
  fs.writeFileSync(path.join(out, 'cpu.txt'), `sampled ${(all / 1000).toFixed(0)} ms\n\nSELF\n${fmt(self)}\n\nTOTAL\n${fmt(total)}\n`)
  log('profile written')
}
await shutdown(0)
