/**
 * walk-layout.mjs: WALK's and TERRAIN's controls in a real browser at every size (owner, 2026-11-28: the stick on the
 * left, "Gravity button can move to the right side above down/jump. Make the down and jump buttons slightly higher so
 * there is space between them and the mode buttons ... make them larger and round, like a game controller, and angle
 * them for comfort (down button slightly lower than jump)").
 *
 * In WALK and in TERRAIN, at each size, it measures the stick's resting place (the walk pad's box), the stick's zone,
 * GRAVITY, JUMP, DOWN, the LOOK ball, the commit block (WALK or TERRAIN, the mode, LOCAL and LIVE), the menu button,
 * CHAT and TERRAIN's tools (PLACE, SMASH, the ghost block's stepper, SURVEY's slot) and hotbar, and checks:
 *
 * | Check | Rule |
 * |---|---|
 * | no overlap | no two controls' boxes intersect (the zone is under the walk pad's box by design, so those two are not compared) |
 * | the zone | it touches none of the right-hand controls, the LOOK ball, the commit block, TERRAIN's tools or the hotbar |
 * | the order | from the bottom: the commit block, GRAVITY directly over it (8px or less; in TERRAIN on a phone held upright the hotbar row stands between, and GRAVITY is directly over that), then 24px or more, then JUMP and DOWN (owner, 2026-11-28: "The gravity button should go directly above the mode buttons and then have a gap between it and the jump and down buttons") |
 * | the arc | DOWN lower than JUMP and further out (right), JUMP and DOWN round and not touching |
 * | a mouse | no zone; the walk pad's box prints W A S D |
 *
 * On a touch screen it also drives the stick with real touches (Input.dispatchTouchEvent, so the browser does its own
 * hit testing and pointer capture): a finger landing at the zone's far left walks nothing, a drag up walks forward, a
 * second finger on JUMP while the stick is held jumps without letting the stick go, and the lift stops the walk.
 *
 * Nothing reaches a relay: every socket is answered here. With SHOTS=<dir>, screenshots at 390x844 and 844x390 (at rest
 * and with the stick held); with VIDEO=<dir>, a short recording of the stick in use at both.
 *
 * Usage: start the dev server (npx vite --port 5363), then
 *   node scripts/walk-layout.mjs [http://localhost:5363/]
 * Exit 1 on any failure.
 */
import fs from 'node:fs'
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const URL = process.argv[2] ?? 'http://localhost:5363/'
const SHOTS = process.env.SHOTS
const VIDEO = process.env.VIDEO
const ONLY = process.env.ONLY
const SIZES = [
  { name: '375x667', w: 375, h: 667, touch: true },
  { name: '390x844', w: 390, h: 844, touch: true },
  { name: '430x932', w: 430, h: 932, touch: true },
  { name: '667x375', w: 667, h: 375, touch: true },
  { name: '844x390', w: 844, h: 390, touch: true },
  { name: '932x430', w: 932, h: 430, touch: true },
  { name: '820x1180', w: 820, h: 1180, touch: true },
  { name: '1366x662 mouse', w: 1366, h: 662, touch: false },
  { name: '1440x900 mouse', w: 1440, h: 900, touch: false },
].filter((z) => !ONLY || ONLY.split(',').includes(z.name))
const BOXES = {
  home: '.touchpad--mode-walk',
  gravity: '.walkside .touchpad__key--gravity',
  jump: '.walkside .touchpad__key--jump',
  down: '.walkside .touchpad__key--down',
  look: '.orbsquare',
  commit: '.touchops',
  menu: '.hamburger-menu',
  chat: '.chatdock__chip',
  place: '.terrain-act--place',
  smash: '.terrain-tools__slot--smash',
  air: '.terrain-tools__slot--air',
  survey: '.terrain-tools__slot--survey',
  hotbar: '.terrain-hotbar',
}
const ZONE = '.walkstick'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const meet = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

function measure(sels) {
  return Object.fromEntries(Object.entries(sels).map(([k, sel]) => {
    const e = document.querySelector(sel)
    if (!e || getComputedStyle(e).visibility === 'hidden') return [k, null]
    const r = e.getBoundingClientRect()
    return [k, r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom, radius: getComputedStyle(e).borderTopLeftRadius } : null]
  }))
}

async function open(browser, size, mode, video) {
  const opts = size.touch ? { viewport: { width: size.w, height: size.h }, isMobile: true, hasTouch: true } : { viewport: { width: size.w, height: size.h } }
  if (video) opts.recordVideo = { dir: video, size: { width: size.w, height: size.h } }
  const ctx = await browser.newContext(opts)
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => r.abort())
  await ctx.routeWebSocket(/.*/, (ws) => {
    if (/^wss?:\/\/(localhost|127\.0\.0\.1)/.test(ws.url())) { ws.connectToServer(); return }
    ws.onMessage((raw) => { let m; try { m = JSON.parse(String(raw)) } catch { return } if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]])); else if (m[0] === 'EVENT') ws.send(JSON.stringify(['OK', m[1].id, true, ''])) })
  })
  const page = await ctx.newPage()
  const sk = generateSecretKey(); const pk = getPublicKey(sk); const ns = nip19.nsecEncode(sk)
  await page.addInitScript(([pk, ns]) => { try { localStorage.setItem('onosendai:live', '0'); localStorage.setItem('onosendai:nsec', ns); localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns })) } catch {} }, [pk, ns])
  await page.goto(URL)
  // The controls up (a loaded machine takes longer), then a moment for the scene.
  await page.waitForSelector('.touchops', { timeout: 90000 }).catch(() => {})
  await page.waitForTimeout(4000)
  await page.keyboard.press('Escape')
  await page.evaluate(async ({ mode, touch }) => {
    const f = await import('/src/hooks/useFingerInput.ts')
    f.setFingerInput(touch)
    if (mode === 'terrain') { const pm = await import('/src/store/padMode.ts'); pm.enterTerrainMode() }
    else { const w = await import('/src/store/useWalk.ts'); w.useWalk.getState().enter() }
  }, { mode, touch: size.touch })
  await page.waitForTimeout(3000)
  if (mode === 'terrain') await page.addStyleTag({ content: '.terrainview:not(.is-covered):not(.is-folded):not(.is-bag) .terrain-tools__slot--air.is-off { visibility: visible !important; }' })
  await page.waitForTimeout(300)
  return { ctx, page }
}

/** Real touches: `points` is [{ id, x, y }], `type` touchStart, touchMove or touchEnd. */
async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) })
}

const cursorOf = (page) => page.evaluate(async () => { const m = await import('/src/store/useCyberspace.ts'); const c = m.useCyberspace.getState().cursor; return [String(c.x), String(c.y), String(c.z)] })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let bad = 0
const fail = (msg) => { bad++; console.log(`FAIL ${msg}`) }

for (const size of SIZES) {
  for (const mode of ['walk', 'terrain']) {
    const label = `${size.name} ${mode.toUpperCase()}`
    const { ctx, page } = await open(browser, size, mode)
    const r = await page.evaluate(`(${measure.toString()})(${JSON.stringify(BOXES)})`)
    const zone = (await page.evaluate(`(${measure.toString()})(${JSON.stringify({ zone: ZONE })})`)).zone
    const keys = Object.keys(r).filter((k) => r[k])
    const must = ['home', 'gravity', 'jump', 'down', 'look', 'commit', 'menu', ...(mode === 'terrain' ? ['place', 'smash', 'air', 'hotbar'] : [])]
    const missing = must.filter((k) => !r[k])
    if (missing.length) fail(`${label}: missing ${missing.join(', ')}`)
    const hits = []
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (meet(r[keys[i]], r[keys[j]])) hits.push(`${keys[i]} x ${keys[j]}`)
    if (hits.length) fail(`${label}: OVERLAP ${hits.join('; ')}`)
    if (size.touch) {
      if (!zone) fail(`${label}: no stick zone on a touch screen`)
      const under = ['gravity', 'jump', 'down', 'look', 'commit', 'place', 'smash', 'air', 'survey', 'hotbar'].filter((k) => meet(zone, r[k]))
      if (under.length) fail(`${label}: the zone reaches ${under.join(', ')}`)
      // Nothing a finger could press is left under the zone: every control over it stands above it.
      const buried = await page.evaluate((sel) => {
        const z = document.querySelector(sel)
        if (!z) return []
        const b = z.getBoundingClientRect()
        const out = new Set()
        for (let i = 1; i < 16; i++) for (let k = 1; k < 16; k++) {
          const x = b.left + (b.width * i) / 16, y = b.top + (b.height * k) / 16
          const stack = document.elementsFromPoint(x, y)
          const at = stack.indexOf(z)
          for (const e of stack.slice(at + 1)) {
            const c = e.closest('button, a, input, [role="button"], [role="slider"]')
            if (c && !z.contains(c) && getComputedStyle(c).visibility !== 'hidden') out.add((c.className && typeof c.className === 'string' ? c.className.split(' ')[0] : c.tagName))
          }
        }
        return [...out]
      }, ZONE)
      if (buried.length) fail(`${label}: under the zone: ${buried.join(', ')}`)
      if (zone && r.home && !(zone.l <= r.home.l && zone.r >= r.home.r && zone.b >= r.home.b && zone.t <= r.home.t)) fail(`${label}: the zone does not cover the resting ring`)
    } else {
      if (zone) fail(`${label}: a stick zone with a mouse`)
      const caps = await page.locator('.walkstick-home--keys .walkstick-home__cap').count()
      if (caps !== 4) fail(`${label}: W A S D not printed (${caps})`)
    }
    const { jump: j, down: d, gravity: g, commit: c, hotbar: hb } = r
    if (j && d && c && g) {
      // GRAVITY directly over the commit block, or over the hotbar where the hotbar row stands between them.
      const under = hb && hb.t < c.t && hb.l < g.r && g.l < hb.r ? hb : c
      const sit = under.t - g.b
      if (sit < 2 || sit > 8) fail(`${label}: GRAVITY ${sit.toFixed(1)}px over the ${under === hb ? 'hotbar' : 'commit block'}, not directly over it`)
      if (!(g.l >= c.l - 1 && g.r <= c.r + 1)) fail(`${label}: GRAVITY not in the commit block's column`)
      const gap = g.t - Math.max(j.b, d.b)
      if (gap < 24) fail(`${label}: JUMP and DOWN only ${gap.toFixed(1)}px over GRAVITY`)
      if (!(d.b > j.b)) fail(`${label}: DOWN not lower than JUMP`)
      if (!(d.r > j.r)) fail(`${label}: DOWN not outboard of JUMP`)
      if (j.radius !== '50%' && parseFloat(j.radius) < (j.r - j.l) / 2 - 1) fail(`${label}: JUMP not round (${j.radius})`)
      const jr = (j.r - j.l) / 2, dr = (d.r - d.l) / 2
      const apart = Math.hypot((j.l + jr) - (d.l + dr), (j.t + jr) - (d.t + dr)) - jr - dr
      if (apart < 6) fail(`${label}: JUMP and DOWN ${apart.toFixed(1)}px apart`)
      if (!bad) console.log(`${label}: clear; GRAVITY ${sit.toFixed(0)}px over the ${under === hb ? 'hotbar' : 'commit block'}, JUMP and DOWN ${gap.toFixed(0)}px over GRAVITY, DOWN ${(d.b - j.b).toFixed(0)}px lower, ${apart.toFixed(0)}px apart; JUMP ${(j.r - j.l).toFixed(0)}px, DOWN ${(d.r - d.l).toFixed(0)}px`)
    }
    if (SHOTS && ['390x844', '844x390', '1440x900 mouse'].includes(size.name)) {
      fs.mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: `${SHOTS}/${mode}-${size.w}x${size.h}-rest.png` })
    }
    if (size.touch && zone && r.home) {
      // The stick with real touches.
      const cdp = await ctx.newCDPSession(page)
      const x0 = zone.l + 6, y0 = (r.home.t + r.home.b) / 2
      const before = await cursorOf(page)
      await touch(cdp, 'touchStart', [{ id: 1, x: x0, y: y0 }])
      await sleep(500)
      const rested = await cursorOf(page)
      if (rested.join() !== before.join()) fail(`${label}: a finger landing at the far left walked (${before} to ${rested})`)
      for (let k = 1; k <= 6; k++) { await touch(cdp, 'touchMove', [{ id: 1, x: x0, y: y0 - k * 10 }]); await sleep(30) }
      await sleep(700)
      const walked = await cursorOf(page)
      if (walked.join() === before.join()) fail(`${label}: a drag up walked nothing`)
      const held = await page.evaluate(() => document.querySelector('.walkstick__base')?.classList.contains('is-on'))
      if (!held) fail(`${label}: the ring is not drawn while held`)
      // A STOP (a step that did not land, which the offline chain here can cause) lets go of every hold by design
      // (store/useWalk.ts stop): counted, so a hold it took is not read as the stick's fault. The pointers are logged too.
      await page.evaluate(async () => {
        const w = await import('/src/store/useWalk.ts')
        const real = w.useWalk.getState().stop
        window.__stops = 0
        w.useWalk.setState({ stop: (...a) => { window.__stops++; return real(...a) } })
        window.__ptr = []
        for (const t of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(t, (e) => window.__ptr.push(`${t} ${e.pointerId} ${e.target.closest?.('button, .walkstick')?.className.split(' ')[0] ?? e.target.tagName}`), true)
      })
      // A second finger on JUMP, the stick still held.
      const jb = r.jump
      await touch(cdp, 'touchStart', [{ id: 1, x: x0, y: y0 - 60 }, { id: 2, x: (jb.l + jb.r) / 2, y: (jb.t + jb.b) / 2 }])
      await sleep(250)
      const jumped = await page.evaluate(async () => { const m = await import('/src/store/walkHold.ts'); return m.heldNow() })
      const stops1 = await page.evaluate(() => window.__stops)
      const both = await page.evaluate(() => document.querySelector('.walkstick__base')?.classList.contains('is-on') && window.__ptr.some((l) => /^pointerdown \d+ touchpad__key/.test(l)))
      if (!both) fail(`${label}: JUMP did not take its finger with the stick held (${(await page.evaluate(() => window.__ptr)).join('; ')})`)
      else if (!(jumped.vert === 1 && jumped.fwd === 1) && stops1 === 0) fail(`${label}: JUMP with the stick held did not hold both (${JSON.stringify(jumped)})`)
      else if (!(jumped.vert === 1 && jumped.fwd === 1)) console.log(`${label}: (the chain stopped the walk ${stops1}x here, letting go of the holds by design; both fingers kept their controls)`)
      if (SHOTS && ['390x844', '844x390'].includes(size.name)) await page.screenshot({ path: `${SHOTS}/${mode}-${size.w}x${size.h}-held.png` })
      // The stick's finger lifts first, JUMP's after.
      const jp = { id: 2, x: (jb.l + jb.r) / 2, y: (jb.t + jb.b) / 2 }
      await touch(cdp, 'touchEnd', [{ id: 1, x: x0, y: y0 - 60 }])
      await sleep(100)
      const jumpOnly = await page.evaluate(async () => { const m = await import('/src/store/walkHold.ts'); return m.heldNow() })
      const stops2 = await page.evaluate(() => window.__stops)
      const ptr = await page.evaluate(() => window.__ptr)
      if (ptr.some((l) => l.startsWith('pointercancel'))) fail(`${label}: a finger was cancelled (${ptr.join('; ')})`)
      if (!(jumpOnly.vert === 1 && jumpOnly.fwd === 0) && stops2 === 0) fail(`${label}: lifting the stick's finger did not leave JUMP alone held (${JSON.stringify(jumpOnly)})`)
      await touch(cdp, 'touchEnd', [jp])
      await sleep(100)
      const still = await page.evaluate(async () => { const m = await import('/src/store/walkHold.ts'); return m.holding() })
      if (still) fail(`${label}: something still held after every finger lifted`)
      // Fluid WALK coasts to rest within a step (about a quarter second): measured after that.
      await sleep(600)
      const stopped = await cursorOf(page)
      await sleep(800)
      const after = await cursorOf(page)
      if (after[0] !== stopped[0] || after[2] !== stopped[2]) fail(`${label}: walked on after the lift`)
      if (!bad) console.log(`${label}: the stick walks from where it lands, JUMP with it, stops on the lift`)
    }
    await ctx.close()
  }
}

if (VIDEO) {
  fs.mkdirSync(VIDEO, { recursive: true })
  for (const size of [{ name: '390x844', w: 390, h: 844, touch: true }, { name: '844x390', w: 844, h: 390, touch: true }]) {
    const { ctx, page } = await open(browser, size, 'terrain', VIDEO)
    const cdp = await ctx.newCDPSession(page)
    const r = await page.evaluate(`(${measure.toString()})(${JSON.stringify(BOXES)})`)
    const cx = (r.home.l + r.home.r) / 2 + 10, cy = (r.home.t + r.home.b) / 2 - 10
    await sleep(800)
    await touch(cdp, 'touchStart', [{ id: 1, x: cx, y: cy }])
    await sleep(400)
    // Up, round in a circle, past the ring and back (the ring follows), a jump on the way, then let go.
    for (let k = 0; k <= 20; k++) { await touch(cdp, 'touchMove', [{ id: 1, x: cx, y: cy - k * 2.5 }]); await sleep(33) }
    await sleep(600)
    for (let a = 0; a <= 360; a += 10) { const t = (a * Math.PI) / 180; await touch(cdp, 'touchMove', [{ id: 1, x: cx + 46 * Math.sin(t), y: cy - 46 * Math.cos(t) }]); await sleep(40) }
    for (let k = 0; k <= 20; k++) { await touch(cdp, 'touchMove', [{ id: 1, x: cx + k * 5, y: cy - 46 }]); await sleep(33) }
    for (let k = 20; k >= -6; k--) { await touch(cdp, 'touchMove', [{ id: 1, x: cx + k * 5, y: cy - 46 }]); await sleep(33) }
    const jb = r.jump
    await touch(cdp, 'touchStart', [{ id: 1, x: cx - 30, y: cy - 46 }, { id: 2, x: (jb.l + jb.r) / 2, y: (jb.t + jb.b) / 2 }])
    await sleep(300)
    await touch(cdp, 'touchEnd', [{ id: 1, x: cx - 30, y: cy - 46 }])
    await sleep(200)
    await touch(cdp, 'touchEnd', [{ id: 2, x: (jb.l + jb.r) / 2, y: (jb.t + jb.b) / 2 }])
    await sleep(1200)
    const v = page.video()
    await ctx.close()
    if (v) fs.renameSync(await v.path(), `${VIDEO}/stick-${size.w}x${size.h}.webm`)
  }
}
await browser.close()
console.log(bad ? `${bad} failure(s)` : 'all clear')
process.exit(bad ? 1 : 0)
