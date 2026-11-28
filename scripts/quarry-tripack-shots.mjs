/**
 * quarry-tripack-shots.mjs: the Quarry Charge's Tri-Pack look (owner,
 * 2026-11-28) on screen, at a phone (390x844) and a desktop (1440x900): its
 * blueprint card and EXAMINE sheet, the hotbar with the charge in hand, the
 * bag's tile, and a charge placed and armed in the world, held mid-fuse for
 * the picture (a charge shown with no fuse running, so it never blasts).
 *
 * Nothing reaches a relay: every non-localhost request is refused and every
 * socket is answered here; LOCAL is set before load.
 *
 * Usage: start the dev server (npx vite --port 5297), then
 *   node scripts/quarry-tripack-shots.mjs [http://localhost:5297/] [out dir]
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const URL = process.argv[2] ?? 'http://localhost:5297/'
const OUT = process.argv[3] ?? '/tmp/quarry-tripack-shots'
mkdirSync(OUT, { recursive: true })
const SIZES = [
  { name: '390x844', w: 390, h: 844, touch: true },
  { name: '1440x900', w: 1440, h: 900, touch: false },
]
const problems = []
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h }, isMobile: size.touch, hasTouch: size.touch,
  })
  await ctx.route((u) => !/^(https?:\/\/(localhost|127\.0\.0\.1)|data:|blob:)/.test(u.toString()), (r) => r.abort())
  await ctx.routeWebSocket(/.*/, (ws) => { ws.onMessage((raw) => { let m; try { m = JSON.parse(String(raw)) } catch { return } if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]])); else if (m[0] === 'EVENT') ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }) })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`${size.name} page error: ${e.message}`))
  const sk = generateSecretKey(); const pk = getPublicKey(sk); const ns = nip19.nsecEncode(sk)
  await page.addInitScript(([pk, ns]) => { try { localStorage.setItem('onosendai:live', '0'); localStorage.setItem('onosendai:nsec', ns); localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns })) } catch {} }, [pk, ns])
  const shot = (name) => page.screenshot({ path: `${OUT}/${size.w}-${name}.png` })
  await page.goto(URL)
  await page.waitForTimeout(9000)
  await page.keyboard.press('Escape')
  // An identity that has finished the tour: a newcomer, or one mid-tour, keeps to the teaching list without TERRAIN.
  await page.evaluate(async () => {
    const tu = (await import('/src/store/useTutorial.ts')).useTutorial
    if (tu.getState().active) tu.getState().end('skipped')
    const nc = (await import('/src/newcomer/useNewcomer.ts')).useNewcomer
    nc.setState({ record: { ...nc.getState().record, stage: 'graduated', choice: undefined } })
  })
  await page.waitForTimeout(800)

  // 1. The blueprint card, and its EXAMINE sheet with the prize's pictures.
  await page.evaluate(async (pk) => {
    const { useBlueprints } = await import('/src/store/useBlueprints.ts')
    await useBlueprints.getState().load(pk)
    const g = await import('/src/lib/blueprint/gameBlueprint.ts')
    await g.grantCompilerIfDue(pk, { 40: 1 })
    await g.grantQuarryIfDue(pk, { 2: 1 })
    ;(await import('/src/store/useBlueprintTool.ts')).useBlueprintTool.getState().openTool()
  }, pk)
  await page.waitForSelector('.bpt', { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await shot('1-blueprint')
  const examined = await page.evaluate(() => { const b = document.querySelector('.bp-land__pic'); b?.click(); return !!b })
  if (examined) { await page.waitForTimeout(1500); await shot('1-examine') }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.evaluate(async () => { (await import('/src/store/useBlueprintTool.ts')).useBlueprintTool.getState().close() })
  await page.waitForTimeout(600)

  // 2. TERRAIN, a clearing round you, the first-visit steps done, the look tipped down a little.
  const entered = await page.evaluate(async () => (await import('/src/store/padMode.ts')).enterTerrainMode())
  if (!entered) problems.push(`${size.name}: TERRAIN did not open`)
  await page.waitForTimeout(3500)
  await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    for (let i = 0; i < 4; i++) { const key = t.surveyTarget(); if (!key) break; await t.useTerrain.getState().survey(key) }
  })
  await page.waitForTimeout(2000)
  await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const s = t.terrainSession
    const w = t.offsetOf(s, t.headNow())
    const cells = []
    for (let y = 0; y <= 6; y++) for (let z = -7; z <= 7; z++) for (let x = -7; x <= 7; x++) cells.push([w[0] + x, w[1] + y, w[2] + z])
    t.useTerrain.getState().blast(cells)
    t.useTerrain.setState({ hint: 3 })
  })
  await page.evaluate(() => { const later = [...document.querySelectorAll('button')].find((b) => /^\s*LATER\s*$/.test(b.textContent ?? '')); later?.click() })
  await page.evaluate(async (dy) => { (await import('/src/lib/walkLook.ts')).walkLookBy(0, dy) }, size.touch ? 110 : 80)
  await page.waitForTimeout(1200)

  // 3. Seven charges, chosen: the hotbar and the Tri-Pack in hand; then the bag's tile.
  await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const db = await import('/src/lib/terrain/terrainDb.ts')
    t.useTerrain.getState().gainCharges(7)
    t.useTerrain.getState().selectSlot(t.useTerrain.getState().inventory.hotbar.findIndex(db.isQuarry))
  })
  await page.waitForTimeout(2500)
  await shot('2-hotbar-hand')
  await page.evaluate(async () => { (await import('/src/store/useTerrain.ts')).useTerrain.getState().setSheet(true) })
  await page.waitForTimeout(1200)
  await shot('3-bag')
  await page.evaluate(async () => { (await import('/src/store/useTerrain.ts')).useTerrain.getState().setSheet(false) })
  await page.waitForTimeout(600)

  // 4. A charge armed where PLACE would put it (the face at the cross, else the ghost in the air), held mid-fuse: shown with
  // no fuse running, so it never blasts.
  const shown = await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const q = (await import('/src/store/useQuarry.ts')).useQuarry
    const { terrainCursor } = await import('/src/scene/TerrainLayer.tsx')
    const s0 = t.terrainSession
    const h = terrainCursor.hit
    const cell = h ? [h.cell[0] + h.normal[0], h.cell[1] + h.normal[1], h.cell[2] + h.normal[2]] : terrainCursor.air ? terrainCursor.air.cell : null
    if (cell) {
      const o = s0.world.origin
      q.setState({ charges: [{ id: 99999, owner: s0.owner, plane: s0.plane, x: o.x + BigInt(cell[0]), y: o.y + BigInt(cell[1]), z: o.z + BigInt(cell[2]), armedAt: performance.now() - 900 }] })
      return h ? 'on the face' : 'at the ghost'
    }
    const { walkLookDirection } = await import('/src/store/walkFluid.ts')
    const { solid } = await import('/src/lib/terrain/blocks.ts')
    const s = t.terrainSession
    const w = t.offsetOf(s, t.headNow())
    const f = walkLookDirection().forward
    const len = Math.hypot(f.x, f.z) || 1
    const fx = len > 0.05 ? f.x / len : 1, fz = len > 0.05 ? f.z / len : 0
    for (const [dx, dz] of [[fx, fz], [1, 0], [0, 1], [-1, 0], [0, -1]]) for (const d of [3, 4, 5]) {
      const x = Math.round(w[0] + dx * d), z = Math.round(w[2] + dz * d)
      for (let y = w[1] + 2; y > w[1] - 24; y--) {
        if (solid(s.world.blockCs(x, y, z)) && !solid(s.world.blockCs(x, y + 1, z))) {
          const o = s.world.origin
          q.setState({ charges: [{ id: 99999, owner: s.owner, plane: s.plane, x: o.x + BigInt(x), y: o.y + BigInt(y + 1), z: o.z + BigInt(z), armedAt: performance.now() - 900 }] })
          return `at ${d}`
        }
      }
    }
    return null
  })
  // An empty slot chosen, so no ghost stands over it.
  await page.evaluate(async () => { const t = (await import('/src/store/useTerrain.ts')).useTerrain; t.getState().selectSlot(t.getState().inventory.hotbar.indexOf(0)) })
  console.log(`${size.name}: armed charge shown ${shown}`)
  if (!shown) problems.push(`${size.name}: no ground ahead for the armed charge`)
  await page.waitForTimeout(2500)
  await shot('4-armed')
  // Again later in the fuse: the ring faster, the last second over it.
  await page.evaluate(async () => { const q = (await import('/src/store/useQuarry.ts')).useQuarry; q.setState({ charges: q.getState().charges.map((c) => ({ ...c, armedAt: performance.now() - 2300 })) }) })
  await page.waitForTimeout(300)
  await shot('4-armed-late')
  await page.evaluate(async () => { (await import('/src/store/useQuarry.ts')).useQuarry.setState({ charges: [] }) })
  await ctx.close()
}
await browser.close()
if (problems.length) { console.log(problems.join('\n')); process.exit(1) }
console.log('all shown')
