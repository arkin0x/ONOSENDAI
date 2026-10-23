/**
 * walk-enter-probe.mjs: what entering WALK costs among many shards, over raw
 * CDP (2026-10-23).
 *
 * arkinox, 2026-10-23: "I was at 1.9GB and then I went into walk mode, it
 * froze, and then I was suddenly at 6.9GB." This places a folder of SNO
 * payloads (the Maze Kit: rooms with `constrain: all`) in the world around a
 * fresh LOCAL identity, then enters WALK and measures, before and after: the
 * JS heap, three's renderer.info, every WebGL object at the context, and the
 * long tasks (PerformanceObserver 'longtask'), with a CPU profile of the
 * entry. Then it takes STEPS walk steps and measures again.
 *
 * Nothing leaves the machine: LOCAL is set before load, every WebSocket to
 * anything but localhost is refused in the page, every HTTP request to
 * anything but localhost is failed.
 *
 * Usage: DISPLAY=:N node scripts/walk-enter-probe.mjs <dev url> <out dir> <dir of .json payloads>
 * Env: COPIES (1), SPACING (40 gibsons), HEIGHT (8: each placement's region, 2^HEIGHT gibsons),
 * COMPOSITE=1 also places live-linked mazes (MAZES, ROOMS): rooms placing six pieces by
 * address, mazes placing six rooms, every address answered here (primeRef).
 * SNAPSHOTS=1, W, H, DPR, TAG, CHROME.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [url, out, dir] = process.argv.slice(2)
if (!url || !out || !dir) { console.log('usage: walk-enter-probe.mjs <url> <out> <payload dir>'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
const W = Number(process.env.W ?? 1600), H = Number(process.env.H ?? 900), DPR = Number(process.env.DPR ?? 1)
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const tag = `walk${process.env.TAG ? '-' + process.env.TAG : ''}`
const port = 9400 + Math.floor(Math.random() * 400)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'walkprobe-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--js-flags=--expose-gc', `--window-size=${W},${H + 100}`, `--force-device-scale-factor=${DPR}`, 'about:blank',
], { stdio: 'ignore' })
const shutdown = (code) => { try { chrome.kill() } catch {} ; try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} ; process.exit(code) }
process.on('SIGTERM', () => shutdown(143))
await sleep(3000)
const connect = (wsUrl) => {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pend = new Map(), handlers = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id) { const p = pend.get(d.id); pend.delete(d.id); if (p) d.error ? p.rej(new Error(d.error.message)) : p.res(d.result) }
    else (handlers.get(d.method) ?? []).forEach((h) => h(d.params))
  }
  return {
    ready: new Promise((r) => (ws.onopen = r)),
    send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }),
    on: (method, h) => handlers.set(method, [...(handlers.get(method) ?? []), h]),
  }
}
const cdp = connect((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page').webSocketDebuggerUrl)
await cdp.ready
await cdp.send('Network.enable')
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
cdp.on('Fetch.requestPaused', (p) => {
  const local = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)[:/]/.test(p.request.url) || /^(data|blob):/.test(p.request.url)
  if (!local) cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
  else cdp.send('Fetch.continueRequest', { requestId: p.requestId })
})
await cdp.send('Page.enable')
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('onosendai:live', '0') } catch {}
  const WS = window.WebSocket
  window.WebSocket = new Proxy(WS, { construct(t, a) { if (!/^wss?:\\/\\/(localhost|127\\.0\\.0\\.1)[:/]/.test(String(a[0]))) a = ['ws://127.0.0.1:9/refused']; return new t(...a) } })
  const g = { buffers: 0, textures: 0, programs: 0, vaos: 0, draws: 0 }
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
    const wrap = (name, f) => { const o = P.prototype[name]; if (o) P.prototype[name] = function (...a) { f(a); return o.apply(this, a) } }
    wrap('createBuffer', () => g.buffers++); wrap('deleteBuffer', (a) => { if (a[0]) g.buffers-- })
    wrap('createTexture', () => g.textures++); wrap('deleteTexture', (a) => { if (a[0]) g.textures-- })
    wrap('createProgram', () => g.programs++); wrap('deleteProgram', (a) => { if (a[0]) g.programs-- })
    wrap('createVertexArray', () => g.vaos++); wrap('deleteVertexArray', (a) => { if (a[0]) g.vaos-- })
    wrap('shaderSource', (a) => { (window.__shaders ??= []).push({ t: Math.round(performance.now()), src: a[1] }) })
    wrap('linkProgram', () => { (window.__links ??= []).push(Math.round(performance.now())) })
    for (const d of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) wrap(d, () => g.draws++)
  }
  const lt = []
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) }) }).observe({ type: 'longtask', buffered: true }) } catch {}
  window.__probe = () => ({ gl: { ...g }, longtasks: lt.slice() })
})()` })
await cdp.send('Page.navigate', { url })
const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
for (let i = 0; i < 120 && !(await ev('!!window.__store').catch(() => false)); i++) await sleep(1000)
await sleep(5000)
if ((await ev('window.__store?.getState().live')) !== false) { console.log('ABORT: not LOCAL'); shutdown(2) }

// The pieces, around where you stand, in your plane.
const files = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.json')).map((f) => path.join(dir, String(f)))
const payloads = files.map((f) => fs.readFileSync(f, 'utf8'))
const placed = await ev(`(async () => {
  const texts = ${JSON.stringify(payloads)}
  const { useShards } = await import('/src/store/useShards.ts')
  const { shardFromText } = await import('/src/store/useWorkshop.ts')
  const s = window.__store.getState(); const a = s.position
  const items = []; let k = 0
  const copies = ${Number(process.env.COPIES ?? 1)}, spacing = ${Number(process.env.SPACING ?? 40)}
  const n = texts.length * copies, side = Math.ceil(Math.cbrt(n))
  for (let c = 0; c < copies; c++) texts.forEach((t, i) => {
    const shard = shardFromText(t, 'probe-' + i)
    if (!shard) return
    const j = c * texts.length + i
    const gx = j % side, gy = Math.floor(j / side) % side, gz = Math.floor(j / side / side)
    const off = (q) => BigInt(Math.round((q - (side - 1) / 2) * spacing))
    items.push({ eventId: (k++).toString(16).padStart(64, '0'), bagId: 'probe', lookupId: 'probe', author: 'f'.repeat(64), at: { x: a.x + off(gx), y: a.y + off(gy), z: a.z + off(gz) }, plane: s.plane, height: ${Number(process.env.HEIGHT ?? 8)}, createdAt: 1, type: 'shard', shard })
  })
  if (${process.env.COMPOSITE ? 'true' : 'false'}) {
    // Live links, as arkinox builds: rooms that place kit pieces by address,
    // mazes that place rooms; every address answered from here (primeRef).
    const { primeRef } = await import('/src/lib/parts.ts')
    const PUB = 'a'.repeat(64)
    const kit = texts.map((t, i) => { const p = JSON.parse(t); const ref = ['a', '33331:' + PUB + ':kit-' + i]; primeRef(ref, p); return ref })
    const U = 120 * 16
    const room = (r) => ({ v: 2, name: 'room ' + r, unit: 0, extent: 64, mode: 'solid', vertices: [], ticks: [], colors: [], faces: [], refs: [0, 1, 2, 3, 4, 5].map((q) => kit[(r * 6 + q) % kit.length]), parts: [0, 1, 2, 3, 4, 5].map((q) => [q, (q % 3) * U, 0, Math.floor(q / 3) * U, 0, 0, 0, 0]) })
    const rooms = []
    for (let r = 0; r < ${Number(process.env.ROOMS ?? 24)}; r++) { const ref = ['a', '33331:' + PUB + ':room-' + r]; primeRef(ref, room(r)); rooms.push(ref) }
    const maze = (m) => ({ v: 2, name: 'maze ' + m, unit: 0, extent: 64, mode: 'solid', vertices: [], ticks: [], colors: [], faces: [], refs: [0, 1, 2, 3, 4, 5].map((q) => rooms[(m * 6 + q) % rooms.length]), parts: [0, 1, 2, 3, 4, 5].map((q) => [q, (q % 3) * U, Math.floor(q / 3) * U, 0, 0, 0, 0, 0]) })
    for (let m = 0; m < ${Number(process.env.MAZES ?? 12)}; m++) {
      const shard = shardFromText(JSON.stringify(maze(m)), 'maze-' + m)
      const off = BigInt((m - 6) * 120)
      items.push({ eventId: (k++).toString(16).padStart(64, '0'), bagId: 'probe', lookupId: 'probe', author: 'f'.repeat(64), at: { x: a.x + off, y: a.y, z: a.z + 60n }, plane: s.plane, height: 10, createdAt: 1, type: 'shard', shard })
    }
  }
  useShards.getState().addDiscovered(items)
  return { items: items.length, faces: items.reduce((t, x) => t + x.shard.faces.length, 0), side }
})()`)
console.log('placed', JSON.stringify(placed))
await sleep(20_000)

const measure = async (label, gc) => {
  if (gc) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage') }
  const heap = await cdp.send('Runtime.getHeapUsage')
  const p = await ev(`(() => { const r = window.__gl; return { info: r ? { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null } : null, probe: window.__probe(), walking: window.__store.getState().walking } })()`)
  const lts = p.probe.longtasks
  const row = { label, usedMB: Math.round(heap.usedSize / 1e6), totalMB: Math.round(heap.totalSize / 1e6), info: p.info, gl: p.probe.gl, walking: p.walking, longtasks: lts.length, longMs: lts.reduce((t, x) => t + x.ms, 0), longMax: Math.max(0, ...lts.map((x) => x.ms)) }
  console.log(JSON.stringify(row))
  fs.appendFileSync(`${out}/${tag}.jsonl`, JSON.stringify(row) + '\n')
  return row
}
const snapshot = async (name) => {
  if (!process.env.SNAPSHOTS) return
  const chunks = []
  cdp.on('HeapProfiler.addHeapSnapshotChunk', (p) => chunks.push(p.chunk))
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  fs.writeFileSync(`${out}/${tag}-${name}.heapsnapshot`, chunks.join(''))
}

await measure('before', true)
await snapshot('before')
await cdp.send('HeapProfiler.enable')
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
await cdp.send('Profiler.start')
const tEnter = await ev('performance.now()')
const t0 = Date.now()
const entered = await ev(`(async () => { const { useWalk } = await import('/src/store/useWalk.ts'); const t = performance.now(); useWalk.getState().enter(); return { ms: Math.round(performance.now() - t), walking: window.__store.getState().walking } })()`)
console.log('enter() returned', JSON.stringify(entered), 'wall ms', Date.now() - t0)
await measure('just after enter (no GC)', false)
await sleep(4000)
{
  const { profile: hp } = await cdp.send('HeapProfiler.stopSampling')
  const by = new Map(); let total = 0
  const walk = (node, stack) => { const f = node.callFrame; const label = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`; const st = [...stack, label]; total += node.selfSize; if (node.selfSize) { const key = st.slice(-4).join(' < ') ; by.set(key, (by.get(key) ?? 0) + node.selfSize) } for (const c of node.children) walk(c, st) }
  walk(hp.head, [])
  console.log('ALLOC around enter:', Math.round(total / 1e6), 'MB')
  for (const [k, v] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${String(Math.round(v / 1e5) / 10).padStart(7)} MB  ${k.split(' < ').reverse().join(' < ')}`)
}
await sleep(20_000)
const { profile: prof } = await cdp.send('Profiler.stop')
fs.writeFileSync(`${out}/${tag}-enter.cpuprofile`, JSON.stringify(prof))
{
  const self = new Map(); const byId = new Map(prof.nodes.map((n) => [n.id, n]))
  const dt = prof.timeDeltas; const counts = new Map()
  prof.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)))
  for (const [id, us] of counts) { const n = byId.get(id); const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + us) }
  console.log('CPU self time in the 20 s after enter (top 25):')
  for (const [k, us] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(Math.round(us / 1000)).padStart(7)} ms  ${k}`)
}
await measure('20 s after enter (no GC)', false)
await measure('20 s after enter (GC)', true)
await snapshot('after')
// Steps: what each press asks of the walls, timed.
console.log('steps', JSON.stringify(await ev(`(async () => {
  const { stepLimit, wallItems } = await import('/src/store/walkWalls.ts')
  const cs = window.__store.getState()
  const items = wallItems(cs.plane)
  const dirs = [['x', 1], ['x', -1], ['y', 1], ['y', -1], ['z', 1], ['z', -1]]
  const t = performance.now(); let stopped = 0
  for (let q = 0; q < 200; q++) { const [a, d] = dirs[q % 6]; const r = stepLimit(cs.position, a, d, 2000n, items); if (r.by) stopped++ }
  return { calls: 200, msEach: +((performance.now() - t) / 200).toFixed(2), stopped, items: items.length }
})()`)))
// Steps: each press asks the walls.
const steps = Number(process.env.STEPS ?? 20)
const stepped = await ev(`(async () => {
  const { useWalk } = await import('/src/store/useWalk.ts')
  const w = useWalk.getState()
  const names = Object.keys(w).filter((k) => typeof w[k] === 'function')
  return names
})()`)
console.log('walk api', JSON.stringify(stepped))
{
  const sh = await ev('(window.__shaders ?? []).filter((x) => x.t >= ' + tEnter + ')')
  console.log('shaders compiled after enter:', sh.length)
  sh.forEach((x, i) => fs.writeFileSync(`${out}/${tag}-shader-${i}.glsl`, x.src))
  for (const x of sh) console.log('---', x.src.length, 'chars; loops', (x.src.match(/\bfor\s*\(/g) ?? []).length, '; first defines:', x.src.split('\n').filter((l) => /#define|uniform|varying/.test(l)).slice(0, 12).join(' | ').slice(0, 600))
}
console.log('long tasks', JSON.stringify((await ev('window.__probe().longtasks')).filter((x) => x.ms > 200)))
shutdown(0)
