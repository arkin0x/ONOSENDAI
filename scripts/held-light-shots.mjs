/**
 * held-light-shots.mjs: a glowing block in hand lights where you are
 * (scene/heldLight.ts). Opens TERRAIN, seals you in a dark stone cave (every
 * chunk held filled with Gridstone round a room and a tunnel at your feet),
 * and shoots it holding Gridstone (dark), Glowcore (cyan) and Magmaflow
 * (orange), at a phone's size and a desktop's. Then times the held light's
 * cell change on the page (and, for comparison, one chunk's own light),
 * with the CPU slowed 4 times on the phone run. Nothing reaches a relay:
 * every socket is answered here and every other host is blocked.
 *
 * Usage: start the dev server (npx vite --port 5241), then
 *   node scripts/held-light-shots.mjs [http://localhost:5241/] [out dir]
 */
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { mkdirSync, writeFileSync } from 'node:fs'

const URL = process.argv[2] ?? 'http://localhost:5241/'
const OUT = process.argv[3] ?? 'held-light-shots'
mkdirSync(OUT, { recursive: true })
const SIZES = [
  { name: 'phone', w: 390, h: 844, touch: true, throttle: 4 },
  { name: 'desktop', w: 1440, h: 900, touch: false, throttle: 1 },
]
const HOLD = [
  { name: 'gridstone', id: 1 },
  { name: 'glowcore', id: 42 },
  { name: 'magmaflow', id: 12 },
]

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const results = {}
for (const size of SIZES) {
  const ctx = await browser.newContext(size.touch ? { viewport: { width: size.w, height: size.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: size.w, height: size.h } })
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => r.abort())
  await ctx.routeWebSocket(/.*/, (ws) => { ws.onMessage((raw) => { let m; try { m = JSON.parse(String(raw)) } catch { return } if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]])); else if (m[0] === 'EVENT') ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }) })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`${size.name} page error: ${e.message}`))
  const sk = generateSecretKey(); const pk = getPublicKey(sk); const ns = nip19.nsecEncode(sk)
  await page.addInitScript(([pk, ns]) => { try { localStorage.setItem('onosendai:live', '0'); localStorage.setItem('onosendai:nsec', ns); localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns })) } catch {} }, [pk, ns])
  await page.goto(URL)
  await page.waitForTimeout(9000)
  await page.keyboard.press('Escape')
  // The tutorial's nudge put off, so it does not cover the cave.
  await page.getByRole('button', { name: 'LATER' }).click({ timeout: 2000 }).catch(() => {})
  await page.evaluate(async () => { const pm = await import('/src/store/padMode.ts'); pm.enterTerrainMode() })
  await page.waitForTimeout(4000)
  // The cave: every chunk held solid Gridstone but a room round your feet and a tunnel off it.
  const carved = await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const s = t.terrainSession
    if (!s) return 'no field'
    const [hx, hy, hz] = t.offsetOf(s, t.headNow())
    // A long room ahead (the view looks along +z), a pillar in it, and a low tunnel off its far end round a corner.
    const pillar = (x, z) => x >= hx + 1 && x <= hx + 2 && z >= hz + 5 && z <= hz + 6
    const open = (x, y, z) => (x >= hx - 5 && x <= hx + 5 && y >= hy && y <= hy + 3 && z >= hz - 3 && z <= hz + 13 && !pillar(x, z))
      || (y >= hy && y <= hy + 1 && z >= hz + 14 && z <= hz + 20 && x >= hx - 1 && x <= hx) || (y >= hy && y <= hy + 1 && z === hz + 20 && x >= hx - 8 && x <= hx)
    let n = 0
    for (const slot of s.world.slots) {
      const b = new Uint8Array(32768).fill(1)
      for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
        if (open(32 * slot.off[0] + x, 32 * slot.off[1] + y, 32 * slot.off[2] + z)) b[x | (z << 5) | (y << 10)] = 0
      }
      s.world.setBlocks(slot.key, b.slice(), b)
      n++
    }
    s.version++
    return `${n} chunks round ${hx},${hy},${hz}`
  })
  console.log(`${size.name}: carved ${carved}`)
  await page.waitForTimeout(9000)
  const out = {}
  for (const hold of HOLD) {
    await page.evaluate(async (id) => {
      const t = await import('/src/store/useTerrain.ts')
      const inv = t.useTerrain.getState().inventory
      t.useTerrain.setState({ inventory: { ...inv, hotbar: [id, ...inv.hotbar.slice(1)], counts: { ...inv.counts, [id]: 12 }, slot: 0 } })
    }, hold.id)
    await page.waitForTimeout(2500)
    const lit = await page.evaluate(() => { const d = window.__heldLight; return d ? { lit: d.lit, eye: [...d.eye], stats: { ...d.stats } } : null })
    out[hold.name] = lit
    const file = `${OUT}/held-${hold.name}-${size.w}x${size.h}.png`
    await page.screenshot({ path: file })
    console.log(`${size.name} ${hold.name}: ${JSON.stringify(lit)} -> ${file}`)
  }
  // The cost of a cell change on the page: the held light walked 60 cells through the cave, against one chunk's own light.
  const cdp = size.throttle > 1 ? await ctx.newCDPSession(page) : null
  if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: size.throttle })
  const timing = await page.evaluate(async () => {
    const t = await import('/src/store/useTerrain.ts')
    const h = await import('/src/lib/terrain/heldLight.ts')
    const l = await import('/src/lib/terrain/light.ts')
    const s = t.terrainSession
    const d = window.__heldLight
    const glow = h.heldGlow(42)
    const [ex, ey, ez] = d.eye
    const per = []
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now()
      d.frame({ world: s.world, version: s.version, glow, shading: true, eye: [ex + (i % 9) - 4, ey, ez - Math.floor(i / 9)] })
      per.push(performance.now() - t0)
    }
    // Put it back where the eye is.
    d.frame({ world: s.world, version: s.version, glow, shading: true, eye: [ex, ey, ez] })
    const slot = s.world.slots.find((sl) => sl.blocks)
    const tables = l.lightTables()
    const { around, skyTop } = s.world.lightInputs(slot, (sl) => l.shadedColumns(sl.blocks, tables.pass))
    const chunk = []
    for (let i = 0; i < 6; i++) { const t0 = performance.now(); l.computeLight(around, skyTop, tables); chunk.push(performance.now() - t0) }
    per.sort((a, b) => a - b); chunk.sort((a, b) => a - b)
    const med = (a) => a[Math.floor(a.length / 2)]
    return { heldMedianMs: med(per), heldMaxMs: per[per.length - 1], chunkLightMedianMs: med(chunk) }
  })
  if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  results[size.name] = { ...timing, cpuSlowdown: size.throttle, shots: out }
  console.log(`${size.name} timing: ${JSON.stringify(timing)}`)
  await ctx.close()
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2))
await browser.close()
