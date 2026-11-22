/**
 * stairs-eye-probe.mjs: the WALK camera stood on stairs, in a real browser,
 * offline (2026-11-22).
 *
 * The owner saw (arkinox, 2026-11-22): "walking up stairs, i get these
 * full-screen glitches where it looks like my avatar falls down under the
 * stairs or something for just a frame"; "at the end of the clip, I stop on
 * the stairs and look around, and you can see when i look forward the screen
 * glitches out". This builds a staircase of boxes in front of the walker
 * (risers of 1 every 1, up along +Z, the way WALK first looks), wears a
 * stand-in avatar with his operative's eye (2.8 up, 0.27 toward the nose),
 * and stands on a step `GAP` gibsons short of the next riser, which is where
 * a walker is on the frame before it steps up:
 *
 * | Picture | What it shows |
 * |---|---|
 * | `orbit.png` | the staircase from the orbit, before WALK |
 * | `stop-forward.png` | facing the riser (the glitch was the camera down at the feet, on the step) |
 * | `stop-left.png`, `stop-right.png` | turned away from it, by a drag |
 * | `stop-forward-again.png` | facing it again |
 *
 * Each picture's camera (scene/WalkProbe.tsx, DEV) is measured against the
 * stairs: its height over the feet and its room from the nearest step. The
 * frame-by-frame climb is checked at 60 fps in
 * src/store/__tests__/walkStairsEye.test.ts; a software renderer draws too
 * few frames a second here, and below 20 the rig eases rather than follows.
 *
 * Never on the wire: LOCAL before anything (the run aborts otherwise), every
 * origin but localhost refused, and every WebSocket answered by an empty
 * in-process relay. A throwaway key, made here and never kept, signs.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=<browsers> \
 *   node scripts/stairs-eye-probe.mjs http://localhost:5199/ <out dir>
 * Env: GAP=<gibsons> (0.05). Prints a JSON summary; exits 1 when the camera
 * is nearer a step than the near plane or down at the feet in any picture.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'

const [url, out] = process.argv.slice(2)
if (!url || !out) { console.log('usage: stairs-eye-probe.mjs <url> <out dir>'); process.exit(2) }
fs.mkdirSync(out, { recursive: true })
const GAP = Number(process.env.GAP ?? 0.05)

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const size = { width: 375, height: 812 }
const ctx = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true })
const LOCAL = new Set(['localhost', '127.0.0.1'])
const local = (u) => { try { return LOCAL.has(new URL(u).hostname) } catch { return false } }
await ctx.route((u) => !local(u.toString()), (r) => r.abort())
await ctx.routeWebSocket(/.*/, (ws) => {
  if (local(ws.url())) { ws.connectToServer(); return }
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]]))
    else if (m[0] === 'EVENT') ws.send(JSON.stringify(['OK', m[1].id, true, '']))
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
})
const page = await ctx.newPage()
const sk = generateSecretKey()
const pk = getPublicKey(sk)
await page.addInitScript(([pub, ns]) => {
  try {
    localStorage.setItem('onosendai:live', '0')
    localStorage.setItem('onosendai:tutorial', 'off')
    localStorage.setItem('onosendai:nsec', ns)
    localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pub, nsec: ns }))
  } catch {}
}, [pk, nip19.nsecEncode(sk)])
page.on('pageerror', (e) => { if (!/Failed to fetch/.test(e.message)) console.log(`PAGEERROR: ${e.message}`) })
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction(() => window.__store && window.__walk && window.__avatars && window.__shards, null, { timeout: 120000 })
await page.waitForTimeout(4000)
if ((await page.evaluate(() => window.__store.getState().live)) !== false) { console.log('ABORT: not LOCAL'); await browser.close(); process.exit(2) }

// The staircase (boxes, gibsons from the start gibson's centre, cyberspace axes) and the avatar.
// Tread k runs along Z from FIRST + (k - 1) * RUN to FIRST + k * RUN, its top LOW + k * RISE: the
// walker starts on tread 0, the next riser FIRST ahead of its gibson's centre, steps behind it too.
const LOW = -0.4, FIRST = 0.3, RISE = 1, RUN = 1
const stairs = []
for (let k = -3; k <= 5; k++) stairs.push([[-40, -12, k === -3 ? -40 : FIRST + (k - 1) * RUN], [40, LOW + k * RISE, k === 5 ? 60 : FIRST + k * RUN]])
await page.evaluate(async ([list, me]) => {
  const { withConstrain } = await import('/src/lib/walkConstrain.ts')
  const { useFluidWalk } = await import('/src/store/fluidSwitch.ts')
  const vertices = []
  const faces = []
  const vert = (x, y, z, c) => {
    const t = [x, y, z].map((v) => Math.round(v * 120))
    const p = t.map((v) => Math.floor(v / 120))
    const r = t.map((v, n) => v - p[n] * 120)
    vertices.push(r.some((v) => v !== 0) ? { p, t: r, c } : { p, c })
  }
  list.forEach(([lo, hi], n) => {
    const base = vertices.length
    const c = n % 2 ? [0.85, 0.5, 0.15] : [0.12, 0.2, 0.4]
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) vert(x, y, z, c)
    for (const [a, b, cc, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) faces.push([base + a, base + b, base + cc], [base + a, base + cc, base + d])
  })
  const shard = withConstrain({ id: 'stairs-probe', name: 'Stairs', unit: 0, extent: 8, mode: 'solid', vertices, faces, up: false, spin: 0, updatedAt: Date.now() }, 'all')
  window.__stairsShard = shard
  // A stand-in 3 gibsons tall wearing his operative's eye: 2.8 up, 0.27 toward the nose (payload -Z).
  const avatar = { id: 'operative-probe', name: 'Operative', unit: 0, extent: 8, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [0, 3, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }], faces: [[0, 1, 2]], extra: { eye: [4, 336, -32] }, up: false, spin: 0, updatedAt: Date.now() }
  window.__avatars.setState((a) => ({ shards: { ...a.shards, [me]: avatar } }))
  useFluidWalk.setState({ on: true })
}, [stairs, pk])
await page.waitForTimeout(1000)
// Placed where the walk starts, the cursor's gibson, just before WALK (the spawn has settled by now).
const start = await page.evaluate(() => {
  const s = window.__store.getState()
  const item = { key: 'stairs-probe', type: 'shard', at: { ...s.cursor }, plane: s.plane, height: 84, mine: false, shard: window.__stairsShard }
  // A fresh `discovered` too, so the scene's shard list (scene/WorldShards.tsx) is built again with it.
  window.__shards.setState((st) => ({ worldItems: () => [item], discovered: { ...st.discovered } }))
  return [String(s.cursor.x), String(s.cursor.y), String(s.cursor.z)]
})
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/orbit.png` })
await page.evaluate(() => { window.__walk.getState().setGravity(true); window.__walk.getState().enter() })
await page.waitForTimeout(2500)
if (!(await page.evaluate(() => window.__store.getState().walking))) { console.log('ABORT: not in WALK'); await browser.close(); process.exit(2) }
if (!(await page.evaluate(() => window.__walk.getState().gravity))) { console.log('ABORT: gravity went off (no stairs under the walker)'); await browser.close(); process.exit(2) }
await page.screenshot({ path: `${out}/start.png` })

// How far a point is outside the stairs (negative inside a step).
const clearance = (p) => {
  let best = Infinity
  for (const [lo, hi] of stairs) {
    const q = [0, 1, 2].map((i) => Math.max(lo[i] - p[i], p[i] - hi[i]))
    best = Math.min(best, Math.hypot(...q.map((v) => Math.max(v, 0))) + Math.min(Math.max(q[0], q[1], q[2]), 0))
  }
  return best
}
// A WalkProbe reading (render cells from its fixed gibson's centre) as cyberspace gibsons from `start`.
const axes = await page.evaluate(() => window.__store.getState().axes())
const toCs = (f) => {
  const v = { x: 0, y: 0, z: 0 }
  v[axes.right.axis] = f.rel[0] * axes.right.dir
  v[axes.up.axis] = f.rel[1] * axes.up.dir
  v[axes.out.axis] = f.rel[2] * axes.out.dir
  return [0, 1, 2].map((i) => Number(BigInt(f.base[i]) - BigInt(start[i])) + [v.x, v.y, v.z][i])
}

// Stood still on tread 0, GAP short of the riser ahead, facing it: where a walker is on the frame before it steps up.
const stood = await page.evaluate(async ([gap, first]) => {
  const { fluidState } = await import('/src/store/walkFluid.ts')
  const st = fluidState()
  st.v = { x: 0, y: 0, z: 0 }
  st.frac = { x: 0, y: 0, z: first - gap }
  return { feet: [0, 0, first - gap] }
}, [GAP, FIRST])
stood.feet[1] = LOW
await page.waitForTimeout(1500)
const still = async () => {
  await page.evaluate(() => { window.__walkTrace = [] })
  await page.waitForTimeout(600)
  const t = await page.evaluate(() => { const t = window.__walkTrace; window.__walkTrace = undefined; return t })
  if (!t.length) return null
  const c = toCs(t[t.length - 1])
  return { cam: c.map((v) => Math.round(v * 1000) / 1000), overFeet: Math.round((c[1] - stood.feet[1]) * 1000) / 1000, room: Math.round(clearance(c) * 1000) / 1000 }
}
const looks = {}
looks.forward = await still()
await page.screenshot({ path: `${out}/stop-forward.png` })
// Look left and right: a drag across the scene turns the WALK camera.
const drag = async (dx) => {
  await page.mouse.move(size.width / 2, size.height / 3)
  await page.mouse.down()
  await page.mouse.move(size.width / 2 + dx, size.height / 3, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(800)
}
await drag(120); looks.left = await still(); await page.screenshot({ path: `${out}/stop-left.png` })
await drag(-240); looks.right = await still(); await page.screenshot({ path: `${out}/stop-right.png` })
await drag(120); looks.forwardAgain = await still(); await page.screenshot({ path: `${out}/stop-forward-again.png` })

const summary = { gap: GAP, stood, looks }
console.log(JSON.stringify(summary))
fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2))
await browser.close()
// Every picture: out of the steps by the near plane's room (0.05 cells, its corners a little more), and well up off the feet.
const ok = Object.values(looks).every((l) => l && l.room > 0.075 && l.overFeet > 0.5)
process.exit(ok ? 0 : 1)
