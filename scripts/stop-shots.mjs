/**
 * stop-shots.mjs: hyperspace stop markers and labels, photographed at a set of
 * zooms for a before/after compare (2026-10-15). Same browser and publish
 * guards as perf-probe.mjs (LOCAL forced; EVENT/AUTH to anything but
 * localhost dropped in the page, and the run aborts if one reaches the
 * network). Usage: DISPLAY=:9x W=412 H=915 DPR=2.625 node scripts/stop-shots.mjs
 * <dev-server url> <out dir> <tag>. Env ROOTS: comma-separated merkle roots to
 * view by /C/; SCALES: comma-separated scale exponents.
 */
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

const [url, out, tagArg] = process.argv.slice(2)
const scenario = 'shots'
const windowArg = '0'
const WINDOW = Number(windowArg)
const minutes = '0'
fs.mkdirSync(out, { recursive: true })
const SAMPLE = Number(process.env.SAMPLE ?? 30) * 1000
const DPR = Number(process.env.DPR ?? 1)
const W = Number(process.env.W ?? 1920)
const H = Number(process.env.H ?? 1080)
const SPECT = process.env.SPECT ?? 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const tag = `${tagArg}${process.env.BG ? '-bg' : ''}-dpr${DPR}${process.env.TAG ? '-' + process.env.TAG : ''}`
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
await cdp.send('Runtime.enable')
const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const roots = (process.env.ROOTS ?? '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b').split(',')
const scales = (process.env.SCALES ?? '84,83,80,77,76,74').split(',').map(Number)
let first = true
for (const root of roots) {
  await cdp.send('Page.navigate', { url: `${url.replace(/\/$/, '')}/C/${root}` })
  await sleep(first ? 45_000 : 20_000)
  first = false
  if ((await ev('window.__store?.getState().live')) !== false) { console.log('ABORT: not LOCAL'); shutdown(2) }
  for (const s of scales) {
    await ev(`(() => { const st = window.__store.getState(); st.adjustScale(${s} - st.scaleExp) })()`)
    await sleep(4000)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const name = `${tag}-${root.slice(0, 8)}-2e${s}.png`
    fs.writeFileSync(path.join(out, name), Buffer.from(shot.data, 'base64'))
    console.log('shot', name, 'scale', await ev('window.__store.getState().scaleExp'))
  }
}
console.log('leaked', leaked, 'dropped', await ev('window.__soak().dropped'))
shutdown(0)
