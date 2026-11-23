/**
 * verify-extent-4096.mjs: the workshop at GRID SIZE 4,096 (DECK-0003 §1.8,
 * ruled 2026-11-23), seen and measured in a real headless Chromium.
 *
 * 1. GRID SIZE stepped by its own + button from 60 up past 64 and back, and
 *    held to the top: the stops it lands on.
 * 2. Screenshots at 4,096: the GRID sheet, the whole grid from the far end of
 *    the orbit, a middle distance, and close in at the far corner at 1/120.
 * 3. A real tap in ADD at the far corner: the point lands on the lattice.
 * 4. The grid's cost at 8 and at 4,096: grid objects, vertices, draw calls.
 *
 * Nothing leaves the machine, as in verify-bench-grid.mjs: LOCAL before load,
 * every non-localhost socket and request refused, and an EVENT or AUTH frame
 * leaving for a real relay aborts the run.
 *
 * Usage: node scripts/verify-extent-4096.mjs <dev url> <out dir> <tag>
 * Env: W, H, DPR, CHROME, PROFILE_DIR.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'

const [url, out, tag = 'run'] = process.argv.slice(2)
if (!url || !out) { console.log('usage: verify-extent-4096.mjs <url> <out dir> <tag>'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
const W = Number(process.env.W ?? 1600)
const H = Number(process.env.H ?? 1000)
const DPR = Number(process.env.DPR ?? 1)
const SKIP = new Set((process.env.SKIP ?? '').split(',').filter(Boolean))
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const port = 9800 + Math.floor(Math.random() * 150)
const profile = fs.mkdtempSync(path.join(process.env.PROFILE_DIR ?? os.tmpdir(), 'ws-extent-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-gpu-vsync', '--disable-frame-rate-limit',
  '--headless=new', `--window-size=${W},${H}`, `--force-device-scale-factor=${DPR}`, 'about:blank',
], { stdio: 'ignore' })
const shutdown = (code) => { try { chrome.kill() } catch {} ; try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} ; process.exit(code) }
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

await cdp.send('Network.enable')
const socketUrls = new Map()
cdp.on('Network.webSocketCreated', (p) => socketUrls.set(p.requestId, p.url))
cdp.on('Network.webSocketFrameSent', (p) => {
  const u = socketUrls.get(p.requestId) ?? ''
  if (/localhost|127\.0\.0\.1/.test(u)) return
  if (/^\s*\[\s*"(EVENT|AUTH)"/.test(p.response?.payloadData ?? '')) { console.log('ABORT: an EVENT or AUTH frame reached', u); shutdown(3) }
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
  const g = window.__gl = { draws: 0, buffers: 0, bufferData: 0, bufferBytes: 0, frames: 0 }
  for (const P of [window.WebGL2RenderingContext].filter(Boolean)) {
    const wrap = (name, f) => { const o = P.prototype[name]; if (o) P.prototype[name] = function (...a) { f(a); return o.apply(this, a) } }
    wrap('createBuffer', () => g.buffers++); wrap('deleteBuffer', (a) => { if (a[0]) g.buffers-- })
    wrap('bufferData', (a) => { g.bufferData++; const s = a[1]; g.bufferBytes += typeof s === 'number' ? s : (s?.byteLength ?? 0) })
    for (const d of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) wrap(d, () => g.draws++)
  }
  const tick = () => { g.frames++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})()` })
await cdp.send('Page.navigate', { url })
await sleep(6000)
const ev = async (expression, tries = 4) => {
  // V8 can drop a promise it finds unreachable while a loaded machine is slow to
  // settle it. The expressions here are safe to run again.
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).catch(async (e) => {
    if (tries <= 1 || !/Promise was collected/.test(e.message)) throw e
    await sleep(1000)
    return { retried: true, result: { value: await ev(expression, tries - 1) } }
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
for (let i = 0; i < 90 && !(await ev('!!window.__store').catch(() => false)); i++) await sleep(1000)
await sleep(2000)
if ((await ev('window.__store?.getState().live')) !== false) { console.log('ABORT: not LOCAL'); shutdown(2) }
await ev(`(async () => {
  const { useWorkshop } = await import('/src/store/useWorkshop.ts')
  window.__ws = useWorkshop
  const w = useWorkshop.getState()
  w.openWorkshop()
  w.create('grid test')
  useWorkshop.setState({ showAvatar: false })
})()`)
for (let i = 0; i < 60 && !(await ev('!!window.__benchScene && !!window.__benchControls')); i++) await sleep(500)
await sleep(2500)
const box = await ev(`(() => { const c = [...document.querySelectorAll('.workshop canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
console.log('canvas', JSON.stringify(box))
const settle = async () => { await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))') ; await sleep(120) }
const look = (px, py, pz, tx, ty, tz) => ev(`(() => { const c = window.__benchControls; c.target.set(${tx}, ${ty}, ${tz}); window.__benchCamera.position.set(${px}, ${py}, ${pz}); c.update(); return window.__benchCamera.position.distanceTo(c.target) })()`)
const shot = async () => {
  await settle()
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  return Buffer.from(r.data, 'base64')
}


const report = { tag, box, stepper: [], shots: [], tap: null, cost: [] }
const save = (name, png) => { const f = path.join(out, `extent-${tag}-${name}.png`); fs.writeFileSync(f, png); report.shots.push(path.basename(f)) }
const clickArea = (label) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '${label}'); if (!b) return false; b.click(); return true })()`)
const cost = async (name) => {
  await settle()
  const a = await ev('({ ...window.__gl })')
  await settle(); await settle()
  const b = await ev('({ ...window.__gl })')
  const g = await ev(`(() => { let n = 0, objs = 0; window.__benchScene.traverse((o) => { if (o.type === 'GridHelper' || o.name === 'bench-grid') { objs++; n += o.geometry.attributes.position.count } }); return { n, objs } })()`)
  const row = { name, extent: await ev('window.__ws.getState().current().extent'), gridObjects: g.objs, gridVertices: g.n, far: await ev('Math.round(window.__benchCamera.far)'), near: await ev('Math.round(window.__benchCamera.near * 1000) / 1000'), maxDistance: await ev('Math.round(window.__benchControls.maxDistance)') }
  report.cost.push(row)
  console.log('COST', JSON.stringify(row))
}

// 1. The stepper, through its own button.
await ev(`window.__ws.getState().setExtent(60)`)
await clickArea('GRID')
await sleep(800)
/** A real press and release on a stepper button, as a finger or a mouse makes it (useRepeatable reads pointer events). */
const press = async (label) => {
  const r = await ev(`(() => { const b = document.querySelector('button[aria-label="${label}"]'); if (!b || b.disabled) return null; const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 } })()`)
  if (r) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(20)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(20)
  }
  return ev('window.__ws.getState().current().extent')
}
const plus = () => press('Larger grid')
const minus = () => press('Smaller grid')
const ups = []
for (let i = 0; i < 12; i++) { ups.push(await plus()); await sleep(30) }
const downs = []
for (let i = 0; i < 12; i++) { downs.push(await minus()); await sleep(30) }
report.stepper.push({ from: 60, up: ups, down: downs })
console.log('STEPPER', JSON.stringify(report.stepper[0]))
let presses = 0
while ((await ev('window.__ws.getState().current().extent')) < 4096 && presses < 400) { await plus(); presses++ }
const top = await ev('window.__ws.getState().current().extent')
const disabled = await ev(`document.querySelector('button[aria-label="Larger grid"]').disabled`)
report.stepper.push({ pressesFrom60ToTop: presses, top, plusDisabledAtTop: disabled, undoSteps: await ev('window.__ws.getState().past.length') })
console.log('TOP', JSON.stringify(report.stepper[1]))
await sleep(600)
save('grid-sheet', await shot())

// 2. The whole grid, from the far end of the orbit.
await clickArea('GRID')
await sleep(600)
await ev(`(() => { const c = window.__benchControls; c.target.set(0, 0, 0); const d = 1e9; window.__benchCamera.position.set(0.62 * d, 0.55 * d, 0.73 * d); c.update(); })()`)
await settle(); await settle()
await ev(`(() => { const c = window.__benchControls; c.update(); })()`)
await sleep(400)
save('whole', await shot())
await cost('whole-4096')
const dist = await ev('Math.round(window.__benchCamera.position.distanceTo(window.__benchControls.target))')
report.wholeDistance = dist
await look(150, 260, 320, 0, 0, 0)
save('middle', await shot())
await look(0, 900, 1.2, 0, 0, 0)
save('top-down-900', await shot())

// 3. Close in at the far corner, at 1/120, and a tap there.
await ev(`(() => { const w = window.__ws.getState(); w.setDivision(120); w.setTool('add') })()`)
await sleep(400)
await look(4090.3, 0.9, -4089.7 + 0.0005, 4090.3, 0, -4089.7)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
await ev(`window.__ws.getState().setAim(null)`)
save('far-corner-1-120', await shot())
const cx = box.x + box.w * 0.55, cy = box.y + box.h * 0.5
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy })
await sleep(80)
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 })
await sleep(40)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 })
await sleep(300)
report.tap = await ev(`(() => { const s = window.__ws.getState().current(); const v = s.vertices[s.vertices.length - 1]; if (!v) return null; const t = [0, 1, 2].map((k) => v.p[k] * 120 + (v.t ? v.t[k] : 0)); return { ticks: t, units: t.map((x) => x / 120), onLattice: t.every(Number.isInteger), withinBound: t.every((x) => Math.abs(x) <= 4096 * 120) } })()`)
console.log('TAP', JSON.stringify(report.tap))
save('far-corner-tapped', await shot())
await ev(`(() => { const w = window.__ws.getState(); w.setTool('view'); w.setDivision(1) })()`)

// 4. The default grid, as it always was, for comparison.
await ev(`(() => { const w = window.__ws.getState(); w.create('small'); })()`)
await sleep(600)
await look(10, 9, 12, 0, 0, 0)
save('default-8', await shot())
await cost('default-8')

fs.writeFileSync(path.join(out, `extent-${tag}.json`), JSON.stringify(report, null, 1))
const ok = report.tap?.onLattice && report.tap?.withinBound && top === 4096 && disabled && report.cost.every((c) => c.gridVertices === 4 && c.gridObjects === 1)
console.log('RESULT', ok ? 'all ok' : 'FAILED')
shutdown(ok ? 0 : 1)
