/**
 * tv-announce-smoke.mjs: Cyberspace TV's UPGRADE ANNOUNCEMENT over nostr,
 * end to end, offline (2026-11-12).
 *
 * The in-process relay holds a recorded tape (JSONL of real public kind 3333
 * events, fetched read-only) and three announcements: one signed by the
 * announcer (version 2.1, an hour old), one forged (version 9.9: another
 * key's signature under the announcer's pubkey) and one by another author
 * (9.8). Tests cannot sign as the pinned announcer, so a throwaway key
 * stands in for it: the dev server's lib/tv/announceFeed module is rewritten
 * on its way to the page to pin the throwaway key's hex instead (nothing in
 * the app changes for it).
 *
 * Checks: /tv plays 2.1 once; the forged and foreign ones never play nor
 * count; the marquee reads ONOSENDAI VERSION <the build's simple version>
 * and 1 UPDATE THIS WEEK; a reload does not play 2.1 again; the menu footer
 * shows VERSION <x>. Every request to another origin is aborted (GETs too),
 * every WebSocket is the in-process relay, and the run fails if the page
 * publishes anything but TV's watching pings.
 *
 * Usage: start a FRESH dev server (`npx vite --port 5241`), then
 *   PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright \
 *   node scripts/tv-announce-smoke.mjs http://127.0.0.1:5241 <tape.jsonl> <out dir>
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { finalizeEvent, generateSecretKey, getPublicKey, matchFilter } from 'nostr-tools'

const [base, tapeFile, out] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const PINNED = '875c8eb956f51e1458366a9606e46632e51f5ea665c5fc158360a089256167f3'
const LOCAL = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:\d+)?\//
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const announcerSk = generateSecretKey()
const announcer = getPublicKey(announcerSk)
const otherSk = generateSecretKey()
const now = Math.floor(Date.now() / 1000)
const note = (version, text, sk, at = now - 3600) => finalizeEvent({
  kind: 33338, created_at: at, content: text,
  tags: [['d', version], ['t', 'onosendai-upgrade'], ['published_at', String(at)], ['alt', `ONOSENDAI version ${version}`]],
}, sk)
const good = note('2.1', 'Cyberspace TV now tells you when ONOSENDAI gets a new version, right here, once.\n\nThe words print a page at a time, then TV picks up where it left off.', announcerSk)
const forged = { ...note('9.9', 'FORGED: this must never play.', otherSk), pubkey: announcer }
const foreign = note('9.8', 'Someone else: this must never play.', otherSk)
const tape = fs.readFileSync(tapeFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 3333)
const held = [...tape, good, forged, foreign]

const results = []
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? `: ${extra}` : ''}`) }

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
const stats = { aborted: 0, sockets: 0, events: 0, kinds: {}, rewritten: 0 }
await ctx.route((u) => !LOCAL.test(u.toString()), (r) => { stats.aborted++; return r.abort() })
await ctx.route(/\/src\/lib\/tv\/announceFeed\.ts/, async (r) => {
  const res = await r.fetch()
  const body = await res.text()
  if (body.includes(PINNED)) stats.rewritten++
  await r.fulfill({ response: res, body: body.split(PINNED).join(announcer) })
})
await ctx.routeWebSocket(/.*/, (ws) => {
  if (LOCAL.test(ws.url())) { ws.connectToServer(); return }
  stats.sockets++
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') {
      const [, id, ...filters] = m
      for (const f of filters) for (const ev of held.filter((e) => matchFilter(f, e)).sort((a, b) => b.created_at - a.created_at).slice(0, f.limit ?? 500)) ws.send(JSON.stringify(['EVENT', id, ev]))
      ws.send(JSON.stringify(['EOSE', id]))
    } else if (m[0] === 'EVENT') {
      stats.events++; stats.kinds[m[1].kind] = (stats.kinds[m[1].kind] ?? 0) + 1
      ws.send(JSON.stringify(['OK', m[1].id, true, '']))
    } else if (m[0] === 'AUTH') ws.send(JSON.stringify(['OK', m[1].id, true, '']))
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
})
const page = await ctx.newPage()
// TV picks a random start across all of v2; the recorded tape covers a day or two, so start it inside the tape
// (the start picked ahead, store/useTv NEXT_START_KEY), on every load.
const starts = tape.map((e) => e.created_at).sort((a, b) => a - b)
const startAt = starts[Math.floor(starts.length / 3)]
await page.addInitScript((t) => { try { localStorage.setItem('onosendai:live', '0'); localStorage.setItem('onosendai:tvNextStart', String(t)) } catch {} }, startAt)
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const announceState = () => page.evaluate(async () => {
  const m = await import('/src/store/useTvAnnounce.ts')
  const s = m.useTvAnnounce.getState()
  return { showing: s.showing?.plan.version ?? null, updates: s.updatesThisWeek, announced: s.announcedVersion, shows: window.__shows ?? [] }
})
const ticker = () => page.evaluate(async () => {
  const a = await import('/src/store/useTvAnnounce.ts')
  const u = await import('/src/lib/tv/upgradeAnnounce.ts')
  const v = await import('/src/lib/version.ts')
  const s = a.useTvAnnounce.getState()
  return { items: u.releaseTicker(v.higherVersion(u.appVersion(), s.announcedVersion), s.updatesThisWeek), app: u.appVersion() }
})
// Every announcement that comes on screen, counted in the page.
const countShows = () => page.evaluate(async () => {
  const m = await import('/src/store/useTvAnnounce.ts')
  window.__shows = []
  m.useTvAnnounce.subscribe((s, p) => { if (s.showing && s.showing !== p.showing) window.__shows.push(s.showing.plan.version) })
})
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(400) } return false }
const tvPlaying = () => page.evaluate(async () => { const m = await import('/src/store/useTv.ts'); const s = m.useTv.getState(); return s.on && s.status === 'playing' && s.shot !== null })

try {
  page.setDefaultNavigationTimeout(120_000)
  await page.goto(`${base}/tv`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 90_000 })
  await countShows()
  check('the announcer\'s pin was swapped for the throwaway key in the dev module', stats.rewritten > 0)
  check('a shot plays', await until(tvPlaying, 90_000))
  check('the announcement comes on', await until(async () => (await announceState()).showing === '2.1', 30_000))
  await sleep(1500)
  await page.screenshot({ path: path.join(out, 'tv-transport-1-title.png') })
  await sleep(4500)
  await page.screenshot({ path: path.join(out, 'tv-transport-2-page.png') })
  check('it ends', await until(async () => {
    const s = await announceState()
    if (s.showing === null) return true
    return false
  }, 60_000))
  // The welcome screen is the last few seconds: one shot taken on the way out above may have it; take the marquee now.
  const st = await announceState()
  check('it played once, and only 2.1', JSON.stringify(st.shows) === '["2.1"]', JSON.stringify(st.shows))
  check('the forged and foreign ones are not counted', st.updates === 1 && st.announced === '2.1', JSON.stringify(st))
  const t = await ticker()
  check('the marquee reads the simple version and 1 UPDATE THIS WEEK', JSON.stringify(t.items) === JSON.stringify([`ONOSENDAI VERSION ${t.app}`, '1 UPDATE THIS WEEK']), JSON.stringify(t))
  for (let i = 0; i < 4; i++) { await sleep(3000); await page.screenshot({ path: path.join(out, `tv-transport-3-marquee-${i}.png`) }) }
  const played = await page.evaluate(() => localStorage.getItem('onosendai:tvAnnouncePlayed'))
  check('2.1 is remembered as played on the device', /"2\.1"/.test(played ?? ''), played ?? 'none')

  // A reload: the page's memory gone, the device's kept.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 90_000 })
  await countShows()
  check('after a reload a shot plays', await until(tvPlaying, 90_000))
  await sleep(12_000)
  const again = await announceState()
  check('after a reload 2.1 does not play again, and still counts', again.shows.length === 0 && again.showing === null && again.updates === 1, JSON.stringify(again))

  // The menu footer.
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.hud__version', { timeout: 90_000, state: 'attached' })
  await sleep(3000)
  const foot = page.locator('.hud__version')
  await foot.scrollIntoViewIfNeeded().catch(() => {})
  const text = (await foot.textContent())?.trim()
  const title = await foot.getAttribute('title')
  check('the menu footer shows VERSION <x>, the build stamp in its title', /^VERSION \d+\.\d+(\.\d+)?$/.test(text ?? '') && /^build /.test(title ?? ''), `${text} | ${title}`)
  const box = await page.locator('.hud__col--right').boundingBox()
  const fb = await foot.boundingBox()
  if (box && fb) {
    const y = Math.max(0, fb.y - 120)
    await page.screenshot({ path: path.join(out, 'tv-transport-4-menu-footer.png'), clip: { x: box.x, y, width: box.width, height: Math.min(720 - y, fb.y + fb.height + 20 - y) } })
  }
  await page.screenshot({ path: path.join(out, 'tv-transport-5-menu-full.png') })
} catch (e) {
  check('run', false, String(e).slice(0, 300))
} finally {
  const pings = stats.kinds[23334] ?? 0
  check('nothing published but watching pings', stats.events === pings, `${stats.events} EVENT (${pings} pings); ${stats.aborted} requests to other origins aborted`)
  const real = errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))
  check('no page errors', real.length === 0, real.slice(0, 3).join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(failed ? `${failed} FAILED` : 'ALL PASS')
  process.exit(failed ? 1 : 0)
}
