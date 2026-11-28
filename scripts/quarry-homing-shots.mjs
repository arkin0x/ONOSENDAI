/**
 * quarry-homing-shots.mjs: the Quarry Charge's drops flying to you and the
 * charge held like a block (owner, 2026-11-28), at a phone upright (390x844)
 * and on its side (844x390), with a video of each: the carried block and the
 * charge in hand side by side (and their boxes against PLACE, SMASH and
 * JUMP), the 10 second fuse counting down (calm, then the last 3 seconds),
 * and a burst of frames from the blast as the drops within 7 stream in, with
 * the drops left and the blocks carried at each frame.
 *
 * Nothing reaches a relay: every non-localhost request is refused and every
 * socket is answered here; LOCAL is set before load.
 *
 * Usage: start the dev server (npx vite --port 5298), then
 *   node scripts/quarry-homing-shots.mjs [http://localhost:5298/] [out dir]
 * Exit 1 if a step did not happen.
 */
import { chromium } from 'playwright'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const URL = process.argv[2] ?? 'http://localhost:5298/'
const OUT = process.argv[3] ?? '/tmp/quarry-homing-shots'
mkdirSync(OUT, { recursive: true })
const SIZES = [
  { name: '390x844', w: 390, h: 844, touch: true },
  { name: '844x390', w: 844, h: 390, touch: true },
]
const problems = []
const log = []
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
  const shot = (name) => page.screenshot({ path: `${OUT}/${size.w}x${size.h}-${name}.png` })
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
  // A clearing round you, so the camera is in open air over the ground (the store's own blast, which leaves no drops),
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

  // 3. Blocks and seven charges: the carried block, then the charge in hand, in the same corner.
  await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const db = await import('/src/lib/terrain/terrainDb.ts')
    t.useTerrain.getState().gainCharges(7)
    t.useTerrain.setState({ inventory: db.carriedInto(t.useTerrain.getState().inventory, 1, 24) })
  })
  await page.waitForTimeout(600)
  const boxes = () => page.evaluate(() => {
    // The first shown: the charge's box is kept (hidden) while a block is in hand.
    const box = (sel) => { const e = [...document.querySelectorAll(sel)].find((x) => getComputedStyle(x).visibility !== 'hidden'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
    return { held: box('.terrain-held'), view: box('.terrain-held-charge__view'), place: box('.terrain-act--place'), smash: box('.terrain-act--smash'), jump: box('.walkside') }
  })
  await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const inv = t.useTerrain.getState().inventory
    const db = await import('/src/lib/terrain/terrainDb.ts')
    t.useTerrain.getState().selectSlot(inv.hotbar.findIndex((id) => id && !db.isQuarry(id) && !db.isCompiler(id) && (inv.counts[id] ?? 0) > 0))
  })
  await page.waitForTimeout(900)
  await shot('1-held-block')
  const blockBoxes = await boxes()
  await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const db = await import('/src/lib/terrain/terrainDb.ts')
    const inv = t.useTerrain.getState().inventory
    t.useTerrain.getState().selectSlot(inv.hotbar.findIndex(db.isQuarry))
  })
  await page.waitForTimeout(1500)
  await shot('2-held-charge')
  const chargeBoxes = await boxes()
  log.push({ size: size.name, blockBoxes, chargeBoxes })
  console.log(size.name, 'block', JSON.stringify(blockBoxes), 'charge', JSON.stringify(chargeBoxes))
  if (!chargeBoxes.held) problems.push(`${size.name}: the charge in hand is not in the carried block's box`)
  else if (blockBoxes.held && chargeBoxes.held.join() !== blockBoxes.held.join()) problems.push(`${size.name}: the charge's box differs from the block's`)

  // 4. PLACE near (3 to 5 blocks ahead), so the blast's drops are within 7.
  const placed = await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const { walkLookDirection } = await import('/src/store/walkFluid.ts')
    const { solid } = await import('/src/lib/terrain/blocks.ts')
    const s = t.terrainSession
    const w = t.offsetOf(s, t.headNow())
    const f = walkLookDirection().forward
    const len = Math.hypot(f.x, f.z) || 1
    const fx = len > 0.05 ? f.x / len : 1, fz = len > 0.05 ? f.z / len : 0
    const why = []
    for (const [dx, dz] of [[fx, fz], [1, 0], [0, 1], [-1, 0], [0, -1]]) for (const d of [4, 3, 5, 6]) {
      const x = Math.round(w[0] + dx * d), z = Math.round(w[2] + dz * d)
      for (let y = w[1] + 4; y > w[1] - 24; y--) {
        if (solid(s.world.blockCs(x, y, z)) && !solid(s.world.blockCs(x, y + 1, z))) {
          if (t.useTerrain.getState().place({ cell: [x, y, z], normal: [0, 1, 0], distance: d })) return 'ahead'
          why.push(t.useTerrain.getState().message)
          break
        }
      }
    }
    // PLACE refused here (the look, the reach): arm it on the ground ahead as PLACE would (useQuarry arm).
    const q = (await import('/src/store/useQuarry.ts')).useQuarry.getState()
    for (const d of [4, 3, 5]) {
      const x = Math.round(w[0] + fx * d), z = Math.round(w[2] + fz * d)
      for (let y = w[1] + 4; y > w[1] - 24; y--) if (solid(s.world.blockCs(x, y, z)) && !solid(s.world.blockCs(x, y + 1, z))) { if (q.arm([x, y + 1, z])) return `armed (PLACE said: ${[...new Set(why)].join(' | ')})`; break }
    }
    return `nothing: ${[...new Set(why)].join(' | ')}`
  })
  console.log(`${size.name}: placed ${placed}`)
  if (!/^(ahead|armed)/.test(placed)) problems.push(`${size.name}: the charge was not placed`)
  const t0 = Date.now()
  await page.waitForTimeout(1200)
  await shot('3-fuse-9')
  await page.waitForTimeout(Math.max(0, 7600 - (Date.now() - t0)))
  await shot('3-fuse-last-3')
  await page.waitForTimeout(Math.max(0, 9000 - (Date.now() - t0)))
  await shot('3-fuse-1')
  await page.waitForFunction(async () => (await import('/src/store/useQuarry.ts')).useQuarry.getState().charges.length === 0, null, { polling: 20, timeout: 8000 }).catch(() => {})
  const blastAt = Date.now() - t0
  // 5. The stream. Screenshots in this software renderer take a second or more each, so the video holds the motion;
  // a frame just after the blast, the state, then a step toward what is left beyond 7 to draw in the rest.
  const state = () => page.evaluate(async () => {
    const q = (await import('/src/store/useQuarry.ts')).useQuarry.getState()
    const h = await import('/src/store/quarryHoming.ts')
    const t = await import('/src/store/useTerrain.ts')
    const s = t.terrainSession
    const b = { x: 0, y: 0, z: 0 }
    h.readBody(s, b)
    const o = s.world.origin
    const dist = q.drops.map((d) => Math.hypot(Number(BigInt(d.x) - o.x) + 0.5 - b.x, Number(BigInt(d.y) - o.y) + 0.5 - b.y, Number(BigInt(d.z) - o.z) + 0.5 - b.z))
    return { drops: q.drops.length, flying: h.flights.size, blocks: Object.values(t.useTerrain.getState().inventory.counts).reduce((a, b) => a + b, 0), nearest: dist.length ? Math.min(...dist).toFixed(2) : null }
  })
  const b0 = Date.now()
  await shot('4-just-after-blast')
  const stream = [{ ms: Date.now() - b0, ...(await state()) }]
  await page.waitForTimeout(2500)
  stream.push({ ms: Date.now() - b0, ...(await state()) })
  await shot('5-after-stream')
  // A step toward what is left: three cells toward the drops' middle.
  const stepped = await page.evaluate(async () => {
    const q = (await import('/src/store/useQuarry.ts')).useQuarry.getState()
    const c = await import('/src/store/useCyberspace.ts')
    if (!q.drops.length) return false
    let x = 0n, z = 0n
    for (const d of q.drops) { x += BigInt(d.x); z += BigInt(d.z) }
    const n = BigInt(q.drops.length)
    const cur = c.useCyberspace.getState().cursor
    const dx = x / n - cur.x, dz = z / n - cur.z
    const step = (v) => (v > 0n ? (v > 3n ? 3n : v) : v < 0n ? (v < -3n ? -3n : v) : 0n)
    const at = { ...cur, x: cur.x + step(dx), z: cur.z + step(dz) }
    c.useCyberspace.setState({ cursor: at, position: { ...c.useCyberspace.getState().position, x: at.x, z: at.z } })
    return true
  })
  if (stepped) {
    stream.push({ ms: Date.now() - b0, step: true, ...(await state()) })
    await shot('6-step-stream')
    stream.push({ ms: Date.now() - b0, ...(await state()) })
    await page.waitForTimeout(2500)
    stream.push({ ms: Date.now() - b0, ...(await state()) })
    await shot('7-after-step')
  }
  console.log(`${size.name}: blast at ${blastAt} ms; stream`, JSON.stringify(stream))
  log.push({ size: size.name, blastAt, stream })
  const last = stream[stream.length - 1]
  if (!(last.blocks > 24)) problems.push(`${size.name}: nothing flew in`)
  const video = page.video()
  await ctx.close()
  if (video) { const p = await video.path(); renameSync(p, `${OUT}/${size.w}x${size.h}-quarry-homing.webm`) }
}
await browser.close()
writeFileSync(`${OUT}/log.json`, JSON.stringify(log, null, 2))
if (problems.length) { console.log(problems.join('\n')); process.exit(1) }
console.log('all steps shown')
