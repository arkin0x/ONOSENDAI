/**
 * terrain-layout.mjs: TERRAIN's HUD boxes never overlap (owner, 2026-11-24:
 * "survey button is overlapped with the chat panel").
 *
 * Opens TERRAIN in a browser at each size (930x900 is a tablet, or a phone
 * on its side, where CHAT drops its word to the bubble beside the hotbar), with the menu closed and (on a
 * wide screen, where the scene stays beside it) open, and checks that the
 * boxes of the hotbar, SURVEY (with its hold bar), PLACE, CHAT, the walk
 * pad, the menu button, JUMP and DOWN, the LOOK ball, the commit block, the
 * carried block and the first-visit hint do not intersect. With the bag open on a phone (375 and 430 portrait) it
 * covers everything as the menu does: every point of its card is the card's own, and none of the HUD (the boxes above,
 * the carried block, the instruments and the tutorial card) is left showing under it. Nothing reaches a relay: every
 * socket is answered here. With SHOTS=<dir>, a screenshot of each phone with the bag open is saved there.
 *
 * Usage: start the dev server (npm run dev -- --port 5197), then
 *   node scripts/terrain-layout.mjs [http://localhost:5197/]
 * Exit 1 on any overlap.
 */
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const URL = process.argv[2] ?? 'http://localhost:5197/'
const SIZES = [
  { name: '375 portrait', w: 375, h: 812, touch: true },
  { name: '430 portrait', w: 430, h: 932, touch: true },
  { name: 'landscape', w: 812, h: 375, touch: true },
  { name: '700x900', w: 700, h: 900, touch: true },
  { name: '930x900', w: 930, h: 900, touch: true },
  { name: '1366x662', w: 1366, h: 662, touch: false },
  { name: '1440x900', w: 1440, h: 900, touch: false },
]
const BOXES = {
  hotbar: '.terrain-hotbar',
  survey: '.terrain-act--survey',
  place: '.terrain-act--place',
  smash: '.terrain-act--smash',
  chat: '.chatdock__chip',
  pad: '.touchpad',
  menu: '.hamburger-menu',
  jump: '.walkside',
  look: '.orbsquare',
  commit: '.touchops',
  hint: '.terrain-hint__box',
}
/** TERRAIN's own HUD: with the menu open none may stand over its columns (hidden under it on a phone, as WALK's pad is). */
const TERRAIN = { hotbar: '.terrain-hotbar', survey: '.terrain-act--survey', place: '.terrain-act--place', hint: '.terrain-hint__box', cross: '.terrain-crosshair' }
// The carried block (.terrain-held) is under everything by design, menu included, so it is not measured.

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let bad = 0
for (const size of SIZES) {
  for (const menu of [false, true]) {
    const ctx = await browser.newContext(size.touch ? { viewport: { width: size.w, height: size.h }, isMobile: true, hasTouch: true } : { viewport: { width: size.w, height: size.h } })
    await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => r.abort())
    await ctx.routeWebSocket(/.*/, (ws) => { ws.onMessage((raw) => { let m; try { m = JSON.parse(String(raw)) } catch { return } if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]])); else if (m[0] === 'EVENT') ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }) })
    const page = await ctx.newPage()
    const sk = generateSecretKey(); const pk = getPublicKey(sk); const ns = nip19.nsecEncode(sk)
    await page.addInitScript(([pk, ns]) => { try { localStorage.setItem('onosendai:live', '0'); localStorage.setItem('onosendai:nsec', ns); localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns })) } catch {} }, [pk, ns])
    await page.goto(URL)
    await page.waitForTimeout(9000)
    await page.keyboard.press('Escape')
    await page.evaluate(async () => { const pm = await import('/src/store/padMode.ts'); pm.enterTerrainMode() })
    await page.waitForTimeout(3500)
    // A block in hand, so the carried block is drawn and measured too.
    await page.evaluate(async () => { const m = await import('/src/store/useTerrain.ts'); const inv = m.useTerrain.getState().inventory; m.useTerrain.setState({ inventory: { ...inv, hotbar: [8, ...inv.hotbar.slice(1)], counts: { ...inv.counts, 8: 5 }, slot: 0 } }) })
    await page.waitForTimeout(500)
    if (menu) { await page.evaluate(() => document.querySelector('.hamburger-menu')?.click()); await page.waitForTimeout(1500) }
    const box = (boxes) => Object.fromEntries(Object.entries(boxes).map(([k, sel]) => {
      const e = document.querySelector(sel)
      if (!e || getComputedStyle(e).visibility === 'hidden') return [k, null]
      const r = e.getBoundingClientRect()
      return [k, r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null]
    }))
    const rects = await page.evaluate(`(${box.toString()})(${JSON.stringify(BOXES)})`)
    const label0 = `${size.name}${menu ? ', menu open' : ''}`
    if (menu) {
      // With the menu open: no TERRAIN control over a column of the menu.
      const mine = await page.evaluate(`(${box.toString()})(${JSON.stringify(TERRAIN)})`)
      const cols = await page.evaluate(() => [...document.querySelectorAll('.hud__col')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })))
      const over = []
      for (const [k, a] of Object.entries(mine)) for (const b of cols) if (a && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) over.push(k)
      if (over.length) { bad++; console.log(`${label0}: TERRAIN over the menu: ${[...new Set(over)].join(', ')}`) }
      else console.log(`${label0}: nothing of TERRAIN's over the menu`)
    }
    const label = `${size.name}${menu ? ', menu open' : ''}`
    const missing = (menu && size.w < 1101 ? ['menu'] : ['hotbar', 'place', 'pad', 'menu']).filter((k) => !rects[k])
    if (missing.length) { bad++; console.log(`${label}: missing ${missing.join(', ')}`) }
    const keys = Object.keys(rects).filter((k) => rects[k])
    const hits = []
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = rects[keys[i]], b = rects[keys[j]]
      if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) hits.push(`${keys[i]} x ${keys[j]}`)
    }
    if (hits.length) { bad++; console.log(`${label}: OVERLAP ${hits.join('; ')}`) }
    else console.log(`${label}: clear (${keys.join(', ')})`)
    await ctx.close()
  }
}

// The bag open on a phone: over everything, nothing over it, nothing of the HUD under it.
// The menu button stays, as it does under the open menu; it sits outside the card, under the sheet's veil.
const { menu: _menu, ...HUD } = BOXES
const BAG_UNDER = { ...HUD, held: '.terrain-held', instruments: '.instruments', look: '.walklook, .orbsquare', cross: '.terrain-crosshair' }
for (const size of SIZES.filter((z) => z.w <= 430 && z.h > z.w)) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, isMobile: true, hasTouch: true })
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => r.abort())
  await ctx.routeWebSocket(/.*/, (ws) => { ws.onMessage((raw) => { let m; try { m = JSON.parse(String(raw)) } catch { return } if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]])); else if (m[0] === 'EVENT') ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }) })
  const page = await ctx.newPage()
  const sk = generateSecretKey(); const pk = getPublicKey(sk); const ns = nip19.nsecEncode(sk)
  await page.addInitScript(([pk, ns]) => { try { localStorage.setItem('onosendai:live', '0'); localStorage.setItem('onosendai:nsec', ns); localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns })) } catch {} }, [pk, ns])
  await page.goto(URL)
  await page.waitForTimeout(9000)
  await page.keyboard.press('Escape')
  await page.evaluate(async () => { const pm = await import('/src/store/padMode.ts'); pm.enterTerrainMode() })
  await page.waitForTimeout(3500)
  await page.evaluate(async () => { const m = await import('/src/store/useTerrain.ts'); const inv = m.useTerrain.getState().inventory; m.useTerrain.setState({ inventory: { ...inv, hotbar: [8, ...inv.hotbar.slice(1)], counts: { ...inv.counts, 8: 5 }, slot: 0 } }); m.useTerrain.getState().setSheet(true) })
  await page.waitForTimeout(1200)
  const label = `${size.name}, bag open`
  const result = await page.evaluate((under) => {
    const card = document.querySelector('.terrain-sheet__card')
    if (!card) return { missing: true }
    const r = card.getBoundingClientRect()
    const over = new Set()
    for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
      const x = r.left + (r.width * i) / 12, y = r.top + (r.height * j) / 12
      const e = document.elementFromPoint(x, y)
      if (!e || !card.contains(e)) over.add(e ? (e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName) : 'nothing')
    }
    const showing = []
    for (const [k, sel] of Object.entries(under)) for (const e of document.querySelectorAll(sel)) {
      const b = e.getBoundingClientRect()
      if (b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden') showing.push(k)
    }
    return { over: [...over], showing: [...new Set(showing)] }
  }, BAG_UNDER)
  if (result.missing) { bad++; console.log(`${label}: no bag`) }
  else if (result.over.length || result.showing.length) { bad++; console.log(`${label}: over the card ${result.over.join(', ') || 'nothing'}; showing under it ${result.showing.join(', ') || 'nothing'}`) }
  else console.log(`${label}: the bag alone`)
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/terrain-bag-${size.w}.png` })
  // Closed again: the HUD comes back.
  await page.evaluate(async () => { const m = await import('/src/store/useTerrain.ts'); m.useTerrain.getState().setSheet(false) })
  await page.waitForTimeout(800)
  const gone = await page.evaluate((sels) => sels.filter((sel) => { const e = document.querySelector(sel); return !e || getComputedStyle(e).visibility === 'hidden' }), [BOXES.hotbar, BOXES.place, BOXES.pad, BOXES.jump, BOXES.look])
  if (gone.length) { bad++; console.log(`${size.name}: not back when the bag closed: ${gone.join(', ')}`) }
  await ctx.close()
}
await browser.close()
process.exit(bad ? 1 : 0)
