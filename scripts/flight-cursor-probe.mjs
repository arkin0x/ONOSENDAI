/**
 * flight-cursor-probe.mjs: where the VIEW cursor lands after a flight
 * (arkinox, 2026-11-12: "when I fly in View mode, I expect the cursor to
 * appear directly in front of me or right around where the camera is. it
 * tends to appear at the same distance from the camera that it was before
 * the flight").
 *
 * VIEW on, the Fly forward button held by a real touch (the DevTools
 * protocol's Input.dispatchTouchEvent) for HOLD_MS, then let go. Every
 * animation frame logs the camera and what it orbits (window.__rig, a DEV
 * hook) and the cursor as drawn (the store's cursorOffset). Reports the
 * camera-to-cursor and camera-to-target distances before the flight and once
 * the cursor has landed, how long the landing took after letting go, and
 * the camera's largest move in one frame after the coast stopped (a jump).
 *
 * Offline: every request to another origin is aborted, every relay socket
 * is answered in-process (EOSE, OK), LOCAL is set before the app loads.
 *
 * Usage: start a dev server (`npx vite --port 5291`), then
 *   PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright \
 *   node scripts/flight-cursor-probe.mjs http://127.0.0.1:5291 [HOLD_MS] [out.json]
 */
import fs from 'node:fs'
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const base = process.argv[2] ?? 'http://127.0.0.1:5291'
const holdMs = Number(process.argv[3] ?? 3000)
const outFile = process.argv[4]
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
const thumb = { id: 1, x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 }

await page.evaluate(() => {
  const log = (window.__flightLog = [])
  const tick = () => {
    const r = window.__rig?.()
    const s = window.__store.getState()
    if (r) log.push({ t: performance.now(), pos: r.position, target: r.target, cursor: s.cursorOffset(), key: `${s.cursor.x},${s.cursor.y},${s.cursor.z}` })
    if (window.__flightLog === log) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
await sleep(300)
const cursorBefore = await store('`${s.cursor.x},${s.cursor.y},${s.cursor.z}`')
const tDown = await page.evaluate(() => performance.now())
await touch('touchStart', [thumb])
await sleep(holdMs)
await touch('touchEnd', [])
const tUp = await page.evaluate(() => performance.now())
await sleep(4000)
const log = await page.evaluate(() => { const l = window.__flightLog; window.__flightLog = null; return l })

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const first = log.find((e) => e.t >= tDown - 200) ?? log[0]
const last = log[log.length - 1]
const landedAt = log.find((e) => e.t > tUp && e.key !== cursorBefore)
// The camera's travel per frame, after it stopped (its speed under 1e-3 a frame) and before the end.
let stopIdx = -1
for (let i = 1; i < log.length; i++) if (log[i].t > tUp && dist(log[i].pos, log[i - 1].pos) < 1e-3) { stopIdx = i; break }
let jumpAfterStop = 0
let reanchors = 0
for (let i = Math.max(1, stopIdx + 1); stopIdx > 0 && i < log.length; i++) {
  const m = dist(log[i].pos, log[i - 1].pos)
  // A re-anchor shifts camera and world together by a field width: not motion.
  if (m > 10) { reanchors++; continue }
  jumpAfterStop = Math.max(jumpAfterStop, m)
}
const lookAt = (e) => { const l = [0, 1, 2].map((k) => e.target[k] - e.pos[k]); const n = Math.hypot(...l) || 1; return l.map((v) => v / n) }
const ahead = (e) => { const l = lookAt(e); const c = [0, 1, 2].map((k) => e.cursor[k] - e.pos[k]); return l[0] * c[0] + l[1] * c[1] + l[2] * c[2] }
const result = {
  base, holdMs, aborted, errors: errors.slice(0, 5), frames: log.length,
  before: { cameraToCursor: +dist(first.pos, first.cursor).toFixed(3), cameraToTarget: +dist(first.pos, first.target).toFixed(3) },
  landed: landedAt ? +(landedAt.t - tUp).toFixed(0) : null,
  after: { cameraToCursor: +dist(last.pos, last.cursor).toFixed(3), cursorAheadAlongLook: +ahead(last).toFixed(3), cameraToTarget: +dist(last.pos, last.target).toFixed(3) },
  stoppedAfterLetGoMs: stopIdx > 0 ? +(log[stopIdx].t - tUp).toFixed(0) : null,
  largestCameraMoveInOneFrameAfterStop: +jumpAfterStop.toFixed(6),
  reanchorsAfterStop: reanchors,
}
console.log(JSON.stringify(result, null, 2))
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ ...result, log }, null, 2))
await browser.close()
