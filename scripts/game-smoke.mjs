/**
 * game-smoke.mjs - the tutorial dungeon, LOCAL, in a real browser, start to
 * finish: enter the game from cyberspace, appear at its entry point, walk the
 * arrival hall to the pad, climb the rotunda in jumps with gravity on, land
 * on the top platform (which opens the key item's bag), TAKE the key item
 * into ITEMS, OPEN the gate (a DECK-0004 door) with it, reach the finish (in
 * the door's room) for the clear time, and exit back to exactly the view you
 * left, where ITEMS holds the key (DECK-0002, DECK-0004; first-arrival
 * tutorial Track C).
 * Walking uses the game's keys; each jump is pressed inside the page on its
 * own clock (JUMP, then the direction at set times), so a slow software
 * renderer cannot change where it lands.
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
/** The key items in ITEMS (store/useInventory), by name. */
const heldKeys = () => page.evaluate(async () => Object.values((await import('/src/store/useInventory.ts')).useInventory.getState().items).filter((i) => i.type === 'key').map((i) => i.name))
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

// ENTER GAME: the DEV game, whose world is the bundled fixture (?games=1 turns it on here). The live game reads its world
// from the relays, which this run never reaches.
const refused = await page.evaluate(async () => {
  const t = await import('/src/lib/games/tutorialGame.ts')
  return window.__game.getState().enter(t.tutorialGameFor(t.TUTORIAL_DEV_PUBKEY))
})
if (refused) await fail(`entry refused: ${refused}`)
if (!await waitFor(() => game('g.session && g.session.world !== null && g.session.at !== null && g.busy === null'), 30_000)) await fail('the world never loaded')
// Entering is the arrival (DECK-0002 §2.2): one event on the chain, and the player at the world's entry point.
const afterEntry = await store('s.actions().slice(-1)[0].name')
if (afterEntry !== 'enter-virtual') await fail(`entering signed more than the entry: the head is ${afterEntry}`)
const where = () => game('g.session && g.session.at && [g.session.at.x - g.session.game.region.base.x, g.session.at.y - g.session.game.region.base.y, g.session.at.z - g.session.game.region.base.z].join(",")')
const expectAt = async (want, what) => { const got = await where(); console.log(`${what}: ${got}`); if (got !== want) await fail(`${what}: at ${got}, not ${want}`) }
await sleep(2500)
await expectAt('8,17,45', 'the entry point')
await shot('2-arrival')

// Down the arrival hall with the game's keys (forward is cyberspace -Z at first) until the pad takes you.
for (let i = 0; i < 30 && !(await game('g.busy || (g.session.at.x - g.session.game.region.base.x) !== 8n')); i++) {
  await page.keyboard.press('w'); await sleep(130)
  if (i === 10) await shot('3-arrival-shrine')
}
if (!await waitFor(() => game('g.busy === null && g.session && (g.session.at.x - g.session.game.region.base.x) === 40n'), 15_000)) await fail(`the pad did not teleport: ${await game('g.message')} at ${await where()}`)
await sleep(2000)
await expectAt('40,17,45', 'after the pad')
await shot('4-climb')

/** Presses inside the page: `steps` is [[axis, dir, times]]; each press is a tick and a step, 120 ms apart. */
const walk = (steps) => page.evaluate(async (steps) => {
  const g = window.__game
  for (const [axis, dir, times] of steps) for (let i = 0; i < times; i++) { g.getState().tick(); g.getState().step(axis, dir); await new Promise((r) => setTimeout(r, 120)) }
  await new Promise((r) => setTimeout(r, 300))
}, steps)
/** A jump inside the page: JUMP, then `dir` along `axis` at each of `at` ms, then frames until it lands. */
const leap = (axis, dir, at) => page.evaluate(async ([axis, dir, at]) => {
  const g = window.__game
  const t0 = performance.now()
  g.getState().jump(t0)
  for (const t of at) {
    while (performance.now() - t0 < t) await new Promise((r) => setTimeout(r, 2))
    const now = performance.now()
    g.getState().tick(now)
    g.getState().step(axis, dir, now)
  }
  for (let i = 0; i < 300 && g.getState().session.arc; i++) { g.getState().tick(); await new Promise((r) => setTimeout(r, 16)) }
}, [axis, dir, at])

/** Drag to look, as a player does (GameView: yaw -= dx * 0.008): `dx` pixels across the canvas. */
const turn = async (dx) => {
  const box = await page.locator('.gameview__canvas').boundingBox()
  const y = box.y + box.height * 0.35, x0 = box.x + box.width / 2 - dx / 2
  await page.mouse.move(x0, y); await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + (dx * i) / 10, y)
  await page.mouse.up(); await sleep(900)
}
/** Half a turn: 180 degrees. */
const HALF = Math.round(Math.PI / 0.008)

// The climb: the first platform, 3 up.
await walk([['z', -1, 3], ['x', 1, 1]])
await expectAt('41,17,42', 'at the foot of the climb')
await leap('x', 1, [300, 410])
await expectAt('43,21,42', 'platform 1')
await walk([['z', -1, 2]])
await leap('z', -1, [200, 310])
await expectAt('43,24,38', 'platform 2')
await sleep(800)
await shot('5-platform-2')
await walk([['z', -1, 2], ['x', -1, 1]])
await leap('x', -1, [120, 230, 340])
await expectAt('39,24,36', 'platform 3')
await walk([['x', -1, 2], ['z', 1, 2]])
await leap('z', 1, [250, 360])
await expectAt('37,27,40', 'platform 4')
// Standing on the top platform opened the key item's bag (its region's key, derived here).
if (!await waitFor(() => game("g.session.keyBag === 'read' && g.session.keys.length === 1"), 10_000)) await fail(`the key bag did not open: ${await game('g.session.keyBag')} ${await game('g.message')}`)
await walk([['z', 1, 1]])
// Turn round to face the key (the camera follows from behind).
await turn(-HALF)
await sleep(1500)
// TAKE is offered by the key, and only taken by the tap.
if ((await heldKeys()).length) await fail('the key was taken without a tap')
if (!(await page.locator('.gameview__actbtn', { hasText: 'TAKE' }).count())) await fail('no TAKE by the key')
await shot('6-key')
await page.locator('.gameview__actbtn', { hasText: 'TAKE' }).click()
const heldNow = await heldKeys()
console.log(`ITEMS after TAKE: ${JSON.stringify(heldNow)}`)
if (heldNow.join() !== 'Tutorial Dungeon Key') await fail('TAKE did not put the key item in ITEMS')
await sleep(1000)
await shot('7-key-taken')
await turn(HALF)

// Off the platform, to the gate: LOCKED is gone, OPEN is the tap.
await walk([['x', -1, 3]])
await sleep(1500)
await expectAt('34,17,41', 'down on the floor')
await walk([['x', 1, 6], ['z', -1, 8]])
await expectAt('40,17,33', 'at the gate')
await sleep(800)
await shot('8-gate')
if (await game('g.session.progress.doorOpen')) await fail('the gate opened without a tap')
await page.locator('.gameview__actbtn', { hasText: 'OPEN' }).click()
if (!(await game('g.session.progress.doorOpen'))) await fail('OPEN did not open the gate')
// Its room, with the finish tile, read with the room key.
if (!await waitFor(() => game('g.session.room !== null && g.session.room.length === 1'), 10_000)) await fail(`the room did not come in: ${await game('g.message')}`)
await sleep(1500)
await shot('9-gate-open')

// Down the hall to the finish tile: the clock stops and the exit card shows the clear time.
await walk([['z', -1, 23]])
if (!await waitFor(() => game('g.session.progress.clearedMs !== null'), 5_000)) await fail(`no clear at ${await where()}`)
const clear = await page.locator('.gameview__cardtime').textContent()
console.log(`clear time on the exit card: ${clear}`)
await sleep(1000)
await shot('10-clear')

// EXIT GAME, from the exit card.
await page.locator('.gameview__card .gameview__exit').click()
if (!await waitFor(() => game('g.session === null && g.busy === null'), 30_000)) await fail(`exit did not land: ${await game('g.message')}`)
await sleep(2500)
await shot('11-cyberspace-after')
const after = await viewOf()
// The key item stays in ITEMS: open the ITEMS panel and show it.
const itemsTitle = page.locator('.panel__title, .panel h2, button, summary', { hasText: /^ITEMS$/ }).first()
if (await itemsTitle.count()) { await itemsTitle.click().catch(() => {}); await sleep(1200) }
await shot('12-items')
const heldKeysAfter = await heldKeys()
console.log(`ITEMS after leaving: ${JSON.stringify(heldKeysAfter)}`)

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
// On the chain: the entry, the pad's teleport, the exit. The key, the gate, the jumps and the clock are the game's, on the device.
const ok = before === after && !roles.broken && stats.eventsSent === 0 && roles.roles.slice(-3).join(',') === 'enter:enter-virtual,virtual:teleport,exit:exit-virtual' && !!clear && heldKeysAfter.join() === 'Tutorial Dungeon Key'
console.log(ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
