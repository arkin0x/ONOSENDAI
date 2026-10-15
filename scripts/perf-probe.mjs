/**
 * perf-probe.mjs: ONOSENDAI's steady-state cost, measured (2026-10-15).
 *
 * The same browser and the same two publish guards as mem-soak3.mjs (raw CDP,
 * WebSocket.send drops EVENT/AUTH to anything but localhost, and the run
 * aborts if one reaches the network). Instead of a long soak it measures, over
 * a window of WINDOW seconds in one scene:
 * - allocation per frame (sampling heap profiler, GC'd objects included);
 * - main-thread task time per frame (Performance.getMetrics TaskDuration);
 * - draw calls and triangles per frame (renderer.info with autoReset off);
 * - React commits per second and which components rendered (a minimal
 *   devtools hook installed before React loads);
 * - timer callbacks fired per minute, visible and hidden (BG=1);
 * - REQ frames sent in the first 20 s after load.
 *
 * SHARDS=<objects.jsonl> injects public 33331 objects as discovered shards
 * (COPIES, RADIUS), as mem-soak3.mjs does.
 *
 * Usage: DISPLAY=:93 node scripts/perf-probe.mjs <url> <out dir> <scene> [window s]
 * Scenes: spectate (arkinox's surroundings, read-only), spawn (a fresh local
 * identity at its spawn). Env: BG=1, DPR, W, H, TAG, CHROME.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [url, out, scenario, windowArg = '20'] = process.argv.slice(2)
const WINDOW = Number(windowArg)
const minutes = '0'
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
  const fires = new Map()
  const site = () => { const l = (new Error().stack || '').split('\\n').slice(3).find((x) => /\\/src\\/|node_modules/.test(x)) || '?'; return l.replace(/^.*\\/(src|node_modules)\\//, '$1/').replace(/\\?[^:]*/, '').replace(/\\)$/, '').trim() }
  const counted = (fn, key) => typeof fn === 'function' ? function (...x) { fires.set(key, (fires.get(key) || 0) + 1); return fn.apply(this, x) } : fn
  window.__fires = () => { const o = Object.fromEntries(fires); fires.clear(); return o }
  let reqs = 0
  window.__reqs = () => reqs
  const send0 = WebSocket.prototype.send
  const reqLog = []
  window.__reqLog = () => reqLog
  WebSocket.prototype.send = function (d) { if (typeof d === 'string' && /^\\s*\\[\\s*"REQ"/.test(d)) { reqs++; try { const a = JSON.parse(d); reqLog.push({ url: this.url, filters: JSON.stringify(a.slice(2)) }) } catch {} } return send0.call(this, d) }
  // A minimal React devtools hook: count commits and which components rendered.
  const rendered = new Map(); let commits = 0
  const nameOf = (f) => { const t = f.type; if (!t || typeof t === 'string') return null; return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || null }
  // As React DevTools does: a fiber rendered in this commit when it is not its
  // previous self and carries PerformedWork; a subtree whose children are the
  // previous children was reused and is not walked.
  const upd = (next, prev) => {
    if (prev && next === prev) return
    if (prev && (next.flags & 1)) { const n = nameOf(next); if (n) rendered.set(n, (rendered.get(n) || 0) + 1) }
    if (prev && next.child === prev.child) return
    let c = next.child
    while (c) { upd(c, c.alternate); c = c.sibling }
  }
  const walkFiber = (f) => upd(f, f.alternate)
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1 }, onScheduleFiberRoot() {}, onCommitFiberRoot(_id, root) { commits++; try { walkFiber(root.current) } catch {} }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} }
  window.__react = () => { const o = { commits, rendered: Object.fromEntries([...rendered.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) }; commits = 0; rendered.clear(); return o }
  window.setInterval = function (fn, ...a) { const id = si.call(this, counted(fn, 'I ' + site()), ...a); li.add(id); return id }
  window.clearInterval = function (id) { li.delete(id); return ci.call(this, id) }
  window.setTimeout = function (fn, ...a) { let id; const f2 = counted(fn, 'T ' + site()); const w = typeof f2 === 'function' ? function (...x) { lt.delete(id); return f2.apply(this, x) } : f2; id = st.call(this, w, ...a); lt.add(id); return id }
  window.clearTimeout = function (id) { lt.delete(id); return ct.call(this, id) }
  const raf = window.requestAnimationFrame
  window.requestAnimationFrame = function (cb) { c.raf++; return raf.call(this, cb) }
  const Wk = window.Worker
  window.Worker = new Proxy(Wk, { construct(t, a) { const w = new t(...a); c.workersCreated++; const term = w.terminate.bind(w); w.terminate = () => { c.workersTerminated++; term() }; return w } })
  window.__soak = () => ({ ...c, intervals: li.size, timeouts: lt.size, glAlive: gl.filter((w) => { const e = w.deref(); return e && e.isConnected }).length, glHeld: gl.filter((w) => w.deref()).length, canvases: document.querySelectorAll('canvas').length })
})()` })
if (process.env.SEED) {
  // A fixed local identity, so two runs draw the same place (screenshot compares).
  const { nip19 } = await import('nostr-tools')
  const { getPublicKey } = await import('nostr-tools/pure')
  const sk = new Uint8Array(32).fill(Number(process.env.SEED))
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('onosendai:signer', ${JSON.stringify(JSON.stringify({ kind: 'local', pubkey: getPublicKey(sk), nsec: nip19.nsecEncode(sk) }))}) } catch {}` })
}
const consoleErrors = []
await cdp.send('Runtime.enable')
cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)) })
await cdp.send('Performance.enable')
const tLoad = Date.now()
await cdp.send('Page.navigate', { url })
await sleep(20_000)
const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
if ((await ev('window.__store?.getState().live')) !== false) { console.log('ABORT: not LOCAL'); shutdown(2) }
const bootReqs = await ev('window.__reqs()')
if (process.env.REQLOG) {
  const log = await ev('window.__reqLog()')
  const byFilter = new Map()
  for (const r of log) { const k = r.filters; const e = byFilter.get(k) ?? { n: 0, urls: new Set() }; e.n++; e.urls.add(r.url); byFilter.set(k, e) }
  console.log('BOOT REQS', log.length, 'distinct filters', byFilter.size)
  for (const [k, e] of [...byFilter.entries()].sort((a, b) => b[1].n - a[1].n)) console.log(`  x${e.n} on ${e.urls.size} relay(s): ${k.slice(0, 220)}`)
}
if (process.env.WAIT_SYNC) {
  // Steady state: the anchor index finished loading (a fresh profile syncs about a million rows first).
  const t0 = Date.now()
  while (Date.now() - t0 < 600_000) {
    const st = await ev(`(async () => { const h = await import('/src/store/useHyperspace.ts'); const s = h.useHyperspace.getState().sync; return s.status + ' ' + s.loaded + '/' + s.total })()`)
    if (!/^syncing|^loading/.test(st)) { console.log('sync done:', st, 'after', Math.round((Date.now() - t0) / 1000), 's'); break }
    await sleep(5000)
  }
}
if (scenario === 'spectate') {
  await ev(`(async () => { const m = await import('/src/lib/spectator.ts'); await m.spectate(${JSON.stringify(SPECT)}) })()`)
  await sleep(25_000)
}
// The real shard objects, injected as found around the anchor (hidden bags need relay AUTH, which the guard drops).
if (process.env.SHARDS) {
  const objs = fs.readFileSync(process.env.SHARDS, 'utf8').split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((e) => !e.tags.some((t) => t[0] === 'encrypted'))
  fs.writeFileSync(`${profile}-objs.json`, JSON.stringify(objs))
  const n = await ev(`(async () => {
    const objs = ${JSON.stringify(objs)}
    const { useShards } = await import('/src/store/useShards.ts')
    const { avatarFromEvent } = await import('/src/lib/avatar.ts')
    const s = window.__store.getState(); const a = s.anchor
    const items = []; let k = 0; let rnd = 42
    for (const ev of objs) {
      const shard = avatarFromEvent({ ...ev, kind: 11333 })
      if (!shard) continue
      for (let c = 0; c < ${Number(process.env.COPIES ?? 3)}; c++) {
        const off = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return BigInt(Math.round(((rnd / 2147483648) * 2 - 1) * ${Number(process.env.RADIUS ?? 24)})) }
        items.push({ eventId: (k++).toString(16).padStart(64, '0'), bagId: 'soak', lookupId: 'soak', author: ev.pubkey, at: { x: a.x + off(), y: a.y + off(), z: a.z + off() }, plane: s.anchorPlane, height: 6, createdAt: ev.created_at, type: 'shard', shard })
      }
    }
    useShards.getState().addDiscovered(items)
    return items.length
  })()`)
  console.log('injected shards', n)
  await sleep(8000)
}
if (process.env.SHOT) {
  await sleep(5000)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(process.env.SHOT, Buffer.from(data, 'base64'))
  console.log('shot', process.env.SHOT, 'leaked', leaked)
  shutdown(0)
}
if (process.env.BG) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  await fetch(`http://127.0.0.1:${port}/json/activate/${t.id}`)
  await sleep(3000)
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

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
await ev(`(async () => {
  window.__storeChanges = {}
  const watch = (name, store) => store?.subscribe?.((a, b) => { for (const k of Object.keys(a)) if (a[k] !== b[k]) { const key = name + '.' + k; window.__storeChanges[key] = (window.__storeChanges[key] || 0) + 1 } })
  watch('cyber', window.__store)
  try { const h = await import('/src/store/useHyperspace.ts'); window.__syncLog = []; h.useHyperspace.subscribe((a, b) => { if (a.sync !== b.sync) window.__syncLog.push(JSON.stringify(a.sync) === JSON.stringify(b.sync) ? 'SAME' : JSON.stringify({ status: a.sync.status, loaded: a.sync.loaded, total: a.sync.total, source: a.sync.source })) }) } catch {}
  for (const [name, path] of [['shards', '/src/store/useShards.ts'], ['secrets', '/src/store/useSecrets.ts'], ['profiles', '/src/store/useProfiles.ts'], ['chat', '/src/store/useChat.ts'], ['avatars', '/src/store/useAvatars.ts'], ['hints', '/src/store/useUiHints.ts'], ['presence', '/src/store/usePresence.ts'], ['walk', '/src/store/useWalk.ts'], ['notif', '/src/store/useNotifications.ts'], ['relays', '/src/store/useRelays.ts'], ['hyper', '/src/store/useHyperspace.ts'], ['ride', '/src/store/useRideRun.ts'], ['stash', '/src/store/useStash.ts'], ['found', '/src/store/useFound.ts'], ['dms', '/src/store/useAgentDms.ts']]) {
    try { const m = await import(path); for (const [k, v] of Object.entries(m)) if (k.startsWith('use') && typeof v?.subscribe === 'function') watch(name + ':' + k, v) } catch {}
  }
})()`)
await ev('window.__fires(); window.__react(); (() => { const g = window.__gl; if (g) { g.info.autoReset = false; g.info.reset() } })()')
const m0 = await metrics()
const f0 = await ev('window.__gl?.info.render.frame ?? 0')
await cdp.send('HeapProfiler.enable')
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
await sleep(WINDOW * 1000)
const { profile: prof } = await cdp.send('HeapProfiler.stopSampling')
const m1 = await metrics()
const info = await ev('(() => { const g = window.__gl; if (!g) return null; const r = { frame: g.info.render.frame, calls: g.info.render.calls, triangles: g.info.render.triangles, lines: g.info.render.lines, points: g.info.render.points, geometries: g.info.memory.geometries, textures: g.info.memory.textures, programs: g.info.programs?.length ?? null }; g.info.autoReset = true; return r })()')
const fires = await ev('window.__fires()')
const react = await ev('window.__react()')
const frames = Math.max(0, (info?.frame ?? f0) - f0)
const by = new Map(); let total = 0
const walk = (node) => { const f = node.callFrame; const label = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`; total += node.selfSize; by.set(label, (by.get(label) ?? 0) + node.selfSize); for (const c of node.children) walk(c) }
walk(prof.head)
const per = (x) => frames ? Math.round(x / frames * 100) / 100 : null
const row = {
  tag, window: WINDOW, frames, fps: Math.round(frames / WINDOW * 10) / 10,
  allocMBperMin: Math.round(total / WINDOW * 60 / 1e6), allocKBperFrame: frames ? Math.round(total / frames / 1024 * 10) / 10 : null,
  taskMsPerFrame: per((m1.TaskDuration - m0.TaskDuration) * 1000), scriptMsPerFrame: per((m1.ScriptDuration - m0.ScriptDuration) * 1000),
  taskMsPerSec: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000 / WINDOW), layoutsPerSec: Math.round((m1.LayoutCount - m0.LayoutCount) / WINDOW * 10) / 10, recalcStylePerSec: Math.round((m1.RecalcStyleCount - m0.RecalcStyleCount) / WINDOW * 10) / 10,
  callsPerFrame: per(info?.calls ?? 0), trianglesPerFrame: per(info?.triangles ?? 0), linesPerFrame: per(info?.lines ?? 0), pointsPerFrame: per(info?.points ?? 0),
  geometries: info?.geometries, textures: info?.textures, programs: info?.programs,
  reactCommitsPerSec: Math.round(react.commits / WINDOW * 10) / 10, bootReqs,
  timerFiresPerMin: Math.round(Object.values(fires).reduce((a, b) => a + b, 0) / WINDOW * 60),
  heapUsedMB: Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6),
  rssMB: Object.fromEntries(Object.entries(procTree()).map(([k, v]) => [k, Math.round(v / 1e6)])),
}
console.log(JSON.stringify(row))
if (process.env.CALLERS) {
  // Who allocates in the named functions: their callers, three levels up, by bytes.
  const want = new RegExp(process.env.CALLERS)
  const chains = new Map()
  const lab = (n) => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/').replace(/\?.*$/, '')}:${n.callFrame.lineNumber + 1}`
  const rec = (node, stack) => {
    const here = [...stack, node]
    if (want.test(node.callFrame.functionName) && node.selfSize > 0) { const k = here.slice(-5, -1).map(lab).reverse().join(' <- '); chains.set(k, (chains.get(k) ?? 0) + node.selfSize) }
    for (const c of node.children) rec(c, here)
  }
  rec(prof.head, [])
  console.log('CALLERS of', process.env.CALLERS)
  for (const [k, v] of [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(Math.round(v / WINDOW * 60 / 1e5) / 10).padStart(7)} MB/min  ${k}`)
}
console.log('TOP ALLOC:'); for (const [k, v] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(Math.round(v / WINDOW * 60 / 1e5) / 10).padStart(7)} MB/min  ${k}`)
console.log('REACT RENDERS in window:', JSON.stringify(react.rendered))
console.log('SYNC LOG:', JSON.stringify((await ev('window.__syncLog || []')).slice(0, 12)), 'same:', (await ev('window.__syncLog || []')).filter((x) => x === 'SAME').length, 'of', (await ev('(window.__syncLog || []).length')))
console.log('STORE CHANGES in window:', JSON.stringify(Object.fromEntries(Object.entries(await ev('window.__storeChanges')).sort((a, b) => b[1] - a[1]).slice(0, 30))))
console.log('TIMER FIRES in window:', JSON.stringify(Object.fromEntries(Object.entries(fires).sort((a, b) => b[1] - a[1]).slice(0, 25))))
fs.appendFileSync(`${out}/perf.jsonl`, JSON.stringify({ ...row, top: [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20), rendered: react.rendered, fires }) + '\n')
console.log('console errors:', consoleErrors.length, JSON.stringify(consoleErrors.slice(0, 5)))
console.log('done', tag, 'leaked', leaked, 'dropped in page', await ev('window.__soak?.().dropped'))
shutdown(0)
