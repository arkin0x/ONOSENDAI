/**
 * terrain-layout.mjs: TERRAIN's HUD boxes never overlap (owner, 2026-11-24:
 * "survey button is overlapped with the chat panel").
 *
 * Opens TERRAIN in a browser at each size, with the menu closed and (on a
 * wide screen, where the scene stays beside it) open, and checks that the
 * boxes of the hotbar, SURVEY (with its hold bar), PLACE, CHAT, the walk
 * pad, the menu button, JUMP and DOWN, the LOOK ball and the commit block
 * do not intersect. Nothing reaches a relay: every socket is answered here.
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
  { name: '1366x662', w: 1366, h: 662, touch: false },
  { name: '1440x900', w: 1440, h: 900, touch: false },
]
const BOXES = {
  hotbar: '.terrain-hotbar',
  survey: '.terrain-act--survey',
  place: '.terrain-act--place',
  chat: '.chatdock__chip',
  pad: '.touchpad',
  menu: '.hamburger-menu',
  jump: '.walkside',
  look: '.orbsquare',
  commit: '.touchops',
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let bad = 0
for (const size of SIZES) {
  for (const menu of size.w >= 1101 ? [false, true] : [false]) {
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
    if (menu) { await page.evaluate(() => document.querySelector('.hamburger-menu')?.click()); await page.waitForTimeout(1500) }
    const rects = await page.evaluate((boxes) => Object.fromEntries(Object.entries(boxes).map(([k, sel]) => {
      const e = document.querySelector(sel)
      if (!e) return [k, null]
      const r = e.getBoundingClientRect()
      return [k, r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null]
    })), BOXES)
    const label = `${size.name}${menu ? ', menu open' : ''}`
    const missing = ['hotbar', 'place', 'pad', 'menu'].filter((k) => !rects[k])
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
await browser.close()
process.exit(bad ? 1 : 0)
