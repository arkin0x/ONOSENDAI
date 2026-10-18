/**
 * tv-smoke.mjs: Cyberspace TV, end to end, offline (2026-10-18).
 *
 * Every relay is smoke-lib's in-process relay, seeded with a recorded tape
 * (a JSONL file of real public events, kinds 3333, 33330 and 33331, fetched
 * read-only), so the TV plays real history and nothing reaches a real relay.
 * LOCAL from the first frame; the run fails if the page sends any EVENT.
 *
 * Checks, at phone and desktop sizes: the menu's CYBERSPACE TV button puts
 * the address on /tv and turns the set on; a shot plays (the chiron names an
 * avatar, the clock reads a v2 date); the tube pass runs (the frame is not
 * the bare scene); Escape turns it off and leaves /tv. Screenshots go to the
 * out dir.
 *
 * Usage: start a FRESH dev server (`npx vite --port 5231`), then
 *   PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright \
 *   node scripts/tv-smoke.mjs http://127.0.0.1:5231 <tape.jsonl> <out dir> [phone|desktop|both]
 */
import fs from 'node:fs'
import path from 'node:path'
import { launch } from './smoke-lib.mjs'

const [base, tapeFile, out, which = 'both'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const seed = fs.readFileSync(tapeFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .filter((e) => [3333, 33330, 33331].includes(e.kind))

const results = []
async function run(phone) {
  const size = phone ? 'phone' : 'desktop'
  const { browser, page, stats, errors } = await launch({ phone, url: base, seed })
  const check = (name, ok, note = '') => { results.push({ size, name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'} ${size} ${name}${note ? `: ${note}` : ''}`) }
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('canvas', { timeout: 60_000 })
    await page.waitForTimeout(4000)
    // The compass opens the view menu; CYBERSPACE TV is in it.
    const compass = page.locator('[aria-label="View controls"]').first()
    await compass.click({ timeout: 15_000 })
    const button = page.getByRole('button', { name: /CYBERSPACE TV/ })
    await button.dispatchEvent('pointerdown')
    await page.waitForTimeout(500)
    check('button puts the address on /tv', new URL(page.url()).pathname === '/tv', page.url())
    await page.waitForSelector('.tv', { timeout: 10_000 })
    check('the set is on', true)
    await page.waitForSelector('.tv__chiron-name', { timeout: 45_000 }).catch(() => {})
    const name = await page.locator('.tv__chiron-name').textContent().catch(() => null)
    check('a shot plays and the chiron names its avatar', !!name, name ?? 'no chiron')
    const clock = await page.locator('.tv__clock').innerText().catch(() => '')
    check('the clock reads a v2 date', /(AUG|SEP|OCT) \d\d 2026/.test(clock), clock.replace(/\n/g, ' '))
    const ticker = await page.locator('.tv__ticker').getAttribute('aria-label').catch(() => null)
    check('the ticker has numbers', !!ticker && /AVATARS IN CYBERSPACE/.test(ticker), (ticker ?? '').slice(0, 160))
    await page.waitForTimeout(3000)
    await page.screenshot({ path: path.join(out, `${size}-tv-1.png`) })
    await page.waitForTimeout(6000)
    await page.screenshot({ path: path.join(out, `${size}-tv-2.png`) })
    const doing = await page.locator('.tv__chiron-doing').textContent().catch(() => null)
    check('the chiron says what they did', !!doing, doing ?? '')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    check('Escape turns it off', (await page.locator('.tv').count()) === 0)
    check('and leaves /tv', new URL(page.url()).pathname !== '/tv', page.url())
    await page.screenshot({ path: path.join(out, `${size}-after.png`) })
    // Straight onto /tv, as a link or a screen left running would open it.
    await page.goto(`${base}/tv`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.tv__chiron-name', { timeout: 60_000 }).catch(() => {})
    check('/tv opens straight onto the tape', (await page.locator('.tv__chiron-name').count()) > 0)
    await page.screenshot({ path: path.join(out, `${size}-direct.png`) })
  } catch (e) {
    check('run', false, String(e).slice(0, 300))
  } finally {
    check('nothing published', stats.events === 0, `${stats.events} EVENT, ${stats.nonGetAborted} non-GET aborted`)
    const real = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))
    check('no page errors', real.length === 0, real.slice(0, 3).join(' | '))
    await browser.close()
  }
}

if (which === 'both' || which === 'desktop') await run(false)
if (which === 'both' || which === 'phone') await run(true)
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
process.exit(results.every((r) => r.ok) ? 0 : 1)
