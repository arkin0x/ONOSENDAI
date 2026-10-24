/**
 * perf-bench-orbit.mjs: the workshop bench, idle and orbiting, over raw CDP
 * (2026-10-23).
 *
 * arkinox, 2026-10-23: "big perf issues plaguing the app when just looking
 * at models in the workshop... lockups frequent." This brings a zip of
 * shards in through the workshop's own bulk import (nothing published), opens
 * one of them on the bench, then watches it do nothing for a while and
 * watches it orbit for a while, and reports what changed in each phase:
 * WebGL buffer uploads and draw calls (the same __soak() counters
 * mem-soak-workshop.mjs uses), long tasks (PerformanceObserver('longtask')),
 * and the browser's own script/task duration metrics. Every number printed
 * is a delta against the start of its own phase, not a running total since
 * page load: a phase that reports zero means nothing happened in that
 * phase, not that nothing has ever happened on the page (the import alone
 * is real, if one-time, work).
 *
 * Why raw CDP and not Playwright: see mem-soak3.mjs.
 *
 * Nothing leaves the machine: LOCAL is set before load, every WebSocket to
 * anything but localhost is refused in the page before app code runs, every
 * HTTP request to anything but localhost is failed through the Fetch domain,
 * and an EVENT or AUTH frame seen leaving for a real relay aborts the run.
 *
 * Usage: node scripts/perf-bench-orbit.mjs <url> <zip> <piece substring> [seconds per phase]
 * Env: W (1280), H (800), DPR (1), CHROME=<path>.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [url, zipPath, piece, secondsArg = '60'] = process.argv.slice(2)
if (!url || !zipPath || !piece) { console.log('usage: perf-bench-orbit.mjs <url> <zip> <piece> [seconds per phase]'); process.exit(1) }
const PHASE_S = Number(secondsArg)
const DPR = Number(process.env.DPR ?? 1)
const W = Number(process.env.W ?? 1280)
const H = Number(process.env.H ?? 800)
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const port = 9400 + Math.floor(Math.random() * 400)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'benchorbit-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--window-size=${W},${H + 100}`, `--force-device-scale-factor=${DPR}`, 'about:blank',
], { stdio: 'ignore' })
const shutdown = (code) => {
  // Drain stdout before exiting: a large final JSON.stringify can still be
  // buffered when process.exit() is called, truncating the last line.
  const done = () => { try { chrome.kill() } catch {} ; try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} ; process.exit(code) }
  if (process.stdout.writableLength > 0) process.stdout.once('drain', done)
  else setTimeout(done, 50)
}
process.on('SIGTERM', () => shutdown(143))
process.on('SIGINT', () => shutdown(130))
await sleep(3000)

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
  // No socket to anything but this machine (mem-soak-workshop.mjs's guard).
  const WS = window.WebSocket
  window.WebSocket = new Proxy(WS, { construct(t, a) { const u = String(a[0]); if (!/^wss?:\\/\\/(localhost|127\\.0\\.0\\.1)[:/]/.test(u)) { a = ['ws://127.0.0.1:9/refused'] } return new t(...a) } })
  const g = { buffers: 0, textures: 0, programs: 0, vaos: 0, bufferData: 0, bufferBytes: 0, uploads: 0, draws: 0 }
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
    const wrap = (name, f) => { const o = P.prototype[name]; if (o) P.prototype[name] = function (...a) { f(a, this); return o.apply(this, a) } }
    wrap('createBuffer', () => g.buffers++); wrap('deleteBuffer', (a) => { if (a[0]) g.buffers-- })
    wrap('createTexture', () => g.textures++); wrap('deleteTexture', (a) => { if (a[0]) g.textures-- })
    wrap('createProgram', () => g.programs++); wrap('deleteProgram', (a) => { if (a[0]) g.programs-- })
    wrap('createVertexArray', () => g.vaos++); wrap('deleteVertexArray', (a) => { if (a[0]) g.vaos-- })
    wrap('bufferData', (a) => { g.bufferData++; const s = a[1]; g.bufferBytes += typeof s === 'number' ? s : (s?.byteLength ?? 0) })
    wrap('bufferSubData', (a) => { g.uploads++ })
    for (const d of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) wrap(d, () => g.draws++)
  }
  window.__longtasks = []
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longtasks.push({ d: Math.round(e.duration), t: Math.round(e.startTime) }) }).observe({ type: 'longtask', buffered: true })
  } catch {}
  window.__soak = () => ({ gl: { ...g }, longtasks: window.__longtasks.length, longtaskMs: window.__longtasks.reduce((s, x) => s + x.d, 0) })
})()` })
await cdp.send('Performance.enable')
await cdp.send('Page.navigate', { url })
await sleep(8_000)
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
  useWorkshop.getState().openWorkshop()
  const im = useShardImport.getState()
  await im.openZip(file)
  for (let i = 0; i < 100 && useShardImport.getState().phase !== 'review'; i++) await new Promise((r) => setTimeout(r, 200))
  useShardImport.getState().setPublish(false)
  await useShardImport.getState().start()
  for (let i = 0; i < 300 && useShardImport.getState().phase === 'running'; i++) await new Promise((r) => setTimeout(r, 200))
  const want = useWorkshop.getState().shards.find((s) => s.name.includes(${JSON.stringify(piece)}))
  if (want) useWorkshop.getState().openWorkshop(want.id)
  return { shards: useWorkshop.getState().shards.length, open: want ? { name: want.name, vertices: want.vertices.length, faces: want.faces.length } : null }
})()`)
console.log('imported', JSON.stringify(imported))
if (!imported.open) { console.log('ABORT: no piece', piece); shutdown(4) }

{
  const t = Date.now()
  while (Date.now() - t < 120_000 && !(await ev('!!window.__benchScene && window.__soak().gl.draws > 0'))) await sleep(1000)
  console.log('bench drawn after', Math.round((Date.now() - t) / 1000), 's; opened', JSON.stringify(imported.open))
}
// Let the decode settle (SHARD_DECODE_MS) before measuring steady state.
await sleep(3000)

const { width, height } = await cdp.send('Page.getLayoutMetrics').then((m) => ({ width: m.visualViewport.clientWidth, height: m.visualViewport.clientHeight }))
const cx = width / 2, cy = height / 2

const phase = async (name, drive) => {
  const d = (x) => ({ draws: x.gl.draws, bufferData: x.gl.bufferData, bufferBytes: x.gl.bufferBytes, longtasks: x.longtasks, longtaskMs: x.longtaskMs })
  const m0 = await cdp.send('Performance.getMetrics')
  const s0 = d(await ev('window.__soak()'))
  const t0 = Date.now()
  const stop = drive ? drive() : null
  await sleep(PHASE_S * 1000)
  if (stop) await stop()
  const m1 = await cdp.send('Performance.getMetrics')
  const s1 = d(await ev('window.__soak()'))
  const met = (k) => (Object.fromEntries(m1.metrics.map((x) => [x.name, x.value]))[k] ?? 0) - (Object.fromEntries(m0.metrics.map((x) => [x.name, x.value]))[k] ?? 0)
  const elapsed = (Date.now() - t0) / 1000
  const row = {
    phase: name, seconds: Math.round(elapsed),
    draws: s1.draws - s0.draws, drawsPerSec: Math.round((s1.draws - s0.draws) / elapsed),
    bufferDataCalls: s1.bufferData - s0.bufferData, bufferBytes: s1.bufferBytes - s0.bufferBytes,
    longtasks: s1.longtasks - s0.longtasks, longtaskMs: s1.longtaskMs - s0.longtaskMs,
    scriptMs: Math.round(met('ScriptDuration') * 1000), taskMs: Math.round(met('TaskDuration') * 1000),
    layoutCount: met('LayoutCount'), recalcCount: met('RecalcStyleCount'),
  }
  console.log('PHASE', JSON.stringify(row))
  return row
}

// Phase 1: idle. The tab stays focused and visible, nothing touches the canvas.
const idle = await phase('idle', null)

// Phase 2: orbit. A slow continuous drag, left button held, describing a
// circle over the canvas centre: the same gesture OrbitControls reads from a
// mouse drag. No taps, no tool use: VIEW and nothing else.
const orbit = await phase('orbit', () => {
  let stop = false
  const run = (async () => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 })
    const r = Math.min(width, height) * 0.25
    let a = 0
    while (!stop) {
      a += 0.12
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a) * 0.6
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
      await sleep(16)
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 })
  })()
  return async () => { stop = true; await run }
})

// Phase 3: a single tap and release at the canvas centre, no movement at
// all: the repro that matters. A tap, not a drag, is enough to set off the
// re-render storm this script was written to catch (arkinox, 2026-10-23).
const tap = await phase('tap', () => {
  const run = (async () => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(300)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 })
  })()
  return async () => { await run }
})

console.log('SUMMARY', JSON.stringify({ idle, orbit, tap, leaked }))
shutdown(0)
