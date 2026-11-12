/**
 * two-thumb-probe.mjs: VIEW's fly with two thumbs (arkinox, 2026-11-12: "If I
 * use my right thumb to drag the screen to rotate while my left thumb holds
 * the forward (or back) button, the camera kind of jerks around").
 *
 * Real multi-touch through the DevTools protocol (Input.dispatchTouchEvent),
 * so the browser does its own hit testing, pointer ids and pointer capture:
 * the left thumb lands on the Fly forward button and rests there with a
 * thumb's small wobble, the right thumb lands on open scene and drags
 * steadily to the right. The camera's yaw (window.__rig, a DEV hook) is read
 * every animation frame. A steady drag should turn the camera steadily, one
 * way; the jerk shows as large per-frame steps and turns back the other way.
 * The same drag with no thumb on the button is the baseline.
 *
 * Offline: every request to another origin is aborted, every relay socket
 * is answered in-process (EOSE, OK), LOCAL is set before the app loads.
 *
 * Usage: start a dev server (`npx vite --port 5287`), then
 *   PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright \
 *   node scripts/two-thumb-probe.mjs http://127.0.0.1:5287 [out.json]
 */
import fs from 'node:fs'
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const base = process.argv[2] ?? 'http://127.0.0.1:5287'
const outFile = process.argv[3]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
let aborted = 0
await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => { aborted++; return r.abort() })
await ctx.routeWebSocket(/.*/, (ws) => {
  if (/^wss?:\/\/(localhost|127\.0\.0\.1)/.test(ws.url())) { ws.connectToServer(); return }
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]]))
    else if (m[0] === 'EVENT') ws.send(JSON.stringify(['OK', m[1].id, true, '']))
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
})
const page = await ctx.newPage()
const sk = generateSecretKey()
await page.addInitScript(([pk, ns]) => {
  try {
    localStorage.setItem('onosendai:live', '0')
    localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns }))
  } catch { /* the app falls back */ }
}, [getPublicKey(sk), nip19.nsecEncode(sk)])
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const store = (expr) => page.evaluate((expr) => (0, eval)(`(s) => ${expr}`)(window.__store.getState()), expr)
const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(250) } return false }

await page.goto(base, { waitUntil: 'domcontentloaded' })
if (!await waitFor(() => page.locator('.touchops__commit').count().then((n) => n > 0), 90_000)) throw new Error('controls never appeared')
await sleep(3000)
if (await store('s.live') !== false) throw new Error('ABORT: not LOCAL')
// VIEW on: the commit button cycles HOP -> VIEW.
await page.locator('.touchops__commit').first().dispatchEvent('pointerdown')
if (!await waitFor(() => page.locator('.flyorb--fwd').count().then((n) => n > 0), 10_000)) throw new Error('VIEW (and its fly buttons) never came up')
await sleep(1500)

const cdp = await ctx.newCDPSession(page)
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) })
const btn = await page.locator('.flyorb--fwd').first().boundingBox()
const bx = btn.x + btn.width / 2, by = btn.y + btn.height / 2
// Open scene, right of centre and above the pad: what the hit test says is there.
const sx0 = 200, sy = 330
const onCanvas = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [sx0, sy])
const onButton = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.flyorb') !== null, [bx, by])
if (onCanvas !== 'CANVAS' || !onButton) throw new Error(`hit test: scene point is ${onCanvas}, button point on button: ${onButton}`)

/** One run: the right thumb drags `steps` frames of `dx` px; with `button`, the left thumb holds Fly forward and wobbles. */
async function run(button, steps = 70, dx = 3) {
  await page.evaluate(() => {
    const log = (window.__yawLog = [])
    const tick = () => {
      const r = window.__rig?.()
      if (r) {
        const [px, py, pz] = r.position, [tx, ty, tz] = r.target
        log.push({ t: performance.now(), yaw: Math.atan2(tx - px, tz - pz), pos: r.position, target: r.target, flying: window.__flying?.() ?? null })
      }
      if (window.__yawLog === log) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const left = { id: 1, x: bx, y: by }
  const right = { id: 2, x: sx0, y: sy }
  if (button) { await touch('touchStart', [left]); await sleep(120) }
  await touch('touchStart', button ? [left, right] : [right])
  await sleep(80)
  for (let i = 0; i < steps; i++) {
    right.x += dx
    // A resting thumb is never still: a pixel or two of wobble, every other frame.
    if (button && i % 2 === 0) { left.x = bx + (i % 4 === 0 ? 1.5 : -1.5); left.y = by + (i % 8 < 4 ? 1 : -1) }
    await touch('touchMove', button ? [left, right] : [right])
    await sleep(16)
  }
  await touch('touchEnd', button ? [left] : [])
  if (button) { await sleep(60); await touch('touchEnd', []) }
  await sleep(1200)
  const log = await page.evaluate(() => { const l = window.__yawLog; window.__yawLog = null; return l })
  // How far the camera itself moved each frame across its line of sight
  // (arkinox, 2026-11-12: "During flight, the center of orbit for the camera
  // should be the camera itself"): an orbit about the view's centre swings it
  // sideways by the orbit's radius times the turn; a turn in place does not,
  // and a fly moves it only along the line (plus the line's own turn between
  // samples, travel times turn). A fly's re-anchor shifts the whole render
  // frame by a field width at once, camera and world together: no motion, so
  // those frames (more than 10 units in one) are left out.
  let swing = 0, orbitWould = 0, travel = 0, reanchors = 0
  const swings = []
  for (let i = 1; i < log.length; i++) {
    const a = log[i - 1], b = log[i]
    const m = [0, 1, 2].map((k) => b.pos[k] - a.pos[k])
    const l = [0, 1, 2].map((k) => a.target[k] - a.pos[k])
    const ll = Math.hypot(...l) || 1
    const along = (m[0] * l[0] + m[1] * l[1] + m[2] * l[2]) / ll
    if (Math.hypot(...m) > 10) { reanchors++; continue }
    let turn = b.yaw - a.yaw
    if (turn > Math.PI) turn -= 2 * Math.PI
    if (turn < -Math.PI) turn += 2 * Math.PI
    const sw = Math.sqrt(Math.max(0, m[0] ** 2 + m[1] ** 2 + m[2] ** 2 - along * along))
    swing += sw
    orbitWould += ll * Math.abs(turn)
    swings.push(+sw.toFixed(4))
    travel += Math.abs(along)
  }
  const d = []
  for (let i = 1; i < log.length; i++) {
    let s = log[i].yaw - log[i - 1].yaw
    if (s > Math.PI) s -= 2 * Math.PI
    if (s < -Math.PI) s += 2 * Math.PI
    d.push(s)
  }
  const moving = d.filter((s) => Math.abs(s) > 1e-5)
  const main = Math.sign(moving.reduce((a, b) => a + b, 0)) || 1
  const reversals = moving.filter((s) => Math.sign(s) !== main && Math.abs(s) > 1e-3).length
  const maxStep = Math.max(0, ...moving.map(Math.abs))
  const total = d.reduce((a, b) => a + b, 0)
  const sorted = moving.map(Math.abs).sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  return { button, swings, frames: log.length, reanchors, sidewaysSwing: +swing.toFixed(3), orbitWouldSwing: +orbitWould.toFixed(3), alongTravel: +travel.toFixed(3), orbitRadius: +Math.hypot(...[0, 1, 2].map((k) => log[0].target[k] - log[0].pos[k])).toFixed(2), totalYawDeg: +(total * 180 / Math.PI).toFixed(2), maxStepDeg: +(maxStep * 180 / Math.PI).toFixed(3), medianStepDeg: +(median * 180 / Math.PI).toFixed(3), reversals, perFrameDeg: d.map((s) => +(s * 180 / Math.PI).toFixed(3)) }
}

const baseline = await run(false)
const twoThumb = await run(true)
const flewWhileHeld = await store('s.focus?.drive === true')
const result = { base, aborted, errors: errors.slice(0, 5), flewWhileHeld, baseline, twoThumb }
for (const r of [baseline, twoThumb]) console.log(`${r.button ? 'two thumbs ' : 'right only '} frames ${r.frames}  camera swung sideways ${r.sidewaysSwing} (an orbit about the centre: ${r.orbitWouldSwing}) and travelled ${r.alongTravel} along its line (radius ${r.orbitRadius}, ${r.reanchors} re-anchors left out)  total ${r.totalYawDeg} deg  max step ${r.maxStepDeg} deg  median step ${r.medianStepDeg} deg  turn-backs ${r.reversals}`)
if (errors.length) console.log('page errors:', errors.slice(0, 3))
if (outFile) fs.writeFileSync(outFile, JSON.stringify(result, null, 2))
await browser.close()
