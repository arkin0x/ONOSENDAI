/**
 * starred-shots.mjs: screenshots of starred chunks (owner, 2026-11-28): the
 * survey card asking to star a chunk with two Glowcore, SAVED CHUNKS (the
 * list), one saved chunk's view (where it is, the actions, its card), and the
 * waypoint's gold beacon with the HUD target's marker, in view and pinned at
 * the screen's edge. At a phone's size and a desktop's.
 *
 * Opens TERRAIN in LOCAL (nothing is synced), lays a floor under you with two
 * Glowcore and some Cinderrock in the chunk you stand in, marks it surveyed,
 * and stars a few more chunks round you with made-up cards. Nothing reaches a
 * relay: every socket is answered here and every other host is blocked.
 *
 * Usage: start the dev server (npx vite --port 5317), then
 *   node scripts/starred-shots.mjs [http://localhost:5317/] [out dir]
 * Exit 1 on any problem.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const URL = process.argv[2] ?? 'http://localhost:5317/'
const OUT = process.argv[3] ?? 'starred-shots'
mkdirSync(OUT, { recursive: true })
const SIZES = [
  { name: '390x844', w: 390, h: 844, touch: true },
  { name: '1440x900', w: 1440, h: 900, touch: false },
]

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let bad = 0
const fail = (size, why) => { bad++; console.log(`${size.name}: ${why}`) }
for (const size of SIZES) {
  const ctx = await browser.newContext(size.touch ? { viewport: { width: size.w, height: size.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: size.w, height: size.h } })
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => r.abort())
  const published = []
  await ctx.routeWebSocket(/.*/, (ws) => { ws.onMessage((raw) => { let m; try { m = JSON.parse(String(raw)) } catch { return } if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]])); else if (m[0] === 'EVENT') { published.push(m[1]); ws.send(JSON.stringify(['OK', m[1].id, true, ''])) } }) })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`${size.name} page error: ${e.message}`))
  const sk = generateSecretKey(); const pk = getPublicKey(sk); const ns = nip19.nsecEncode(sk)
  await page.addInitScript(([pk, ns]) => { try { localStorage.setItem('onosendai:live', '0'); localStorage.setItem('onosendai:nsec', ns); localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns })) } catch {} }, [pk, ns])
  await page.goto(URL)
  await page.waitForTimeout(9000)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'LATER' }).click({ timeout: 2000 }).catch(() => {})
  await page.evaluate(async () => {
    const tut = await import('/src/store/useTutorial.ts')
    if (tut.tutorialRunFor()) tut.useTutorial.setState({ active: false })
    const pm = await import('/src/store/padMode.ts')
    pm.enterTerrainMode()
  })
  await page.waitForTimeout(4000)
  // The chunk you stand in: a floor under your feet, two Glowcore and forty Cinderrock in it, surveyed. Others round you starred.
  const seeded = await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const sc = await import('/src/store/starredChunks.ts')
    const co = await import('/src/lib/terrain/coords.ts')
    const s = t.terrainSession
    if (!s) return { err: 'no field' }
    const head = t.headNow()
    const [hx, hy, hz] = t.offsetOf(s, head)
    for (const slot of s.world.slots) {
      const b = new Uint8Array(32768)
      for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
        const gy = 32 * slot.off[1] + y
        if (gy < hy - 1) b[x | (z << 5) | (y << 10)] = gy < hy - 4 ? 2 : 1
      }
      s.world.setBlocks(slot.key, b.slice(), b)
    }
    const here = s.world.slotAtCs(hx, hy, hz)
    const b = here.blocks
    const lx = hx - 32 * here.off[0], ly = hy - 32 * here.off[1], lz = hz - 32 * here.off[2]
    const set = (x, y, z, id) => { if (x >= 0 && x < 32 && y >= 0 && y < 32 && z >= 0 && z < 32) b[x | (z << 5) | (y << 10)] = id }
    set(lx + 1, ly - 2, lz + 4, 42); set(lx - 2, ly - 2, lz + 6, 42)
    let n = 0
    for (let x = 0; x < 32 && n < 40; x += 3) for (let z = 0; z < 32 && n < 40; z += 5) { set(x, Math.max(0, ly - 3), z, 7); n++ }
    s.world.setBlocks(here.key, b.slice(), b)
    here.ground = { family: 'volcanic', maxK: 14, meanK: 11.2, top: 7 }
    here.revision = 2
    s.surveyedKeys.add(here.key)
    s.revisions.set(here.key, { revision: 2, surveyed: Math.floor(Date.now() / 1000) - 3600 })
    s.version++
    // Others starred: made-up cards, a few chunks round you.
    const base = co.parseChunkKey(here.key)
    const k = (dx, dy, dz, plane = base.plane) => co.chunkKey({ x: base.x + BigInt(32 * dx), y: base.y + BigInt(32 * dy), z: base.z + BigInt(32 * dz), plane })
    const card = (g, kk, rows) => ({ g, k: kk, m: kk - 2.5, r: rows, d: '0707070707070505050505050505050505050505010101010000000000000000', v: Math.floor(Date.now() / 1000) - 86400 * 3 })
    const rows = {
      prism: [[8, 31, 4, 1], [41, 12, 0, 0], [6, 7400, 30, 1], [1, 1900, 0, 1]],
      cobalt: [[41, 22, 0, 1], [40, 60, 8, 1], [5, 8800, 0, 1]],
      void: [[193, 1, 0, 0], [42, 3, 0, 0], [8, 9, 0, 1], [3, 9200, 0, 1]],
    }
    const now = Date.now()
    // Backdated stars: the app's own deps, with the clock set back for each.
    const add = (key, c, note, ago) => {
      const prev = sc.setStarredDeps(null)
      sc.setStarredDeps({ ...prev, now: () => now - ago * 1000 })
      sc.starChunk(key, c)
      if (note) sc.renameChunk(key, note)
      sc.setStarredDeps(prev)
    }
    add(k(1, 0, 4), card('crystal', 12, rows.prism), null, 86400 * 2)
    add(k(-6, 1, 9), card('karst', 11, rows.cobalt), 'Cobalt shelf by the ridge', 86400 * 5)
    add(k(0, 0, 0, base.plane === 0 ? 1 : 0), card('frozen', 15, rows.void), null, 86400 * 9)
    return { here: here.key, ahead: k(1, 0, 4), far: k(-6, 1, 9), count: sc.useStarredChunks.getState().entries.length }
  })
  if (seeded.err) { fail(size, seeded.err); await ctx.close(); continue }
  console.log(`${size.name}: seeded ${seeded.count} saved chunks`)
  await page.waitForTimeout(6000)

  // 1. The survey card asking to star the chunk with two Glowcore.
  await page.evaluate(async (key) => { (await import('/src/terrain/surveyCard.ts')).openSurveyCard(key) }, seeded.here)
  await page.waitForTimeout(1500)
  const asking = await page.evaluate(() => ({ line: document.querySelector('.survey-star')?.textContent ?? '', asking: !!document.querySelector('.survey-card__star.is-asking') }))
  if (!/Glowcore.* here\. Star this chunk to find it again\./.test(asking.line) || !asking.asking) fail(size, `card prompt: ${JSON.stringify(asking)}`)
  await page.screenshot({ path: `${OUT}/card-prompt-${size.w}x${size.h}.png` })
  // Star it.
  await page.click('.survey-card__star')
  await page.waitForTimeout(800)
  const starredLine = await page.evaluate(() => document.querySelector('.survey-star')?.textContent ?? '')
  if (!/Saved/.test(starredLine)) fail(size, `after starring: "${starredLine}"`)
  await page.screenshot({ path: `${OUT}/card-starred-${size.w}x${size.h}.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // 2. MINING's SAVED CHUNKS button, then the list.
  await page.evaluate(() => document.querySelector('.hamburger-menu')?.click())
  await page.waitForTimeout(1500)
  const btn = await page.evaluate(() => { const b = document.querySelector('.mining__saved'); b?.scrollIntoView({ block: 'center' }); return b?.textContent ?? null })
  if (!btn || !/SAVED CHUNKS \(4\)/.test(btn)) fail(size, `MINING button: ${btn}`)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/mining-button-${size.w}x${size.h}.png` })
  await page.click('.mining__saved')
  await page.waitForTimeout(1000)
  const rows = await page.evaluate(() => [...document.querySelectorAll('.saved-row')].map((r) => r.textContent))
  if (rows.length !== 4) fail(size, `list rows: ${rows.length}`)
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.saved-row, .saved-act, .mining__saved')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className))
  if (clipped.length) fail(size, `clipped: ${clipped.join(', ')}`)
  await page.screenshot({ path: `${OUT}/saved-list-${size.w}x${size.h}.png` })

  // 3. One chunk's view: the far one, with your note.
  await page.evaluate(async (key) => { (await import('/src/terrain/savedChunksUi.ts')).openSavedChunks(key) }, seeded.far)
  await page.waitForTimeout(1000)
  const view = await page.evaluate(() => document.querySelector('.saved-where')?.textContent ?? '')
  if (!/chunks/.test(view) || !/Facing the sun/.test(view)) fail(size, `view: "${view}"`)
  await page.screenshot({ path: `${OUT}/chunk-view-${size.w}x${size.h}.png` })
  await page.evaluate(() => document.querySelector('.saved-card .survey-card__body')?.scrollTo(0, 9999))
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/chunk-view-card-${size.w}x${size.h}.png` })
  await page.evaluate(() => document.querySelector('.saved-card .survey-card__body')?.scrollTo(0, 0))

  // 4. The waypoint and the HUD target on the chunk ahead, then the modals closed.
  await page.evaluate(async (key) => { (await import('/src/terrain/savedChunksUi.ts')).openSavedChunks(key) }, seeded.ahead)
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /SET WAYPOINT/ }).click()
  await page.getByRole('button', { name: /HUD TARGET/ }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/chunk-view-guiding-${size.w}x${size.h}.png` })
  await page.evaluate(async () => { (await import('/src/terrain/savedChunksUi.ts')).closeSavedChunks(); (await import('/src/hud/modalStack.tsx')).leaveModals() })
  await page.keyboard.press('Escape')
  await page.evaluate(() => { const m = document.querySelector('.hamburger-menu'); if (document.querySelector('.panel--mining')) m?.click() })
  await page.waitForTimeout(1200)
  // A little up, and on a narrow phone a little right, so the beacon (one chunk right, four ahead) rises in view.
  await page.evaluate(async ([dx]) => { (await import('/src/lib/walkLook.ts')).walkLookBy(dx, -50) }, [size.touch ? Math.round(size.w * 0.06) : 0])
  await page.waitForTimeout(3000)
  const hud = await page.evaluate(() => { const t = document.querySelector('[data-target="starred-chunk"]'); return t ? { text: t.textContent, style: t.getAttribute('style') } : null })
  if (!hud) fail(size, 'no HUD target marker')
  const beacon = await page.evaluate(async () => {
    const sc = await import('/src/store/starredChunks.ts')
    return sc.useStarredChunks.getState().guide
  })
  console.log(`${size.name}: guide ${JSON.stringify(beacon)}, marker ${JSON.stringify(hud)}`)
  await page.screenshot({ path: `${OUT}/beacon-hud-${size.w}x${size.h}.png` })
  // Turned away: the marker pinned at the screen's edge, pointing back.
  await page.evaluate(async (w) => { (await import('/src/lib/walkLook.ts')).walkLookBy(w * 0.4, 0) }, size.w)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/hud-edge-${size.w}x${size.h}.png` })
  // Nothing was published: LOCAL, and no coordinates went anywhere.
  if (published.some((e) => e.kind === 30078)) fail(size, 'a 30078 was published in LOCAL')
  await ctx.close()
}
await browser.close()
console.log(bad ? `${bad} problem(s)` : 'starred shots: all clear')
process.exit(bad ? 1 : 0)
