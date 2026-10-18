/**
 * tv-smoke.mjs: Cyberspace TV, end to end, offline (2026-10-18).
 *
 * Every relay is smoke-lib's in-process relay, seeded with a recorded tape
 * (a JSONL file of real public events, kinds 3333, 33330, 33331 and 1111, fetched
 * read-only), so the TV plays real history and nothing reaches a real relay.
 * LOCAL from the first frame; the run fails if the page sends any EVENT.
 *
 * Checks, at phone and desktop sizes: the menu's TV button puts the address
 * on /tv and turns the set on; a shot plays from v2's tape and the numbers
 * are read (what is painted on the tube is read from the store, since it is
 * pixels now); Escape and OFF turn it off and leave /tv. Screenshots go to
 * the out dir.
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
  .filter((e) => [3333, 33330, 33331, 1111].includes(e.kind))

const results = []
async function run(phone) {
  const size = phone ? 'phone' : 'desktop'
  const { browser, page, stats, errors } = await launch({ phone, url: base, seed })
  const check = (name, ok, note = '') => { results.push({ size, name, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'} ${size} ${name}${note ? `: ${note}` : ''}`) }
  try {
    const tv = (expr) => page.evaluate(async (expr) => { const m = await import('/src/store/useTv.ts'); return new Function('s', `return (${expr})`)(m.useTv.getState()) }, expr)
    const until = async (expr, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await tv(expr)) return true; await page.waitForTimeout(500) } return false }
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('canvas', { timeout: 60_000 })
    await page.waitForTimeout(4000)
    // CYBERSPACE TV is at the right of the question under the wordmark, in the menu.
    if (phone) await page.locator('.hamburger-menu').click()
    await page.locator('.ask-tv').click({ timeout: 15_000 })
    await page.waitForTimeout(500)
    check('button puts the address on /tv', new URL(page.url()).pathname === '/tv', page.url())
    check('the set is on', await tv('s.on'))
    check('a shot plays', await until("s.status === 'playing' && s.shot !== null", 60_000))
    const at = await tv('s.tapeTime')
    check('the tape is v2', typeof at === 'number' && at >= 1787455607, String(at))
    check('the numbers are read', await until('s.census !== null', 30_000))
    await page.waitForTimeout(3000)
    await page.screenshot({ path: path.join(out, `${size}-tv-1.png`) })
    await page.waitForTimeout(6000)
    await page.screenshot({ path: path.join(out, `${size}-tv-2.png`) })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    check('Escape turns it off', !(await tv('s.on')))
    check('and leaves /tv', new URL(page.url()).pathname !== '/tv', page.url())
    // Straight onto /tv, as a link or a screen left running would open it.
    await page.goto(`${base}/tv`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('canvas', { timeout: 60_000 })
    check('/tv opens straight onto the tape', await until("s.on && s.status === 'playing'", 60_000))
    await page.screenshot({ path: path.join(out, `${size}-direct.png`) })
    await page.locator('.tv__off').click()
    await page.waitForTimeout(500)
    check('OFF turns it off', !(await tv('s.on')))
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
