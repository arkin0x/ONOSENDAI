/**
 * walk-trace.mjs: measure WALK frame by frame, offline (2026-10-13).
 *
 * Drives the dev build (DEV hooks: window.__store, __walkBehind, and the
 * render-time probe in src/scene/WalkProbe.tsx) through a walk and writes
 * <out>/trace.json: per drawn frame, the eye's position against a fixed
 * world point, the camera quaternion, the shader link count, and what is
 * drawn near the eye at your head.
 *
 * Never on the wire: LOCAL before the first move (the run aborts otherwise),
 * every origin but localhost refused, and every WebSocket answered by an
 * empty in-process relay. Nothing can be published.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright \
 *   node scripts/walk-trace.mjs http://localhost:5199/ <out dir> [steps]
 * Env: KEYS=w,w,a (keys cycled), NODRAG=1, NOZOOM=1, GAP=<ms between presses>.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
const [url, out, steps = '30'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, hasTouch: false })
await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => r.abort())
const sent = []
await ctx.routeWebSocket(/.*/, (ws) => {
  if (/localhost|127\.0\.0\.1/.test(ws.url())) { ws.connectToServer(); return }
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]]))
    else if (m[0] === 'EVENT') { sent.push(m[1].kind); ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
})
const page = await ctx.newPage()
await page.addInitScript(() => {
  try { localStorage.setItem('onosendai:live', '0') } catch {}
  window.__longtasks = []
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longtasks.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true }) } catch {}
})
const logs = []
page.on('pageerror', (e) => { if (!/Failed to fetch/.test(e.message)) logs.push(`PAGEERROR: ${e.message}`) })
await page.goto(url, { waitUntil: 'load' }); await page.evaluate(() => { Error.stackTraceLimit = 80 })
await page.waitForTimeout(6000)
const live = await page.evaluate(() => window.__store.getState().live)
console.log('live =', live)
if (live !== false) { console.log('ABORT: not LOCAL'); await browser.close(); process.exit(2) }
const slot = () => page.locator('.touchops__commit').dispatchEvent('pointerdown')
await slot(); await page.waitForTimeout(300); await slot(); await page.waitForTimeout(1200)
console.log('walking', await page.evaluate(() => window.__store.getState().walking))
await page.keyboard.press('w'); await page.waitForTimeout(4000)
await page.evaluate(() => { window.__walkTrace = []; window.__drags = [] })
const canvas = await page.locator('canvas').first().boundingBox()
const cx = canvas.x + canvas.width / 2, cy = canvas.y + canvas.height * 0.35
const drag = async (dx) => {
  const t0 = await page.evaluate(() => performance.now())
  await page.mouse.move(cx, cy); await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(cx + (dx * i) / 6, cy, { steps: 1 })
  await page.mouse.up()
  // OrbitControls damping coasts after release: count the coast as the drag.
  await page.waitForTimeout(900)
  const t1 = await page.evaluate(() => performance.now())
  await page.evaluate(([a, b]) => window.__drags.push([a, b]), [t0, t1])
}
const keys = (process.env.KEYS ?? 'w,w,a,w,d,w,s,w,r,f').split(',')
const n = Number(steps)
for (let i = 0; i < n; i++) {
  if (!process.env.NOZOOM && i === Math.floor(n / 2)) { await page.keyboard.press('q'); await page.waitForTimeout(800); await page.keyboard.press('q'); await page.waitForTimeout(1500) }
  if (!process.env.NODRAG && i % 7 === 3) await drag(i % 2 ? 60 : -60)
  await page.keyboard.press(keys[i % keys.length])
  // Bursts and pauses: some landings mid-queue, some the catch-up.
  await page.waitForTimeout(i % 5 === 4 ? 2500 : Number(process.env.GAP ?? 90))
}
await page.waitForTimeout(8000)
const r = await page.evaluate(() => ({ links: window.__links, trace: window.__walkTrace, drags: window.__drags, longtasks: window.__longtasks, events: window.__store.getState().events.length, msg: window.__store.getState().proof.message, walking: window.__store.getState().walking }))
fs.writeFileSync(`${out}/trace.json`, JSON.stringify(r))
await page.screenshot({ path: `${out}/end.png` })
console.log('frames', r.trace.length, 'events', r.events, 'walking', r.walking, 'msg', r.msg, 'sent', JSON.stringify(sent))
console.log(logs.slice(0, 10).join('\n'))
await browser.close()
