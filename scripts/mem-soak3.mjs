/**
 * mem-soak3.mjs: ONOSENDAI's memory in a real desktop background tab, over
 * raw CDP (2026-10-14).
 *
 * Why not Playwright: Playwright emulates focus and visibility on every page
 * it drives, on its own session, so a tab behind another still says
 * "visible", keeps its animation frames and is never throttled. arkinox's
 * 10 GB tabs are Windows + Brave desktop tabs, which keep timers and sockets
 * running with frames stopped (Android freezes a backgrounded app outright,
 * and never leaks). This script launches Chromium itself and speaks CDP, so a
 * second tab activated in front really hides the first: visibilityState
 * "hidden", no frames, timers throttled the way a desktop browser does.
 *
 * Nothing is published, by two independent guards:
 * - in the page, before any app code: WebSocket.prototype.send drops every
 *   frame that is an EVENT or an AUTH bound for anything but localhost, and
 *   counts it;
 * - outside the page: Network.webSocketFrameSent is watched, and the run
 *   aborts at once if an EVENT or AUTH frame ever reached a real relay.
 * Plus a fresh profile and identity, LOCAL set before load, and non-GET HTTP
 * to anything but localhost failed through the Fetch domain.
 *
 * Usage: DISPLAY=:97 node scripts/mem-soak3.mjs <url> <out dir> <scenario> [minutes]
 * Scenarios: idle, mouse, resize, modal, scale, walk. BG=1 puts the tab in the
 * background after setup (any scenario; the action then stops).
 * Env: DPR (1), W (1920), H (1080), SAMPLE (30), SHARDS=<objects.jsonl>,
 * COPIES (3), RADIUS (24), SPECT=<hex> (arkinox), ALLOC=<s>, SNAPSHOTS=1,
 * CHROME=<path>.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [url, out, scenario, minutes = '15'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const SAMPLE = Number(process.env.SAMPLE ?? 30) * 1000
const DPR = Number(process.env.DPR ?? 1)
const W = Number(process.env.W ?? 1920)
const H = Number(process.env.H ?? 1080)
const SPECT = process.env.SPECT ?? 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const tag = `${scenario}${process.env.BG ? '-bg' : ''}-dpr${DPR}${process.env.TAG ? '-' + process.env.TAG : ''}`
const until = Date.now() + Number(minutes) * 60_000
const port = 9400 + Math.floor(Math.random() * 400)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soak3-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--js-flags=--expose-gc', `--window-size=${W},${H + 100}`, `--force-device-scale-factor=${DPR}`, 'about:blank',
], { stdio: 'ignore' })
const shutdown = (code) => { try { chrome.kill() } catch {} ; try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} ; process.exit(code) }
process.on('SIGTERM', () => shutdown(143))
await sleep(3000)

// One CDP connection per target.
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
    close: () => ws.close(),
  }
}
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const pageTarget = (await list()).find((t) => t.type === 'page')
const cdp = connect(pageTarget.webSocketDebuggerUrl)
await cdp.ready

// Guard 2: watch what actually leaves.
let leaked = 0
await cdp.send('Network.enable')
cdp.on('Network.webSocketCreated', () => {})
const socketUrls = new Map()
cdp.on('Network.webSocketCreated', (p) => socketUrls.set(p.requestId, p.url))
cdp.on('Network.webSocketFrameSent', (p) => {
  const u = socketUrls.get(p.requestId) ?? ''
  if (/localhost|127\.0\.0\.1/.test(u)) return
  const d = p.response?.payloadData ?? ''
  if (/^\s*\[\s*"(EVENT|AUTH)"/.test(d)) { leaked++; console.log('ABORT: an', d.slice(2, 7), 'frame reached', u); shutdown(3) }
})
// Non-GET HTTP to anything but localhost: failed.
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
cdp.on('Fetch.requestPaused', (p) => {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(p.request.url)
  if (!local && p.request.method !== 'GET') cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
  else cdp.send('Fetch.continueRequest', { requestId: p.requestId })
})

// Guard 1 and the counters, before any app code.
await cdp.send('Page.enable')
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('onosendai:live', '0') } catch {}
  const c = { glCreated: 0, sockets: 0, socketsCreated: 0, raf: 0, dropped: 0, workersCreated: 0, workersTerminated: 0 }
  const send = WebSocket.prototype.send
  WebSocket.prototype.send = function (d) {
    if (typeof d === 'string' && !/localhost|127\\.0\\.0\\.1/.test(this.url) && /^\\s*\\[\\s*"(EVENT|AUTH)"/.test(d)) { c.dropped++; return }
    return send.call(this, d)
  }
  const WS = window.WebSocket
  window.WebSocket = new Proxy(WS, { construct(t, a) { const s = new t(...a); c.socketsCreated++; c.sockets++; s.addEventListener('close', () => { c.sockets-- }); return s } })
  const gl = []
  const gc = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...r) { const x = gc.call(this, type, ...r); if (x && /webgl/i.test(String(type)) && !this.__counted) { this.__counted = true; c.glCreated++; gl.push(new WeakRef(this)) } return x }
  const si = setInterval, ci = clearInterval, st = setTimeout, ct = clearTimeout
  const li = new Set(), lt = new Set()
  window.setInterval = function (...a) { const id = si.apply(this, a); li.add(id); return id }
  window.clearInterval = function (id) { li.delete(id); return ci.call(this, id) }
  window.setTimeout = function (fn, ...a) { let id; const w = typeof fn === 'function' ? function (...x) { lt.delete(id); return fn.apply(this, x) } : fn; id = st.call(this, w, ...a); lt.add(id); return id }
  window.clearTimeout = function (id) { lt.delete(id); return ct.call(this, id) }
  const raf = window.requestAnimationFrame
  window.requestAnimationFrame = function (cb) { c.raf++; return raf.call(this, cb) }
  const Wk = window.Worker
  window.Worker = new Proxy(Wk, { construct(t, a) { const w = new t(...a); c.workersCreated++; const term = w.terminate.bind(w); w.terminate = () => { c.workersTerminated++; term() }; return w } })
  window.__soak = () => ({ ...c, intervals: li.size, timeouts: lt.size, glAlive: gl.filter((w) => { const e = w.deref(); return e && e.isConnected }).length, glHeld: gl.filter((w) => w.deref()).length, canvases: document.querySelectorAll('canvas').length })
})()` })
await cdp.send('Performance.enable')
await cdp.send('Page.navigate', { url })
await sleep(12_000)
const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
if ((await ev('window.__store?.getState().live')) !== false) { console.log('ABORT: not LOCAL'); shutdown(2) }

// arkinox's surroundings, read-only.
await ev(`(async () => { const m = await import('/src/lib/spectator.ts'); await m.spectate(${JSON.stringify(SPECT)}) })()`)
await sleep(15_000)
if (process.env.SHARDS) {
  const objs = fs.readFileSync(process.env.SHARDS, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((e) => !e.tags.some((t) => t[0] === 'encrypted'))
  fs.writeFileSync(`${profile}-objs.json`, JSON.stringify(objs))
  const n = await ev(`(async () => {
    const objs = ${JSON.stringify(objs)}
    const { useShards } = await import('/src/store/useShards.ts')
    const { avatarFromEvent } = await import('/src/lib/avatar.ts')
    const s = window.__store.getState(); const a = s.anchor
    const items = []; let k = 0
    for (const ev of objs) {
      const shard = avatarFromEvent({ ...ev, kind: 11333 })
      if (!shard) continue
      for (let c = 0; c < ${Number(process.env.COPIES ?? 3)}; c++) {
        const off = () => BigInt(Math.round((Math.random() * 2 - 1) * ${Number(process.env.RADIUS ?? 24)}))
        items.push({ eventId: (k++).toString(16).padStart(64, '0'), bagId: 'soak', lookupId: 'soak', author: ev.pubkey, at: { x: a.x + off(), y: a.y + off(), z: a.z + off() }, plane: s.anchorPlane, height: 6, createdAt: ev.created_at, type: 'shard', shard })
      }
    }
    useShards.getState().addDiscovered(items)
    return items.length
  })()`)
  console.log('injected shards', n)
  await sleep(8000)
}
if (process.env.TALK) {
  // The TALK modal on a throwaway agent (no inbox: the panel's own work only).
  await ev(`(async () => { const m = await import('/src/store/useAgents.ts').catch(() => null); return !!m })()`).catch(() => {})
}

// The browser's processes by role, from /proc.
const procTree = () => {
  const parent = new Map(), cmd = new Map()
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8')
      parent.set(p, st.slice(st.lastIndexOf(')') + 2).split(' ')[1])
      cmd.set(p, fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' '))
    } catch { /* gone */ }
  }
  const mine = new Set([String(chrome.pid)])
  let grew = true
  while (grew) { grew = false; for (const [p, pp] of parent) if (!mine.has(p) && mine.has(pp)) { mine.add(p); grew = true } }
  const rss = { renderer: 0, gpu: 0, other: 0 }
  for (const p of mine) {
    let kb = 0
    try { kb = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p}/status`, 'utf8'))?.[1] ?? 0) } catch { continue }
    const c = cmd.get(p) ?? ''
    rss[/--type=renderer/.test(c) && !/--extension-process/.test(c) ? 'renderer' : /--type=gpu-process/.test(c) ? 'gpu' : 'other'] += kb * 1024
  }
  return rss
}

if (process.env.BG) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  await fetch(`http://127.0.0.1:${port}/json/activate/${t.id}`)
  await sleep(2000)
  console.log('background check', await ev(`new Promise((r) => { const t0 = performance.now(); let f = false; requestAnimationFrame(() => { f = true }); setTimeout(() => r(JSON.stringify({ vis: document.visibilityState, raf: f, timerMs: Math.round(performance.now() - t0) })), 1000) })`))
}

const sample = async (t) => {
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const app = await ev(`(() => { const r = window.__gl; const s = window.__store?.getState?.(); return { gl: r ? { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null, frame: r.info.render.frame } : null, soak: window.__soak?.(), sceneRenders: window.__sceneRenders ?? null, visibility: document.visibilityState, discovered: Object.keys((window.__shardsStore?.getState?.() ?? {}).discovered ?? {}).length } })()`)
  const row = { t, used: heap.usedSize, total: heap.totalSize, backing: heap.backingStorageSize, nodes: dom.nodes, listeners: dom.jsEventListeners, jsHeapTotal: metrics.JSHeapTotalSize, rss: procTree(), ...app, leaked }
  fs.appendFileSync(`${out}/${tag}.jsonl`, JSON.stringify(row) + '\n')
  return row
}

const allocProfile = async (seconds) => {
  await cdp.send('HeapProfiler.enable')
  const f0 = await ev('window.__gl?.info.render.frame ?? 0')
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) await act()
  const { profile: prof } = await cdp.send('HeapProfiler.stopSampling')
  const frames = (await ev('window.__gl?.info.render.frame ?? 0')) - f0
  const by = new Map(); let total = 0
  const walk = (node) => { const f = node.callFrame; const label = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`; total += node.selfSize; by.set(label, (by.get(label) ?? 0) + node.selfSize); for (const c of node.children) walk(c) }
  walk(prof.head)
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
  console.log(`ALLOC ${tag}: ${Math.round(total / 1e6)} MB in ${seconds} s = ${Math.round(total / seconds * 60 / 1e6)} MB/min over ${frames} frames = ${frames ? Math.round(total / frames / 1024) : '?'} KB/frame (at 144 fps: ${frames ? Math.round(total / frames * 144 * 60 / 1e6) : '?'} MB/min)`)
  for (const [k, v] of top) console.log(`  ${String(Math.round(v / 1e6 * 10) / 10).padStart(8)} MB  ${k}`)
  fs.writeFileSync(`${out}/${tag}-alloc.json`, JSON.stringify({ seconds, total, frames, top }))
}

const snapshot = async (name) => {
  if (!process.env.SNAPSHOTS) return
  const chunks = []
  cdp.on('HeapProfiler.addHeapSnapshotChunk', (p) => chunks.push(p.chunk))
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  fs.writeFileSync(`${out}/${tag}-${name}.heapsnapshot`, chunks.join(''))
}

const mouse = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, ...extra })
let step = 0
const sizes = [[1920, 1080, 1], [1280, 720, 1], [1920, 1080, 1.5], [2560, 1440, 1.25], [1600, 900, 1]]
const act = async () => {
  step++
  if (process.env.BG) { await sleep(2000); return }
  if (scenario === 'mouse') {
    for (let i = 0; i < 40; i++) {
      await mouse('mouseMoved', W * (0.2 + 0.6 * ((Math.sin((step * 40 + i) / 7) + 1) / 2)), H * (0.2 + 0.6 * ((Math.cos((step * 40 + i) / 11) + 1) / 2)))
      await sleep(25)
    }
    if (step % 5 === 0) { await mouse('mousePressed', W / 2, H / 2, { button: 'left', clickCount: 1 }); for (let i = 1; i <= 20; i++) { await mouse('mouseMoved', W / 2 + i * 10, H / 2 + i * 3, { button: 'left', buttons: 1 }); await sleep(16) } await mouse('mouseReleased', W / 2 + 200, H / 2 + 60, { button: 'left', clickCount: 1 }) }
    if (step % 7 === 0) await mouse('mouseWheel', W / 2, H / 2, { deltaX: 0, deltaY: step % 14 === 0 ? 300 : -300 })
  } else if (scenario === 'resize') {
    const [w, h, d] = sizes[step % sizes.length]
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: d, mobile: false })
    await sleep(3000)
  } else if (scenario === 'modal') {
    await ev(`(async () => { const { useShards } = await import('/src/store/useShards.ts'); const items = useShards.getState().worldItems().filter((w) => w.type === 'shard'); if (items.length) useShards.getState().selectSecret(items[${step} % items.length].key) })()`)
    await sleep(1500)
    await ev(`(async () => { const { useShards } = await import('/src/store/useShards.ts'); useShards.getState().selectSecret(null) })()`)
    await sleep(500)
  } else if (scenario === 'scale') {
    for (let i = 0; i < 4; i++) { await ev(`window.__store.getState().adjustScale(${step % 2 ? 1 : -1})`); await sleep(300) }
  } else {
    await sleep(3000)
  }
}

if (process.env.PROBE) {
  // Which materials change every frame: their version (bumped by
  // needsUpdate), and which objects swap material or geometry.
  const probe = `(() => { const sc = window.__scene; const out = []; sc.traverse((o) => { const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of ms) out.push([o.type + ':' + (o.name || '') + ':' + m.type + ':' + (m.name || ''), m.uuid, m.version, o.geometry?.uuid ?? '']) }); return out })()`
  const a = await ev(probe)
  await sleep(3000)
  const b = await ev(probe)
  const f = await ev('window.__gl.info.render.frame')
  const va = new Map(a.map((x) => [x[1], x]))
  const bumped = new Map()
  for (const x of b) { const y = va.get(x[1]); if (y && x[2] !== y[2]) bumped.set(x[0], (bumped.get(x[0]) ?? 0) + 1) }
  const matsA = new Set(a.map((x) => x[1])), matsB = new Set(b.map((x) => x[1]))
  const newMats = new Map(); for (const x of b) if (!matsA.has(x[1])) newMats.set(x[0], (newMats.get(x[0]) ?? 0) + 1)
  console.log('PROBE objects', a.length, b.length, 'frames now', f)
  console.log('PROBE version bumped:', JSON.stringify([...bumped.entries()].slice(0, 30)))
  console.log('PROBE new materials:', JSON.stringify([...newMats.entries()].slice(0, 30)))
  const types = new Map(); for (const x of b) types.set(x[0], (types.get(x[0]) ?? 0) + 1)
  const stack = await ev(`new Promise((res) => {
    let m = null
    window.__scene.traverse((o) => { if (!m && o.name === 'shard-faces') m = o.material })
    if (!m) return res('no shard-faces')
    const proto = Object.getPrototypeOf(m)
    const trap = (prop) => {
      let d = proto; let desc
      while (d && !(desc = Object.getOwnPropertyDescriptor(d, prop))) d = Object.getPrototypeOf(d)
      Object.defineProperty(m, prop, { configurable: true, get() { return desc.get ? desc.get.call(this) : undefined }, set(v) { const before = this.version; desc.set.call(this, v); if (this.version !== before) res(prop + ' = ' + v + ' AT ' + new Error().stack.split(String.fromCharCode(10)).slice(1, 12).join(' <- ')) } })
    }
    trap('needsUpdate'); trap('alphaTest')
    setTimeout(() => res('no bump in 5 s, version ' + m.version), 5000)
  })`)
  console.log('PROBE stack:', stack)
  console.log('PROBE kinds:', JSON.stringify([...types.entries()].sort((p, q) => q[1] - p[1]).slice(0, 25)))
}
if (process.env.TAPCHECK) {
  // A real click on a shard's tap target opens its modal: targets are
  // raycast while not drawn (visible = false).
  const where = await ev(`(() => {
    const sc = window.__scene, cam = window.__camera, gl = window.__gl
    const out = []
    sc.traverse((o) => { if (o.isMesh && o.visible === false && o.geometry?.type === 'BoxGeometry' && o.raycast?.name !== 'noRaycast' && o.raycast !== undefined) out.push(o) })
    const live = out.filter((o) => String(o.raycast).length > 30)
    const v = new o0()
    function o0() { return { x: 0, y: 0, z: 0 } }
    for (const o of live) {
      const p = o.getWorldPosition(o.position.clone()).project(cam)
      if (Math.abs(p.x) < 0.8 && Math.abs(p.y) < 0.8 && p.z < 1) { const r = gl.domElement.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height, n: live.length } }
    }
    return { n: live.length }
  })()`)
  console.log('TAPCHECK target', JSON.stringify(where))
  if (where.x !== undefined) {
    await mouse('mouseMoved', where.x, where.y)
    await mouse('mousePressed', where.x, where.y, { button: 'left', clickCount: 1 })
    await mouse('mouseReleased', where.x, where.y, { button: 'left', clickCount: 1 })
    await sleep(1500)
    console.log('TAPCHECK selected', await ev(`(async () => { const { useShards } = await import('/src/store/useShards.ts'); return useShards.getState().selectedSecret })()`))
  }
}
const t0 = Date.now()
await snapshot('start')
if (process.env.ALLOC) await allocProfile(Number(process.env.ALLOC))
let next = 0
while (Date.now() < until) {
  if (Date.now() >= next) {
    const r = await sample(Math.round((Date.now() - t0) / 1000))
    console.log(tag, r.t, 'heap', Math.round(r.used / 1e6), '/', Math.round(r.total / 1e6), 'backing', Math.round((r.backing ?? 0) / 1e6), 'MB rss r/g/o', Math.round(r.rss.renderer / 1e6), Math.round(r.rss.gpu / 1e6), Math.round(r.rss.other / 1e6), 'MB nodes', r.nodes, 'gl', JSON.stringify(r.gl), 'soak', JSON.stringify(r.soak), 'vis', r.visibility, 'leaked', leaked)
    next = Date.now() + SAMPLE
  }
  await act()
}
await snapshot('end')
console.log('done', tag, 'leaked', leaked, 'dropped in page', (await ev('window.__soak?.().dropped')))
shutdown(0)
