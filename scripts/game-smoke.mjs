/**
 * game-smoke.mjs - the tutorial dungeon, LOCAL, in a real browser: enter the
 * game from cyberspace, walk its hall, take the pad, and exit back to exactly
 * the view you left (DECK-0002; first-arrival tutorial Track C).
 *
 *   node scripts/game-smoke.mjs http://localhost:5231 <screenshot dir> [desktop|phone]
 *
 * Nothing leaves this machine. Every request to an origin other than
 * localhost is aborted, GETs included. Every WebSocket to anywhere else is
 * answered by an in-process relay held in memory, so no socket ever reaches
 * the network. LOCAL (onosendai:live = 0) is set before the app loads and
 * checked before the first move, with the count of anything that tried to
 * leave. A throwaway key signs. The run fails if LIVE is on, or if any event
 * reaches even the in-process relay.
 */
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19, matchFilter } from 'nostr-tools'
import fs from 'node:fs'
import path from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5231'
const out = process.argv[3] ?? path.resolve('game-shots')
const device = process.argv[4] ?? 'desktop'
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const LOCAL = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:\d+)?\//
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const phone = device === 'phone'
const ctx = await browser.newContext(phone
  ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const stats = { aborted: 0, abortedSample: [], sockets: 0, eventsSent: 0 }
await ctx.route((u) => !LOCAL.test(u.toString()), (r) => {
  stats.aborted++
  if (stats.abortedSample.length < 8) stats.abortedSample.push(r.request().url().slice(0, 100))
  return r.abort()
})
const held = []
await ctx.routeWebSocket(/.*/, (ws) => {
  if (LOCAL.test(ws.url())) { ws.connectToServer(); return }
  stats.sockets++
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') {
      const [, id, ...filters] = m
      for (const f of filters) for (const ev of held.filter((e) => matchFilter(f, e))) ws.send(JSON.stringify(['EVENT', id, ev]))
      ws.send(JSON.stringify(['EOSE', id]))
    } else if (m[0] === 'EVENT') { stats.eventsSent++; held.push(m[1]); ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }
    else if (m[0] === 'AUTH') ws.send(JSON.stringify(['OK', m[1].id, true, '']))
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
})

const page = await ctx.newPage()
const sk = generateSecretKey()
const pk = getPublicKey(sk)
await page.addInitScript(([pk, ns]) => {
  localStorage.setItem('onosendai:live', '0')
  localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns }))
  localStorage.setItem('onosendai:workshop-intro', '1')
}, [pk, nip19.nsecEncode(sk)])
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
const store = (expr) => page.evaluate((expr) => (0, eval)(`(s) => ${expr}`)(window.__store.getState()), expr)
const game = (expr) => page.evaluate((expr) => (0, eval)(`(g) => ${expr}`)(window.__game.getState()), expr)
const waitFor = async (fn, ms, every = 250) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(every) } return false }
const shot = (name) => page.screenshot({ path: path.join(out, `${device}-${name}.png`) })
const fail = async (why) => { console.log(`FAIL ${why}`); console.log(JSON.stringify({ stats, errors: errors.slice(0, 5) })); await browser.close(); process.exit(1) }

page.setDefaultNavigationTimeout(120_000)
await page.goto(`${base}/?games=1`, { waitUntil: 'domcontentloaded' })
if (!await waitFor(() => page.locator('.touchops__commit').count().then((n) => n > 0), 90_000)) await fail('controls never appeared')
await sleep(3000)

// Before the first move: LOCAL, and nothing has left.
const live = await store('s.live')
console.log(`check before the first move: live=${live} aborted=${stats.aborted} sockets(in-process)=${stats.sockets} eventsSent=${stats.eventsSent}`)
if (live !== false) await fail('LIVE is on')
if (stats.eventsSent !== 0) await fail('an event reached the in-process relay')

// One hop, so the newcomer has a place on their chain to be held at.
const n0 = await store('s.events.length')
await page.keyboard.press('d'); await sleep(300)
await page.locator('.touchops__commit').first().dispatchEvent('pointerdown')
if (!await waitFor(() => store(`s.events.length > ${n0} && s.proof.status !== 'computing'`), 120_000)) await fail(`no hop landed: ${await store('s.proof.message')}`)
await sleep(2500)
const viewOf = () => store('JSON.stringify({ view: s.view, scaleExp: s.scaleExp, cursor: s.cursor, anchor: s.anchor, anchorPlane: s.anchorPlane, walking: s.walking, focus: s.focus, position: s.position, coord: s.coordHex() }, (k, v) => typeof v === "bigint" ? v.toString() : v)')
const before = await viewOf()
await shot('1-cyberspace-before')

// ENTER GAME (Track A's entry point).
const refused = await page.evaluate(() => window.__enterTutorialDungeon())
if (refused) await fail(`entry refused: ${refused}`)
if (!await waitFor(() => game('g.session && g.session.world !== null && g.session.at !== null && g.busy === null'), 30_000)) await fail('the world never loaded')
// Entering is the arrival (DECK-0002 §2.2): one event on the chain, and the player at the world's entry point.
const entryX = await game('g.session.at.x.toString()')
const afterEntry = await store('s.actions().slice(-1)[0].name')
if (afterEntry !== 'enter-virtual') await fail(`entering signed more than the entry: the head is ${afterEntry}`)
await sleep(2500)
await shot('2-in-game-start')

// Down the hall: forward faces cyberspace -Z at first.
for (let i = 0; i < 12; i++) { await page.keyboard.press('w'); await sleep(120) }
await sleep(1200)
await shot('3-in-game-hall')
// Until the pad takes you: chamber B has a pad of its own, back to the start.
for (let i = 0; i < 12 && !(await game(`g.busy || g.session.at.x.toString() !== "${entryX}"`)); i++) { await page.keyboard.press('w'); await sleep(120) }
if (!await waitFor(() => game(`g.busy === null && g.session && g.session.at.x.toString() !== "${entryX}"`), 15_000)) await fail(`the pad did not teleport: ${await game('g.message')} at ${await game('g.session && [g.session.at.x - g.session.game.region.base.x, g.session.at.y - g.session.game.region.base.y, g.session.at.z - g.session.game.region.base.z].join(",")')} busy=${await game('g.busy')}`)
await sleep(2000)
await shot('4-in-game-chamber-b')

// EXIT GAME.
await page.locator('.gameview__exit').click()
if (!await waitFor(() => game('g.session === null && g.busy === null'), 30_000)) await fail(`exit did not land: ${await game('g.message')}`)
await sleep(2500)
await shot('5-cyberspace-after')
const after = await viewOf()

const roles = await page.evaluate(async () => {
  const ev = await import('/src/lib/events.ts')
  const chain = window.__store.getState().actions()
  return { roles: chain.map((a) => `${a.role}:${a.name}`), broken: ev.firstBreak(chain) !== null }
})
console.log(`chain: ${roles.roles.join(' > ')}; broken=${roles.broken}`)
console.log(`view restored exactly: ${before === after}`)
if (before !== after) console.log(`before ${before}\nafter  ${after}`)
console.log(JSON.stringify({ stats, errors: errors.slice(0, 5) }))
await browser.close()
const ok = before === after && !roles.broken && stats.eventsSent === 0 && roles.roles.slice(-3).join(',') === 'enter:enter-virtual,virtual:teleport,exit:exit-virtual'
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
