/**
 * quarry-shots.mjs: the Quarry Charge on screen (DECK-0010 §8.6), at a phone
 * (390x844) and a desktop (1440x900), with a short video of each: its
 * blueprint in BUILD > BLUEPRINT with the orange item mark, the charges in the
 * hotbar (with their count, and at 0 greyed out), the fuse blinking and
 * counting down, the blast, the floating drops, and a pickup.
 *
 * Nothing reaches a relay: every non-localhost request is refused and every
 * socket is answered here; LOCAL is set before load.
 *
 * Usage: start the dev server (npx vite --port 5297), then
 *   node scripts/quarry-shots.mjs [http://localhost:5297/] [out dir]
 * Exit 1 if a step did not happen (the counts are checked).
 */
import { chromium } from 'playwright'
import { mkdirSync, renameSync } from 'node:fs'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const URL = process.argv[2] ?? 'http://localhost:5297/'
const OUT = process.argv[3] ?? '/tmp/quarry-shots'
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
    recordVideo: { dir: OUT, size: { width: size.w, height: size.h } },
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

  // 1. The blueprint, granted on the first Umberslate, in BUILD > BLUEPRINT with the orange mark.
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
  const cards = await page.evaluate(async () => (await import('/src/store/useBlueprints.ts')).useBlueprints.getState().cards.map((c) => c.record.id))
  if (!cards.includes('game:quarry-charge')) problems.push(`${size.name}: the Quarry Charge blueprint was not granted`)
  await page.evaluate(async () => { (await import('/src/store/useBlueprintTool.ts')).useBlueprintTool.getState().close() })
  await page.waitForTimeout(600)

  // 2. TERRAIN, the chunk here surveyed, looking down at the ground in front.
  const entered = await page.evaluate(async () => (await import('/src/store/padMode.ts')).enterTerrainMode())
  if (!entered) problems.push(`${size.name}: TERRAIN did not open`)
  await page.waitForTimeout(3500)
  const surveyed = await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const out = []
    for (let i = 0; i < 4; i++) {
      const key = t.surveyTarget()
      if (!key) break
      await t.useTerrain.getState().survey(key)
      out.push(`${key.slice(0, 12)}: ${t.useTerrain.getState().message}`)
    }
    return { out, here: t.hereSurveyedBy(), active: t.useTerrain.getState().active }
  })
  console.log(`${size.name}: survey`, JSON.stringify(surveyed))
  await page.waitForTimeout(2500)
  // A clearing round you, so the camera stands in open air over the ground (the store's own blast, which leaves no drops),
  // the first-visit steps done, and the look tipped down at the ground ahead.
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
  await page.waitForTimeout(1200)
  await page.evaluate(async (dy) => { (await import('/src/lib/walkLook.ts')).walkLookBy(0, dy) }, size.touch ? 150 : 90)
  await page.waitForTimeout(1500)

  // 3. Seven charges, from a compile's toy, chosen: the hotbar with its count and the charge in hand.
  await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const db = await import('/src/lib/terrain/terrainDb.ts')
    t.useTerrain.getState().gainCharges(7)
    const inv = t.useTerrain.getState().inventory
    t.useTerrain.getState().selectSlot(inv.hotbar.findIndex(db.isQuarry))
  })
  await page.waitForTimeout(1200)
  await shot('2-hotbar-7')
  console.log(`${size.name}: hotbar`, await page.evaluate(async () => JSON.stringify((await import('/src/store/useTerrain.ts')).useTerrain.getState().inventory)), await page.evaluate(() => document.querySelectorAll('.terrain-hotbar > button')[1]?.outerHTML.slice(0, 300)))

  // 4. PLACE: on the face at the cross, else in the ground below the look.
  const placed = await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const { terrainCursor } = await import('/src/scene/TerrainLayer.tsx')
    void terrainCursor
    // On the ground a few blocks ahead, the way you look.
    const { walkLookDirection } = await import('/src/store/walkFluid.ts')
    const { solid } = await import('/src/lib/terrain/blocks.ts')
    const s = t.terrainSession
    const w = t.offsetOf(s, t.headNow())
    const f = walkLookDirection().forward
    const len = Math.hypot(f.x, f.z) || 1
    const fx = len > 0.05 ? f.x / len : 1, fz = len > 0.05 ? f.z / len : 0
    const why = []
    for (const [dx, dz] of [[fx, fz], [1, 0], [0, 1], [-1, 0], [0, -1]]) for (const d of [5, 4, 6, 3, 8]) {
      const x = Math.round(w[0] + dx * d), z = Math.round(w[2] + dz * d)
      for (let y = w[1] + 4; y > w[1] - 24; y--) {
        if (solid(s.world.blockCs(x, y, z)) && !solid(s.world.blockCs(x, y + 1, z))) {
          if (t.useTerrain.getState().place({ cell: [x, y, z], normal: [0, 1, 0], distance: d })) return 'ahead'
          why.push(t.useTerrain.getState().message)
          break
        }
      }
    }
    return `nothing: ${[...new Set(why)].join(' | ')} (walker ${w.join(',')})`
  })
  console.log(`${size.name}: placed ${placed}`)
  if (placed !== 'face' && placed !== 'air' && placed !== 'ahead') problems.push(`${size.name}: the charge was not placed (${placed})`)
  await page.waitForTimeout(500)
  await shot('3-fuse-a')
  await page.waitForTimeout(500)
  await shot('3-fuse-b')
  // The blast, the moment the fuse is out.
  await page.waitForFunction(async () => (await import('/src/store/useQuarry.ts')).useQuarry.getState().charges.length === 0, null, { polling: 30, timeout: 8000 }).catch(() => {})
  await shot('4-blast')
  await page.waitForTimeout(300)
  await shot('4-blast-b')
  await page.waitForTimeout(2000)
  const before = await page.evaluate(async () => {
    const q = (await import('/src/store/useQuarry.ts')).useQuarry.getState()
    const t = (await import('/src/store/useTerrain.ts')).useTerrain.getState()
    return { drops: q.drops.length, blocks: Object.values(t.inventory.counts).reduce((a, b) => a + b, 0), charges: t.inventory.charges }
  })
  console.log(`${size.name}: after the blast`, before)
  if (!(before.drops > 0)) problems.push(`${size.name}: the blast left no drops`)
  await shot('5-drops')

  // 5. A pickup: walk forward into the crater.
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1600)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(500)
  let after = await page.evaluate(async () => {
    const q = (await import('/src/store/useQuarry.ts')).useQuarry.getState()
    const t = (await import('/src/store/useTerrain.ts')).useTerrain.getState()
    return { drops: q.drops.length, blocks: Object.values(t.inventory.counts).reduce((a, b) => a + b, 0) }
  })
  if (after.drops === before.drops) {
    // The walk missed them: step the walker into a drop's cell, as walking there would.
    await page.evaluate(async () => {
      const q = (await import('/src/store/useQuarry.ts')).useQuarry.getState()
      const c = await import('/src/store/useCyberspace.ts')
      const d = q.drops[Math.floor(q.drops.length / 2)]
      const at = { x: BigInt(d.x), y: BigInt(d.y), z: BigInt(d.z) }
      c.useCyberspace.setState({ cursor: { ...c.useCyberspace.getState().cursor, ...at } })
    })
    await page.waitForTimeout(400)
    after = await page.evaluate(async () => {
      const q = (await import('/src/store/useQuarry.ts')).useQuarry.getState()
      const t = (await import('/src/store/useTerrain.ts')).useTerrain.getState()
      return { drops: q.drops.length, blocks: Object.values(t.inventory.counts).reduce((a, b) => a + b, 0) }
    })
  }
  console.log(`${size.name}: after the pickup`, after)
  if (!(after.drops < before.drops && after.blocks > before.blocks)) problems.push(`${size.name}: nothing was picked up`)
  await shot('6-pickup')

  // 6. None left: the slot stays, at 0, greyed out and disabled.
  await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const db = await import('/src/lib/terrain/terrainDb.ts')
    const inv = t.useTerrain.getState().inventory
    t.useTerrain.setState({ inventory: db.withCharges(inv, 0) })
  })
  await page.waitForTimeout(800)
  await shot('7-hotbar-0')
  const zero = await page.evaluate(() => { const b = document.querySelector('.terrain-slot--quarry'); return b ? { disabled: b.disabled, count: b.querySelector('.terrain-slot__count')?.textContent, out: b.classList.contains('is-out') } : null })
  console.log(`${size.name}: at 0`, zero)
  if (!zero || !zero.disabled || zero.count !== '0' || !zero.out) problems.push(`${size.name}: the slot at 0 is not shown greyed out and disabled`)

  const video = page.video()
  await ctx.close()
  if (video) { const p = await video.path(); renameSync(p, `${OUT}/${size.w}-quarry-charge.webm`) }
}
await browser.close()
if (problems.length) { console.log(problems.join('\n')); process.exit(1) }
console.log('all steps shown')
