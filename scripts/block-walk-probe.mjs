/**
 * block-walk-probe.mjs: step the hyperspace scrubber block by block and
 * record what the GPU holds at each block (arkinox, 2026-10-15: Android's GPU
 * process crashed stepping 0 -> 7). Same publish guards as perf-probe.mjs:
 * WebSocket.send drops EVENT/AUTH to anything but localhost, the run aborts if
 * one reaches the network, and every relay socket is refused outright (the
 * line loads its headers over HTTP).
 *
 * Usage: DISPLAY=:9x node scripts/block-walk-probe.mjs <dev url> <out dir> [from] [to]
 * Env: DPR (2.625), W (412), H (915), CHROME.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [url, out, fromArg = '0', toArg = '10'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const DPR = Number(process.env.DPR ?? 2.625), W = Number(process.env.W ?? 412), H = Number(process.env.H ?? 915)
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const port = 9400 + Math.floor(Math.random() * 400)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blockwalk-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--window-size=${W},${H + 100}`, `--force-device-scale-factor=${DPR}`, 'about:blank',
], { stdio: 'ignore' })
const shutdown = (code) => { try { chrome.kill() } catch {} ; try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} ; process.exit(code) }
process.on('SIGTERM', () => shutdown(143))
await sleep(8000)
const connect = (wsUrl) => {
  const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const handlers = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { const p = pend.get(d.id); pend.delete(d.id); if (p) d.error ? p.rej(new Error(d.error.message)) : p.res(d.result) } else (handlers.get(d.method) ?? []).forEach((h) => h(d.params)) }
  return { ready: new Promise((r) => (ws.onopen = r)), send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }), on: (method, h) => handlers.set(method, [...(handlers.get(method) ?? []), h]) }
}
const pageTarget = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')
const cdp = connect(pageTarget.webSocketDebuggerUrl)
await cdp.ready
await cdp.send('Network.enable')
const socketUrls = new Map()
cdp.on('Network.webSocketCreated', (p) => socketUrls.set(p.requestId, p.url))
cdp.on('Network.webSocketFrameSent', (p) => {
  const u = socketUrls.get(p.requestId) ?? ''
  if (/localhost|127\.0\.0\.1/.test(u)) return
  if (/^\s*\[\s*"(EVENT|AUTH)"/.test(p.response?.payloadData ?? '')) { console.log('ABORT: frame reached', u); shutdown(3) }
})
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
cdp.on('Fetch.requestPaused', (p) => {
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(p.request.url)
  if (!local && p.request.method !== 'GET') cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
  else cdp.send('Fetch.continueRequest', { requestId: p.requestId })
})
await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true })
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
await cdp.send('Page.enable')
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('onosendai:live', '0') } catch {}
  // Relays refused outright: nothing can be read or sent; the line loads over HTTP.
  const WS = window.WebSocket
  window.WebSocket = new Proxy(WS, { construct(t, a) { const u = String(a[0]); if (!/localhost|127\\.0\\.0\\.1/.test(u)) { return new t('ws://127.0.0.1:9/') } return new t(...a) } })
  window.__lost = []
  const gc = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...r) { const x = gc.call(this, type, ...r); if (x && /webgl/i.test(String(type)) && !this.__w) { this.__w = 1; this.addEventListener('webglcontextlost', (e) => window.__lost.push({ t: Date.now(), msg: String(e.statusMessage || '') })) } return x }
})()` })
const errors = []
await cdp.send('Inspector.enable').catch(() => {})
cdp.on('Inspector.targetCrashed', () => { errors.push('TARGET CRASHED at ' + new Date().toISOString()); console.log('TARGET CRASHED') })
cdp.on('Page.frameNavigated', (p) => { if (!p.frame.parentId) console.log('NAVIGATED', p.frame.url) })
cdp.on('Runtime.executionContextDestroyed', () => console.log('CONTEXT DESTROYED'))
await cdp.send('Runtime.enable')
cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'warning') errors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)) })
cdp.on('Runtime.exceptionThrown', (p) => errors.push('EXC ' + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300)))
const ev = async (expression) => { const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).catch((e) => ({ result: { value: { evalError: String(e.message) } } })); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value }
await cdp.send('Page.navigate', { url })
await sleep(15_000)
const t0 = Date.now()
while (Date.now() - t0 < 900_000) {
  const st = await ev(`(async () => { const h = await import('/src/store/useHyperspace.ts'); const s = h.useHyperspace.getState(); return s.sync.status + ' tip=' + s.tipHeight })()`)
  if (/^ready/.test(st)) { console.log('sync:', st, Math.round((Date.now() - t0) / 1000) + 's'); break }
  await sleep(5000)
}
const snap = `(() => { const gl = window.__gl; const i = gl?.info; const s = window.__store.getState(); const cam = window.__camera;
  let bad = 0, maxR = 0, verts = 0, geos = 0
  window.__scene?.traverse((o) => { const g = o.geometry; if (!g || !g.attributes?.position) return; geos++; const a = g.attributes.position.array; verts += a.length / 3; for (let k = 0; k < a.length; k++) { const v = a[k]; if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > maxR) maxR = Math.abs(v) } })
  const ctx = gl?.getContext(); const tex = gl?.info.memory.textures
  return { scale: s.scaleExp, plane: s.anchorPlane, focus: s.focus?.label ?? null, geometries: i?.memory.geometries, textures: tex, programs: i?.programs?.length, calls: i?.render.calls, triangles: i?.render.triangles, sceneGeos: geos, verts, nonFinite: bad, maxAbs: maxR, camPos: cam ? [cam.position.x, cam.position.y, cam.position.z].map((v) => Number(v.toPrecision(4))) : null, camNear: cam?.near, camFar: cam?.far, lost: window.__lost.length, ctxLost: ctx?.isContextLost?.() } })()`
const rows = []
await ev(`(async () => { const h = await import('/src/store/useHyperspace.ts'); h.useHyperspace.getState().setScrubHeight(${Number(fromArg)}) })()`)
for (let h = Number(fromArg); h <= Number(toArg); h++) {
  if (h > Number(fromArg)) await ev(`(async () => { const m = await import('/src/store/useHyperspace.ts'); m.useHyperspace.getState().setScrubHeight(${h}) })()`)
  await sleep(4000)
  const before = Date.now()
  const row = { h, ...(await ev(snap)), ms: Date.now() - before }
  rows.push(row); console.log(JSON.stringify(row))
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, `block-${h}.png`), Buffer.from(shot.data, 'base64'))
}
fs.writeFileSync(path.join(out, 'rows.json'), JSON.stringify({ rows, errors }, null, 1))
console.log('errors:', errors.length); for (const e of errors.slice(0, 20)) console.log('  ', e)
shutdown(0)
