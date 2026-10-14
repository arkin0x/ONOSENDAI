/**
 * demo-shots.mjs: screenshots of the /demo tour, phone and desktop.
 *
 *   node scripts/demo-shots.mjs <base url> <out dir>
 *
 * A fresh throwaway identity, LOCAL from the first load, and fully offline:
 * every relay socket is answered by a stand-in here (REQ gets EOSE, EVENT
 * gets OK) and never reaches a real relay, and every non-local request that
 * is not a GET is refused. The canonical relay now asks for NIP-42 AUTH on
 * reads, so a real-relay run with AUTH dropped can never confirm a head and
 * the hop step could not be shown. The run makes one LOCAL hop on the
 * tour's hop step so the event panels have something real to show, then
 * photographs the steps.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const [base, out] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const dropped = { EVENT: 0, AUTH: 0 }
const errors = []

async function context(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
  await ctx.routeWebSocket(/.*/, (ws) => {
    if (/localhost|127\.0\.0\.1/.test(ws.url())) { ws.connectToServer(); return }
    // A stand-in relay: nothing is forwarded anywhere.
    ws.onMessage((raw) => {
      let m = null
      try { m = JSON.parse(String(raw)) } catch { return }
      if (!Array.isArray(m)) return
      if (m[0] === 'EVENT') { dropped.EVENT++; ws.send(JSON.stringify(['OK', m[1]?.id ?? '', true, ''])); return }
      if (m[0] === 'AUTH') { dropped.AUTH++; return }
      if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]]))
    })
  })
  await ctx.addInitScript(() => { try { localStorage.setItem('onosendai:live', '0') } catch {} })
  return ctx
}

async function shoot(page, step, name, wait = 4000) {
  await page.goto(`${base}/demo/${step}`, { waitUntil: 'load' })
  await page.waitForTimeout(wait)
  const live = await page.evaluate(() => window.__store?.getState().live)
  if (live !== false) throw new Error(`not LOCAL on ${step}: ${live}`)
  await page.screenshot({ path: `${out}/${name}.png` })
}

for (const [label, viewport] of [['phone', { width: 412, height: 900 }], ['desktop', { width: 1440, height: 900 }]]) {
  const ctx = await context(viewport)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  await shoot(page, '', `${label}-01-welcome`)
  // One LOCAL hop from the hop step: a cursor step, then Space (COMMIT).
  await shoot(page, 'hop', `${label}-05-hop`)
  await page.keyboard.press('KeyD')
  await page.keyboard.press('Space')
  await page.waitForFunction(() => window.__store.getState().events.length >= 2, null, { timeout: 120_000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/${label}-06-hop-done.png` })
  await shoot(page, 'event', `${label}-02-event`)
  await shoot(page, 'verify', `${label}-03-verify`)
  await shoot(page, 'kinds', `${label}-04-kinds`)
  await shoot(page, 'chain', `${label}-04b-chain`)
  await shoot(page, 'district', `${label}-07-district`, 8000)
  await shoot(page, 'port', `${label}-08-port`, 8000)
  await shoot(page, 'live', `${label}-09-live`)
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify({ dropped, errors: errors.slice(0, 10) }))
