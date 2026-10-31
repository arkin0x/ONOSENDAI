/**
 * verify-bench-grid.mjs: the workshop bench's grid, measured off the screen
 * (arkinox, 2026-10-31: "subdivisions beyond 1/10 aren't visually reflected in
 * the change to the grid's subdivisions correctly").
 *
 * Over raw CDP in a real headful Chromium, on a fresh empty shard:
 *
 * 1. For every division, the camera looks straight down from close enough for
 *    the lines to stand apart, and the line spacing is read off the pixels
 *    and compared with what that division should draw.
 * 2. On all three work planes, at a raised level, real taps in ADD: every
 *    point placed must land on a drawn line in both directions of the screen.
 * 3. Screenshots of every division from the opening view, zoomed in, and
 *    close in, laid out on one contact sheet.
 * 4. The grid's cost: uncapped frame rate, draw calls, vertices, and what
 *    stepping through every division uploads.
 *
 * Nothing leaves the machine: LOCAL is set before load, every WebSocket to
 * anything but localhost is refused in the page before app code runs, every
 * HTTP request to anything but localhost is failed through the Fetch domain,
 * and an EVENT or AUTH frame seen leaving for a real relay aborts the run.
 *
 * Usage: DISPLAY=:N node scripts/verify-bench-grid.mjs <dev url> <out dir> <tag>
 * Env: W (1600), H (1000), DPR (1), CHROME=<path>, SKIP (comma list of
 * spacing, taps, shots, perf).
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'

const [url, out, tag = 'run'] = process.argv.slice(2)
if (!url || !out) { console.log('usage: verify-bench-grid.mjs <url> <out dir> <tag>'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
const W = Number(process.env.W ?? 1600)
const H = Number(process.env.H ?? 1000)
const DPR = Number(process.env.DPR ?? 1)
const SKIP = new Set((process.env.SKIP ?? '').split(',').filter(Boolean))
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const DIVISIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 20, 24, 30, 40, 60, 120]
const port = 9800 + Math.floor(Math.random() * 150)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-grid-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-gpu-vsync', '--disable-frame-rate-limit',
  `--window-size=${W},${H + 100}`, `--force-device-scale-factor=${DPR}`, 'about:blank',
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
// Only the canvas: every line measured is the grid's, no panel over it.
await ev(`(() => { const s = document.createElement('style'); s.id = 'grid-only'; s.textContent = '.workshop *{visibility:hidden!important} .workshop canvas{visibility:visible!important}'; document.head.appendChild(s) })()`)
const box = await ev(`(() => { const c = [...document.querySelectorAll('.workshop canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
console.log('canvas', JSON.stringify(box))
const settle = async () => { await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))') ; await sleep(120) }
const look = (px, py, pz, tx, ty, tz) => ev(`(() => { const c = window.__benchControls; c.target.set(${tx}, ${ty}, ${tz}); window.__benchCamera.position.set(${px}, ${py}, ${pz}); c.update(); return window.__benchCamera.position.distanceTo(c.target) })()`)
const shot = async () => {
  await settle()
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 }, captureBeyondViewport: false })
  return Buffer.from(r.data, 'base64')
}

/** Screen positions of the lines running one way, from the picture's average down each column (or row). */
function linesIn(png, along /* 'x' columns or 'y' rows */) {
  const { width, height, data } = PNG.sync.read(png)
  const n = along === 'x' ? width : height
  const m = along === 'x' ? height : width
  const profile = new Float64Array(n)
  for (let a = 0; a < n; a++) {
    let sum = 0
    // Past the compass, which sits in the top right corner on its own canvas.
    for (let b = along === 'x' ? 170 : 0; b < (along === 'x' ? m : m - 170); b += 2) {
      const x = along === 'x' ? a : b, y = along === 'x' ? b : a
      const i = (y * width + x) * 4
      sum += data[i] + data[i + 1] + data[i + 2]
    }
    profile[a] = sum / Math.ceil((m - 170) / 2)
  }
  const sorted = [...profile].sort((p, q) => p - q)
  const floor = sorted[Math.floor(n * 0.1)]
  // Crests of the profile: a crest may be two pixels wide when a line straddles them.
  const raw = []
  for (let i = 1; i < n - 1; i++) {
    if (profile[i] >= profile[i - 1] && profile[i] > profile[i + 1] && profile[i] > floor) {
      let j = i; while (j > 0 && profile[j - 1] === profile[i]) j--
      raw.push({ at: (i + j) / 2, h: profile[i] - floor })
    }
  }
  if (!raw.length) return []
  const typical = [...raw.map((c) => c.h)].sort((p, q) => p - q)[Math.floor(raw.length / 2)]
  // A floor of its own: a few real lines must not be judged against the noise between them.
  const crests = raw.filter((c) => c.h > Math.max(4, typical * 0.35))
  // Centre of mass over the crest's own pixels, for a position finer than a pixel.
  return crests.map((c) => {
    const i = Math.round(c.at); let s = 0, t = 0
    for (let k = Math.max(0, i - 1); k <= Math.min(n - 1, i + 1); k++) { const h = Math.max(0, profile[k] - floor); s += h; t += h * k }
    return s ? t / s : c.at
  })
}
const median = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const tan25 = Math.tan((50 * Math.PI) / 360)
const report = { tag, box, spacing: [], taps: [], perf: {} }

if (!SKIP.has('spacing')) {
  for (const division of (process.env.DIVS ? process.env.DIVS.split(",").map(Number) : DIVISIONS)) {
    await ev(`window.__ws.getState().setDivision(${division})`)
    const want = 14 // px between lines
    const d = Math.max(0.65, Math.min(8, box.h / (2 * tan25 * want * division)))
    // Off centre, a third of a cell over, so no line of interest sits under the axes.
    const dist = await look(1.37, d, -0.41 + 0.0005, 1.37, 0, -0.41)
    const png = await shot()
    const pxPerUnit = box.h / (2 * tan25 * dist)
    const expected = pxPerUnit / division
    const lines = linesIn(png, 'x')
    const gaps = lines.slice(1).map((v, i) => v - lines[i])
    const measured = median(gaps)
    const row = { division, cameraDistance: Math.round(dist * 100) / 100, expectedPx: Math.round(expected * 100) / 100, measuredPx: Math.round(measured * 100) / 100, lines: lines.length, ok: Math.abs(measured - expected) <= Math.max(0.6, expected * 0.04) }
    report.spacing.push(row)
    console.log('SPACING', JSON.stringify(row))
    fs.writeFileSync(path.join(out, `ws-grid-${tag}-top-${division}.png`), png)
  }
}

if (!SKIP.has('taps')) {
  await ev(`(() => { const w = window.__ws.getState(); w.create('grid taps'); w.setTool('add') })()`)
  await sleep(600)
  for (const [plane, division] of [[1, 24], [0, 24], [2, 24], [1, 40], [0, 60], [2, 120], [1, 20]]) {
    // A level that division can reach, raised off the origin.
    const level = (120 / division) * Math.round(division * 2.5)
    await ev(`(() => { const w = window.__ws.getState(); w.clearShard(); w.setPlane(${plane}); w.setDivision(${division}); w.setLevel(${level}); w.setAim(null) })()`)
    const u = level / 120
    const want = 16
    const d = Math.max(0.65, Math.min(8, box.h / (2 * tan25 * want * division)))
    const a = 0.37, b = 0.41
    // Straight at the plane, from its +normal side (render -Z is model +Z).
    if (plane === 1) await look(a, u + d, b + 0.0005, a, u, b)
    if (plane === 0) await look(u + d, a, b, u, a, b)
    if (plane === 2) await look(a, b, -u + d, a, b, -u)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 })
    await ev(`window.__ws.getState().setAim(null)`)
    const png = await shot()
    const cols = linesIn(png, 'x'), rows = linesIn(png, 'y')
    fs.writeFileSync(path.join(out, `ws-grid-${tag}-plane${plane}-${division}.png`), png)
    let worst = 0, placed = 0
    for (const [fx, fy] of [[0.31, 0.27], [0.62, 0.41], [0.47, 0.71], [0.71, 0.63], [0.23, 0.58]]) {
      const x = box.x + box.w * fx, y = box.y + box.h * fy
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await sleep(60)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await sleep(40)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      await sleep(120)
      const at = await ev(`(() => {
        const s = window.__ws.getState().current(); const v = s.vertices[s.vertices.length - 1]; if (!v) return null
        const t = [0, 1, 2].map((k) => v.p[k] * 120 + (v.t ? v.t[k] : 0))
        const p = window.__benchCamera.position.clone().set(t[0] / 120, t[1] / 120, (0 - t[2]) / 120).project(window.__benchCamera)
        return { t, n: s.vertices.length, x: (p.x + 1) / 2 * ${box.w}, y: (1 - p.y) / 2 * ${box.h} }
      })()`)
      if (!at) continue
      placed++
      const dx = Math.min(...cols.map((c) => Math.abs(c - at.x))), dy = Math.min(...rows.map((c) => Math.abs(c - at.y)))
      worst = Math.max(worst, dx, dy)
      // The model coordinates themselves are on the snap too.
      const on = at.t.every((k) => k % (120 / division) === 0)
      if (!on) worst = Infinity
    }
    const row = { plane, division, level, placed, cols: cols.length, rows: rows.length, spacingPx: Math.round(median(cols.slice(1).map((v, i) => v - cols[i])) * 100) / 100, worstOffLinePx: Math.round(worst * 100) / 100, ok: placed === 5 && worst <= 1.5 }
    report.taps.push(row)
    console.log('TAPS', JSON.stringify(row))
  }
  await ev(`(() => { const w = window.__ws.getState(); w.setPlane(1); w.setLevel(0); w.setTool('view'); w.create('grid shots') })()`)
  await sleep(500)
}

if (!SKIP.has('shots')) {
  const views = { home: [10, 9, 12, 0, 0, 0], near: [2.4, 2.2, 2.9, 0, 0, 0], close: [0.5, 0.5, 0.6, 0.25, 0, -0.2] }
  const sheet = []
  for (const division of DIVISIONS) {
    await ev(`window.__ws.getState().setDivision(${division})`)
    for (const [name, v] of Object.entries(views)) {
      await look(...v)
      const png = await shot()
      const file = path.join(out, `ws-grid-${tag}-${name}-${division}.png`)
      fs.writeFileSync(file, png)
      sheet.push({ division, name, data: png.toString('base64') })
    }
  }
  // The sheet is laid out by the browser itself: one row a division, one column a view, crops at full resolution.
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const page = connect(t.webSocketDebuggerUrl)
  await page.ready
  await page.send('Page.enable')
  const cell = (s) => `<div class="c"><img src="data:image/png;base64,${s.data}"><b>${s.division === 1 ? '1' : '1/' + s.division} ${s.name}</b></div>`
  const html = `<!doctype html><style>body{margin:0;background:#000;display:grid;grid-template-columns:repeat(3,500px);gap:4px;width:1508px}.c{position:relative;width:500px;height:320px;overflow:hidden}.c img{position:absolute;left:50%;top:50%;width:1000px;transform:translate(-50%,-50%)}.c b{position:absolute;left:6px;top:4px;color:#fff;font:bold 18px monospace;background:#000a;padding:1px 5px}</style>${sheet.map(cell).join('')}`
  const { frameId } = (await page.send('Page.getFrameTree')).frameTree.frame.id ? { frameId: (await page.send('Page.getFrameTree')).frameTree.frame.id } : {}
  await page.send('Page.setDocumentContent', { frameId, html })
  await sleep(1500)
  const rows = Math.ceil(sheet.length / 3)
  const r = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1508, height: rows * 324, scale: 1 } })
  fs.writeFileSync(path.join(out, `ws-grid-${tag}-sheet.png`), Buffer.from(r.data, 'base64'))
  await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`)
  await cdp.send('Page.bringToFront')
  await sleep(500)
}

if (!SKIP.has('perf')) {
  const measure = async (extent, division, seconds = 8) => {
    await ev(`(() => { const w = window.__ws.getState(); w.setExtent(${extent}); w.setDivision(${division}) })()`)
    await look(10, 9, 12, 0, 0, 0)
    await sleep(1500)
    const a = await ev('({ ...window.__gl, t: performance.now() })')
    await sleep(seconds * 1000)
    const b = await ev('({ ...window.__gl, t: performance.now() })')
    const verts = await ev(`(() => { let n = 0, objs = 0; window.__benchScene.traverse((o) => { if (o.type === 'GridHelper' || o.name === 'bench-grid') { objs++; n += o.geometry.attributes.position.count } }); return { n, objs } })()`)
    const frames = b.frames - a.frames
    return { extent, division, gridObjects: verts.objs, gridVertices: verts.n, fps: Math.round(frames / ((b.t - a.t) / 1000)), drawsPerFrame: Math.round((b.draws - a.draws) / frames * 10) / 10, uploadBytesIdle: b.bufferBytes - a.bufferBytes }
  }
  report.perf.frames = []
  for (const [e, d] of [[8, 1], [8, 10], [8, 120], [64, 120]]) {
    const r = await measure(e, d)
    report.perf.frames.push(r)
    console.log('PERF', JSON.stringify(r))
  }
  await ev(`window.__ws.getState().setExtent(8)`)
  await sleep(500)
  const a = await ev('({ ...window.__gl })')
  const t0 = Date.now()
  for (let round = 0; round < 3; round++) for (const d of DIVISIONS) { await ev(`window.__ws.getState().setDivision(${d})`); await settle() }
  const b = await ev('({ ...window.__gl })')
  report.perf.step = { changes: 3 * DIVISIONS.length, bufferDataCalls: b.bufferData - a.bufferData, bufferBytes: b.bufferBytes - a.bufferBytes, buffersHeldDelta: b.buffers - a.buffers, ms: Date.now() - t0 }
  console.log('STEP', JSON.stringify(report.perf.step))
}

fs.writeFileSync(path.join(out, `ws-grid-${tag}.json`), JSON.stringify(report, null, 1))
const bad = [...report.spacing, ...report.taps].filter((r) => !r.ok)
console.log('RESULT', bad.length ? `FAILED ${bad.length}: ${JSON.stringify(bad.map((r) => r.division + (r.plane !== undefined ? '@' + r.plane : '')))}` : 'all ok')
shutdown(0)
