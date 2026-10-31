/**
 * perf-workshop.mjs: the workshop as the owner uses it, phase by phase, over
 * raw CDP in a real headful Chromium (2026-10-31).
 *
 * arkinox, 2026-10-31: "perf in the workshop is awful. locking up only a
 * minute after opening it. this is systemic and needs to be prioritized."
 * This brings Maze Kit pieces in through the workshop's own bulk import
 * (PUBLISH off), opens one on the bench and drives the bench through the
 * things he does: idle, orbit, FACE mode at 1/120 tapping faces, painting
 * and seaming them, a fresh shard built by stamping and filling, and the
 * pointer hovering the grid in STAMP. For every phase it reports:
 *
 * - frames: rAF callbacks, mean and p95/p99/max frame time, frames over 50 ms
 * - long tasks (PerformanceObserver) and the browser's script/task time
 * - React commits and component renders, by component, for both roots (the
 *   DOM and R3F's), through a stand-in for the devtools hook
 * - JS heap used at the end, and bytes allocated (a sampling heap profile
 *   that keeps collected objects) per frame
 * - WebGL: draw calls per frame, buffer uploads, buffers/VAOs held
 * - a CPU profile's top self-time functions
 *
 * Nothing leaves the machine: LOCAL is set before load, every WebSocket to
 * anything but localhost is refused in the page before app code runs, every
 * HTTP request to anything but localhost is failed through the Fetch domain,
 * and an EVENT or AUTH frame seen leaving for a real relay aborts the run.
 *
 * Usage: DISPLAY=:N node scripts/perf-workshop.mjs <dev url> <zip> <piece substring> [out.json]
 * Env: PHASE_S (15 per timed phase), THROTTLE (CPU slowdown, 1), UNCAPPED=1
 * (no vsync, no frame-rate limit: frames as fast as the machine can draw,
 * standing in for a 144 Hz display), W (900), H (600), CHROME=<path>,
 * PHASES (comma list to run a subset).
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [url, zipPath, piece, outPath] = process.argv.slice(2)
if (!url || !zipPath || !piece) { console.log('usage: perf-workshop.mjs <url> <zip> <piece> [out.json]'); process.exit(1) }
const PHASE_S = Number(process.env.PHASE_S ?? 15)
const THROTTLE = Number(process.env.THROTTLE ?? 1)
const W = Number(process.env.W ?? 900)
const H = Number(process.env.H ?? 600)
const ONLY = process.env.PHASES ? new Set(process.env.PHASES.split(',')) : null
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const port = 9400 + Math.floor(Math.random() * 400)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'perfws-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  ...(process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
  `--window-size=${W},${H + 100}`, '--force-device-scale-factor=1', 'about:blank',
], { stdio: 'ignore' })
const shutdown = (code) => {
  const done = () => { try { chrome.kill() } catch {} ; try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} ; process.exit(code) }
  if (process.stdout.writableLength > 0) process.stdout.once('drain', done)
  else setTimeout(done, 50)
}
process.on('SIGTERM', () => shutdown(143))
process.on('SIGINT', () => shutdown(130))
// A loaded machine can take a while to bring the browser up.
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break } catch { await sleep(1000) } }

const connect = (wsUrl) => {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pend = new Map()
  const handlers = new Map()
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
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const cdp = connect((await list()).find((t) => t.type === 'page').webSocketDebuggerUrl)
await cdp.ready

let leaked = 0
await cdp.send('Network.enable')
const socketUrls = new Map()
cdp.on('Network.webSocketCreated', (p) => socketUrls.set(p.requestId, p.url))
cdp.on('Network.webSocketFrameSent', (p) => {
  const u = socketUrls.get(p.requestId) ?? ''
  if (/localhost|127\.0\.0\.1/.test(u)) return
  const d = p.response?.payloadData ?? ''
  if (/^\s*\[\s*"(EVENT|AUTH)"/.test(d)) { leaked++; console.log('ABORT: an', d.slice(2, 7), 'frame reached', u); shutdown(3) }
})
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
  window.WebSocket = new Proxy(WS, { construct(t, a) { const u = String(a[0]); if (!/^wss?:\\/\\/(localhost|127\\.0\\.0\\.1)[:/]/.test(u)) { a = ['ws://127.0.0.1:9/refused'] } return new t(...a) } })
  const g = { buffers: 0, vaos: 0, programs: 0, textures: 0, bufferData: 0, bufferBytes: 0, subData: 0, draws: 0 }
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
    const wrap = (name, f) => { const o = P.prototype[name]; if (o) P.prototype[name] = function (...a) { f(a, this); return o.apply(this, a) } }
    wrap('createBuffer', () => g.buffers++); wrap('deleteBuffer', (a) => { if (a[0]) g.buffers-- })
    wrap('createVertexArray', () => g.vaos++); wrap('deleteVertexArray', (a) => { if (a[0]) g.vaos-- })
    wrap('createProgram', () => g.programs++); wrap('deleteProgram', (a) => { if (a[0]) g.programs-- })
    wrap('createTexture', () => g.textures++); wrap('deleteTexture', (a) => { if (a[0]) g.textures-- })
    wrap('bufferData', (a) => { g.bufferData++; const s = a[1]; g.bufferBytes += typeof s === 'number' ? s : (s?.byteLength ?? 0) })
    wrap('bufferSubData', (a) => { g.subData++; g.bufferBytes += a[2]?.byteLength ?? 0 })
    for (const d of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) wrap(d, () => g.draws++)
  }
  // Frames: every rAF callback's gap, kept for the current phase.
  const frames = []
  let last = 0
  const tick = (t) => { if (last) frames.push(t - last); last = t; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  window.__longtasks = []
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longtasks.push(Math.round(e.duration)) }).observe({ type: 'longtask', buffered: true }) } catch {}
  // React: a stand-in devtools hook. Every commit, on any root (the DOM's and
  // R3F's), walks the committed tree and counts the components that rendered:
  // mounted, or with props or state not the same objects as last time.
  const renders = new Map()
  let commits = 0
  const nameOf = (f) => { const t = f.type; if (!t) return null; if (typeof t === 'string') return null; const inner = t.type || t.render || t; return t.displayName || inner.displayName || inner.name || null }
  // As React DevTools walks a commit: a subtree whose first child is the same
  // fiber as last time bailed out, so it is not looked at, and a component
  // rendered when it mounted or carries the PerformedWork flag. Comparing
  // props with the alternate alone overcounts: an untouched subtree's
  // alternate is simply older.
  const comp = (n) => n.tag === 0 || n.tag === 1 || n.tag === 11 || n.tag === 14 || n.tag === 15
  const count = (n) => { const k = nameOf(n) || '(anon)'; renders.set(k, (renders.get(k) || 0) + 1) }
  const mount = (first) => { const st = [first]; while (st.length) { const n = st.pop(); if (!n) continue; if (comp(n)) count(n); if (n.sibling) st.push(n.sibling); if (n.child) st.push(n.child) } }
  const visit = (first) => {
    const st = [first]
    while (st.length) {
      const n = st.pop()
      if (!n) continue
      if (n.sibling) st.push(n.sibling)
      const a = n.alternate
      if (!a) { if (comp(n)) count(n); if (n.child) mount(n.child); continue }
      if (comp(n) && (n.flags & 1)) count(n)
      if (n.child !== a.child && n.child) st.push(n.child)
    }
  }
  const walk = visit
  let rid = 0
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r) { const id = ++rid; this.renderers.set(id, r); return id },
    checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) { commits++; try { walk(root.current.child) } catch {} },
  }
  window.__perf = {
    reset() { frames.length = 0; renders.clear(); commits = 0; window.__longtasks.length = 0 },
    read() {
      const f = frames.slice().sort((a, b) => a - b)
      const q = (p) => f.length ? Math.round(f[Math.min(f.length - 1, Math.floor(p * f.length))] * 10) / 10 : 0
      const top = [...renders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
      return {
        frames: f.length, meanMs: f.length ? Math.round(f.reduce((s, x) => s + x, 0) / f.length * 10) / 10 : 0, p95: q(0.95), p99: q(0.99), max: q(1),
        over50: f.filter((x) => x > 50).length, longtasks: window.__longtasks.length, longtaskMs: window.__longtasks.reduce((s, x) => s + x, 0),
        longest: window.__longtasks.length ? Math.max(...window.__longtasks) : 0,
        commits, renders: [...renders.values()].reduce((s, x) => s + x, 0), topRenders: top, gl: { ...g },
      }
    },
  }
})()` })
await cdp.send('Performance.enable')
await cdp.send('Page.navigate', { url })
await sleep(6000)
const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
for (let i = 0; i < 90 && !(await ev('!!window.__store').catch(() => false)); i++) await sleep(1000)
await sleep(2000)
if ((await ev('window.__store?.getState().live')) !== false) { console.log('ABORT: not LOCAL'); shutdown(2) }

const zipB64 = fs.readFileSync(zipPath).toString('base64')
const imported = await ev(`(async () => {
  const bin = atob(${JSON.stringify(zipB64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  const file = new File([u], ${JSON.stringify(path.basename(zipPath))}, { type: 'application/zip' })
  const { useWorkshop } = await import('/src/store/useWorkshop.ts')
  const { useShardImport } = await import('/src/store/useShardImport.ts')
  window.__ws = useWorkshop
  useWorkshop.getState().openWorkshop()
  await useShardImport.getState().openZip(file)
  for (let i = 0; i < 100 && useShardImport.getState().phase !== 'review'; i++) await new Promise((r) => setTimeout(r, 200))
  useShardImport.getState().setPublish(false)
  await useShardImport.getState().start()
  for (let i = 0; i < 600 && useShardImport.getState().phase === 'running'; i++) await new Promise((r) => setTimeout(r, 200))
  const want = useWorkshop.getState().shards.find((s) => s.name.includes(${JSON.stringify(piece)}))
  if (want) useWorkshop.getState().openWorkshop(want.id)
  return { shards: useWorkshop.getState().shards.length, open: want ? { name: want.name, vertices: want.vertices.length, faces: want.faces.length } : null }
})()`)
console.log('imported', JSON.stringify(imported))
if (!imported.open) { console.log('ABORT: no piece', piece); shutdown(4) }
{
  const t = Date.now()
  while (Date.now() - t < 120_000 && !(await ev('!!window.__benchScene && window.__perf.read().gl.draws > 0'))) await sleep(1000)
}
await sleep(4000)
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })

const { width, height } = await cdp.send('Page.getLayoutMetrics').then((m) => ({ width: m.cssVisualViewport.clientWidth, height: m.cssVisualViewport.clientHeight }))
// The bench canvas's box, so taps and drags land on it rather than on a panel.
const box = await ev(`(() => { const c = [...document.querySelectorAll('canvas')].filter((c) => c.closest('.workshop')).sort((a, b) => b.width * b.height - a.width * a.height)[0] || document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
const cx = box.x + box.w / 2, cy = box.y + box.h / 2
const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra })
const tap = async (x, y) => { await mouse('mouseMoved', x, y, { buttons: 0 }); await mouse('mousePressed', x, y, { buttons: 1, clickCount: 1 }); await sleep(40); await mouse('mouseReleased', x, y, { buttons: 0, clickCount: 1 }) }

/** Screen points of the faces of the shard on the bench whose centres face the camera, nearest first. */
const facePoints = (n) => ev(`(async () => {
  const ticksOf = (v) => [0, 1, 2].map((a) => v.p[a] * 120 + (v.t ? v.t[a] : 0))
  const toRender = (t) => [t[0] / 120, t[1] / 120, -t[2] / 120]
  const s = window.__ws.getState().current(); const cam = window.__benchCamera
  const V = cam.position.constructor
  const out = []
  s.faces.forEach((f, i) => {
    const p = f.map((k) => toRender(ticksOf(s.vertices[k])))
    const c = new V((p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3)
    const d = c.distanceTo(cam.position)
    c.project(cam)
    if (c.z > 1 || Math.abs(c.x) > 0.8 || Math.abs(c.y) > 0.8) return
    out.push({ i, d, x: ${box.x} + (c.x + 1) / 2 * ${box.w}, y: ${box.y} + (1 - c.y) / 2 * ${box.h} })
  })
  out.sort((a, b) => a.d - b.d)
  // Spread over the visible faces rather than the nearest cluster.
  const step = Math.max(1, Math.floor(out.length / ${'${n}'}))
  return out.filter((_, k) => k % step === 0).slice(0, ${'${n}'})
})()`.replaceAll('${n}', String(n)))

const top = (prof, n = 18) => {
  const by = new Map()
  const total = prof.samples.length
  const idToNode = new Map(prof.nodes.map((x) => [x.id, x]))
  const counts = new Map()
  for (const s of prof.samples) counts.set(s, (counts.get(s) ?? 0) + 1)
  for (const [id, c] of counts) {
    const nd = idToNode.get(id); const f = nd.callFrame
    const k = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\/(\.vite\/deps\/)?/, 'nm/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`
    by.set(k, (by.get(k) ?? 0) + c)
  }
  const ms = (prof.endTime - prof.startTime) / 1000 / total
  return [...by.entries()].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k) || true).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => [k, Math.round(c * ms)])
}

const results = []
const phase = async (name, drive) => {
  if (ONLY && !ONLY.has(name)) return
  await ev('window.__perf.reset()')
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start')
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  const t0 = Date.now()
  await drive()
  const elapsed = (Date.now() - t0) / 1000
  const { profile: heapProf } = await cdp.send('HeapProfiler.stopSampling')
  const { profile: cpu } = await cdp.send('Profiler.stop')
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
  const p = await ev('window.__perf.read()')
  const heap = await cdp.send('Runtime.getHeapUsage')
  const state = await ev(`(() => { const w = window.__ws.getState(); const s = w.current(); return { tool: w.tool, selection: w.selection.length, selectedFace: w.selectedFace, selectedFaces: w.selectedFaces ? w.selectedFaces.length : undefined, vertices: s ? s.vertices.length : 0, faces: s ? s.faces.length : 0, past: w.past.length } })()`)
  if (process.env.SHOTS) { const png = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(process.env.SHOTS, { recursive: true }); fs.writeFileSync(path.join(process.env.SHOTS, `${name}.png`), Buffer.from(png.data, 'base64')) }
  let alloc = 0
  const walk = (node) => { alloc += node.selfSize; for (const c of node.children) walk(c) }
  walk(heapProf.head)
  const row = {
    phase: name, seconds: Math.round(elapsed * 10) / 10,
    fps: Math.round(p.frames / elapsed), meanMs: p.meanMs, p95: p.p95, p99: p.p99, maxMs: p.max, over50: p.over50,
    longtasks: p.longtasks, longtaskMs: p.longtaskMs, longestMs: p.longest,
    scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000), taskMs: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000),
    commits: p.commits, renders: p.renders, allocMB: Math.round(alloc / 1e5) / 10, allocKBperFrame: p.frames ? Math.round(alloc / p.frames / 1024) : 0,
    heapMB: Math.round(heap.usedSize / 1e5) / 10, drawsPerFrame: p.frames ? Math.round(p.gl.draws / p.frames) : 0,
    bufferData: p.gl.bufferData, uploadMB: Math.round(p.gl.bufferBytes / 1e5) / 10, glBuffers: p.gl.buffers, glVAOs: p.gl.vaos,
    state, topRenders: p.topRenders, cpu: top(cpu),
  }
  console.log('PHASE', name, JSON.stringify({ ...row, topRenders: undefined, cpu: undefined }))
  console.log('  renders', JSON.stringify(row.topRenders))
  console.log('  cpu', JSON.stringify(row.cpu.slice(0, 12)))
  results.push(row)
}

const orbitDrive = async (seconds) => {
  await mouse('mouseMoved', cx, cy, { buttons: 0 })
  await mouse('mousePressed', cx, cy, { buttons: 1, clickCount: 1 })
  const r = Math.min(box.w, box.h) * 0.2
  const until = Date.now() + seconds * 1000
  let a = 0
  while (Date.now() < until) { a += 0.1; await mouse('mouseMoved', cx + r * Math.cos(a), cy + r * Math.sin(a) * 0.5, { buttons: 1 }); await sleep(16) }
  await mouse('mouseReleased', cx, cy, { buttons: 0, clickCount: 1 })
}

// 1. Idle on the opened piece, VIEW.
await phase('idle', () => sleep(PHASE_S * 1000))
// 2. Orbit, VIEW.
await phase('orbit', () => orbitDrive(PHASE_S))
// 3. FACE at 1/120: tap faces one after another, with a little orbit between.
await ev(`(() => { const w = window.__ws.getState(); w.setTool('face'); w.setDivision(120) })()`)
await sleep(1500)
await phase('faceTaps', async () => {
  const pts = await facePoints(24)
  for (const q of pts) { await tap(q.x, q.y); await sleep(250) }
  const until = Date.now() + 2000; while (Date.now() < until) await sleep(100)
})
// 4. Paint and seam what is selected, again and again, as the owner does.
await phase('paintSeam', async () => {
  const blue = [20, 0, 255], green = [0, 255, 80]
  const pts = await facePoints(10)
  for (let k = 0; k < pts.length; k++) {
    await tap(pts[k].x, pts[k].y); await sleep(150)
    await ev(`(() => { const w = window.__ws.getState(); w.colorSelected(${JSON.stringify(k % 2 ? blue : green)}); })()`); await sleep(200)
    await ev(`(() => { const w = window.__ws.getState(); if (w.selectedFace !== null) w.colorFace(w.selectedFace, ${JSON.stringify(k % 2 ? green : blue)}); })()`); await sleep(200)
  }
})
// 5. Idle again after all that: does anything keep running?
await phase('idleAfter', () => sleep(PHASE_S * 1000))
// 6. A fresh shard: stamp blocks at 1/120 on the grid, by real taps, and hover between.
await phase('freshStamp', async () => {
  await ev(`(() => { const w = window.__ws.getState(); w.create('perf fresh'); w.setTool('stamp'); w.setDivision(120) })()`)
  await sleep(1500)
  for (let k = 0; k < 14; k++) {
    const x = cx + (k % 5 - 2) * box.w * 0.08, y = cy + (Math.floor(k / 5) - 1) * box.h * 0.1
    for (let m = 0; m < 12; m++) { await mouse('mouseMoved', x + m * 3, y + m, { buttons: 0 }); await sleep(16) }
    await tap(x + 36, y + 12); await sleep(200)
  }
})
// 7. Hover the grid in STAMP for a while: the aim follows the pointer.
await phase('hover', async () => {
  const until = Date.now() + PHASE_S * 1000
  let a = 0
  while (Date.now() < until) { a += 0.05; await mouse('mouseMoved', cx + box.w * 0.25 * Math.cos(a), cy + box.h * 0.2 * Math.sin(a * 1.3), { buttons: 0 }); await sleep(8) }
})
// 8. FACE on the fresh shard: tap its faces, fill and seam.
await phase('freshFace', async () => {
  await ev(`(() => { const w = window.__ws.getState(); w.setTool('face') })()`)
  await sleep(500)
  const pts = await facePoints(16)
  for (const q of pts) { await tap(q.x, q.y); await sleep(150); await ev(`window.__ws.getState().colorSelected([20, 0, 255])`); await sleep(150) }
})

if (outPath) fs.writeFileSync(outPath, JSON.stringify({ imported, throttle: THROTTLE, uncapped: !!process.env.UNCAPPED, results, leaked }, null, 1))
console.log('done leaked', leaked)
shutdown(0)
