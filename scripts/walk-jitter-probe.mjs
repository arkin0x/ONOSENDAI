/**
 * walk-jitter-probe.mjs: fluid WALK's speed and the people standing near it,
 * measured frame by frame in a real browser, offline (2026-11-18).
 *
 * Two things the owner saw (arkinox, 2026-11-18): "my walk speed seems slow
 * ... maybe faster when i go diagonal", and "every chain action that
 * resolves causes the other avatar in my hud to jitter". This walks for
 * real, straight and then diagonally, with two other people standing still
 * beside the walk (one a target with its HUD marker, one a passer-by), and
 * records, for every drawn frame (scene/WalkProbe.tsx, DEV only):
 *
 * | Reading | What it shows |
 * |---|---|
 * | the eye against a fixed world point | how fast the walk goes, gibsons a second |
 * | each other avatar against the same point | must not move at all: they stand still |
 * | each other avatar on the screen, and its HUD marker | must move only as smoothly as the eye does |
 * | your chain's length | when a proof landed |
 *
 * Never on the wire: LOCAL before anything (the run aborts otherwise), every
 * origin but localhost refused, and every WebSocket answered by an empty
 * in-process relay. A throwaway key, made here and never kept, signs.
 * Nothing can be published.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=<browsers> \
 *   node scripts/walk-jitter-probe.mjs http://localhost:5199/ <out dir>
 * Env: LAG=<ms> holds each proof back as a slower phone's are; HOLD=<ms>
 * for each walk (4000); VIDEO=1 records <out>/walk.webm at 375x812; GRAVITY=0
 * walks with gravity off.
 * Exits 1 when a check fails.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'

const [url, out] = process.argv.slice(2)
if (!url || !out) { console.log('usage: walk-jitter-probe.mjs <url> <out dir>'); process.exit(2) }
fs.mkdirSync(out, { recursive: true })
const fails = []
const check = (ok, what) => { if (!ok) fails.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const size = { width: 375, height: 812 }
const ctx = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, ...(process.env.VIDEO ? { recordVideo: { dir: out, size } } : {}) })
// Only this machine: matched on the host name itself, so no other host can pass for it.
const LOCAL = new Set(['localhost', '127.0.0.1'])
const local = (u) => { try { return LOCAL.has(new URL(u).hostname) } catch { return false } }
await ctx.route((u) => !local(u.toString()), (r) => r.abort())
const sent = []
await ctx.routeWebSocket(/.*/, (ws) => {
  if (local(ws.url())) { ws.connectToServer(); return }
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]]))
    else if (m[0] === 'EVENT') { sent.push(m[1].kind); ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
})
const page = await ctx.newPage()
const sk = generateSecretKey()
await page.addInitScript(([pk, ns]) => {
  try {
    localStorage.setItem('onosendai:live', '0')
    localStorage.setItem('onosendai:tutorial', 'off')
    localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns }))
  } catch {}
  // Each message to a proof worker held back window.__proofLag ms, in order: a slower phone's proofs.
  window.__proofLag = 0
  const post = Worker.prototype.postMessage
  let last = 0
  Worker.prototype.postMessage = function (...args) {
    const due = Math.max(Date.now() + window.__proofLag, last + 1)
    if (due <= Date.now()) { post.apply(this, args); return }
    last = due
    setTimeout(() => post.apply(this, args), due - Date.now())
  }
}, [getPublicKey(sk), nip19.nsecEncode(sk)])
page.on('pageerror', (e) => { if (!/Failed to fetch/.test(e.message)) console.log(`PAGEERROR: ${e.message}`) })
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(6000)
if ((await page.evaluate(() => window.__store.getState().live)) !== false) { console.log('ABORT: not LOCAL'); await browser.close(); process.exit(2) }
// A wide flat floor under the walk (300 gibsons square), as the owner walks on a shard's floor.
await page.evaluate(async () => {
  const { withConstrain } = await import('/src/lib/walkConstrain.ts')
  const { useShards } = await import('/src/store/useShards.ts')
  const s = window.__store.getState()
  const vertices = []
  const faces = []
  const lo = [-150, -1, -150], hi = [150, 0, 150]
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) vertices.push({ p: [x, y, z], c: [0.04, 0.1, 0.16] })
  for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) faces.push([a, b, c], [a, c, d])
  const shard = withConstrain({ id: 'floor-probe', name: 'Floor', unit: 0, extent: 8, mode: 'solid', vertices, faces, up: false, spin: 0, updatedAt: Date.now() }, 'all')
  const item = { key: 'floor-probe', type: 'shard', at: { x: s.position.x, y: s.position.y - 1n, z: s.position.z }, plane: s.plane, height: 84, mine: false, shard }
  useShards.setState({ worldItems: () => [item] })
})
await page.waitForTimeout(1000)

const gravity = process.env.GRAVITY !== '0'
await page.evaluate((g) => { window.__walk.getState().setGravity(g); window.__walk.getState().enter() }, gravity)
await page.waitForTimeout(1500)
console.log('in WALK:', await page.evaluate(() => { const w = window.__walk.getState(); return { gravity: w.gravity, falling: w.falling } }))
if (!(await page.evaluate(() => window.__store.getState().walking))) { console.log('ABORT: not in WALK'); await browser.close(); process.exit(2) }

const idle = () => page.evaluate(() => { const w = window.__walk.getState(); return w.behind === 0 && w.open === null && w.running === null && !w.falling })
async function stand() { for (let i = 0; i < 1200 && !(await idle()); i++) await page.waitForTimeout(100); await page.waitForTimeout(800) }

// One step first, so there is a chain to walk from, and everything has landed.
for (let tries = 0; tries < 20 && (await page.evaluate(() => window.__store.getState().events.length)) < 2; tries++) {
  await page.keyboard.down('w'); await page.waitForTimeout(400); await page.keyboard.up('w'); await stand()
}
if ((await page.evaluate(() => window.__store.getState().events.length)) < 2) { console.log('ABORT: the first step never landed'); await browser.close(); process.exit(2) }

// Two people standing still near the walk: a target (with its HUD marker) and a passer-by.
const people = await page.evaluate(async (env) => {
  const process = { env }
  const { drawnAvatars, targetScreens } = await import('/src/lib/targets.ts')
  window.__targetScreens = targetScreens
  const { fluidMotion, walkLookDirection } = await import('/src/store/walkFluid.ts')
  window.__drawnAvatars = drawnAvatars
  window.__fluidMotion = fluidMotion
  // In front of the walk, along the way it faces, a little to each side.
  const look = walkLookDirection()
  const axisOf = (v) => { const a = ['x', 'y', 'z'].reduce((b, k) => (Math.abs(v[k]) > Math.abs(v[b]) ? k : b), 'x'); return { a, d: v[a] > 0 ? 1n : -1n } }
  const f = axisOf(look.valid ? look.forward : { x: 0, y: 0, z: -1 })
  const r = axisOf(look.valid ? look.right : { x: 1, y: 0, z: 0 })
  const s = window.__store.getState()
  const at = (ahead, side) => { const p = { ...s.position }; p[f.a] += f.d * BigInt(ahead); p[r.a] += r.d * BigInt(side); return p }
  const target = 'a'.repeat(64)
  const passer = 'b'.repeat(64)
  const placeTarget = () => window.__store.setState({ targets: { [target]: { pubkey: target, npub: 'npub1target', name: 'STILL TARGET', position: at(Number(process.env.AHEAD ?? 70), 4), plane: s.headPlane, lastActive: null, status: 'live' } } })
  placeTarget()
  // The tracker looks the made-up target up and puts it at its spawn: put it back once that is done.
  await new Promise((done) => setTimeout(done, 3000))
  placeTarget()
  const now = Math.floor(Date.now() / 1000)
  window.__presence.setState({ people: { [passer]: { pubkey: passer, position: at(Number(process.env.AHEAD ?? 70) + 8, -4), plane: s.headPlane, lastActive: now, type: 'hop', checkedAt: now, actionId: 'x'.repeat(64) } } })
  return { target, passer }
}, { AHEAD: process.env.AHEAD })
await page.waitForTimeout(1500)
console.log('people drawn:', await page.evaluate(({ target, passer }) => ({ target: !!window.__drawnAvatars[target], passer: !!window.__drawnAvatars[passer], targets: Object.keys(window.__store.getState().targets).length }), people))

// Every drawn frame: the eye and each other avatar against the probe's fixed
// world point, each avatar's place on the screen, and each HUD marker's.
await page.evaluate(({ target, passer }) => {
  const rows = []
  window.__rows = rows
  const trace = []
  trace.push = function (e) {
    const probe = [e.cam[0] - e.rel[0], e.cam[1] - e.rel[1], e.cam[2] - e.rel[2]]
    const ts = window.__targetScreens[target]
    const row = { t: e.t, frame: e.frame, eye: e.rel, q: e.q, events: e.events, behind: e.behind, people: {}, hudNdc: ts ? (ts.avatar ? [ts.avatar.x, ts.avatar.y, 'avatar'] : [ts.x, ts.y, 'point']) : null }
    for (const pk of [target, passer]) {
      const g = window.__drawnAvatars[pk]
      if (!g) continue
      // The group's world point as this frame draws it, and on the screen.
      const m = g.matrixWorld.elements
      const w = [m[12], m[13], m[14]]
      // On the screen, in px from the middle: the point in the camera's frame (its quaternion inverted), then the lens (FOV 55).
      const d = [w[0] - e.cam[0], w[1] - e.cam[1], w[2] - e.cam[2]]
      const [qx, qy, qz, qw] = e.q
      // v' = q^-1 v q, by the cross-product form with the conjugate.
      const ix = -qx, iy = -qy, iz = -qz
      const tx = 2 * (iy * d[2] - iz * d[1]), ty = 2 * (iz * d[0] - ix * d[2]), tz = 2 * (ix * d[1] - iy * d[0])
      const vx = d[0] + qw * tx + (iy * tz - iz * ty), vy = d[1] + qw * ty + (iz * tx - ix * tz), vz = d[2] + qw * tz + (ix * ty - iy * tx)
      const k = (window.innerHeight / 2) / Math.tan((55 * Math.PI) / 360)
      const ndc = vz < 0 ? [(vx / -vz) * k, (vy / -vz) * k] : null
      row.people[pk] = { world: [w[0] - probe[0], w[1] - probe[1], w[2] - probe[2]], ndc }
    }
    rows.push(row)
    return Array.prototype.push.call(this, e)
  }
  window.__walkTrace = trace
  // The HUD markers, as the screen shows them, each animation frame.
  const hud = []
  window.__hud = hud
  const tick = () => {
    const el = document.querySelector(`[data-target="${target}"]`)
    const tr = el?.style.transform ?? ''
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(tr)
    if (m) hud.push({ t: performance.now(), x: Number(m[1]), y: Number(m[2]), events: window.__store.getState().events.length })
    window.__hudRaf = requestAnimationFrame(tick)
  }
  tick()
}, people)
const lag = Number(process.env.LAG ?? 0)
if (lag) await page.evaluate((ms) => { window.__proofLag = ms }, lag)
const hold = Number(process.env.HOLD ?? 4000)
const marks = []
const mark = async (name) => marks.push({ name, t: await page.evaluate(() => performance.now()) })
await mark('straight')
await page.keyboard.down('w'); await page.waitForTimeout(hold); await page.keyboard.up('w')
await mark('stop1')
await page.waitForTimeout(1500)
await mark('diagonal')
await page.keyboard.down('w'); await page.keyboard.down('d'); await page.waitForTimeout(hold); await page.keyboard.up('d'); await page.keyboard.up('w')
await mark('stop2')
await page.evaluate(() => { window.__proofLag = 0 })
await stand()
await mark('end')
const r = await page.evaluate(() => ({ rows: window.__rows, hud: window.__hud }))
fs.writeFileSync(`${out}/frames.json`, JSON.stringify({ marks, ...r, people }))

// --- analysis ---
const at = (name) => marks.find((m) => m.name === name).t
const inRange = (a, b) => r.rows.filter((x) => x.t >= a && x.t <= b)
function speed(a, b) {
  // The last 60% of the hold, at full speed, over frames under 240 ms apart:
  // a longer frame is walked as 250 ms (store/walkFluid.ts MAX_DT), which a
  // loaded software renderer reaches and a phone never does.
  const rows = inRange(a + (b - a) * 0.4, b - 50)
  let d = 0, ms = 0, n = 0
  for (let i = 1; i < rows.length; i++) {
    const dt = rows[i].t - rows[i - 1].t
    if (dt >= 240) continue
    const p = rows[i - 1].eye, q = rows[i].eye
    d += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); ms += dt; n++
  }
  return { speed: ms > 0 ? d / (ms / 1000) : NaN, frames: n, fps: rows.length > 1 ? (rows.length - 1) / ((rows[rows.length - 1].t - rows[0].t) / 1000) : 0 }
}
const st = speed(at('straight'), at('stop1'))
const dg = speed(at('diagonal'), at('stop2'))
console.log(`straight: ${st.speed.toFixed(2)} gibsons/s over ${st.frames} frames (${st.fps?.toFixed(1)} fps)`)
console.log(`diagonal: ${dg.speed.toFixed(2)} gibsons/s over ${dg.frames} frames (${dg.fps?.toFixed(1)} fps)`)
check(Math.abs(dg.speed - st.speed) / st.speed < 0.08, `diagonal (${dg.speed.toFixed(2)}) is as fast as straight (${st.speed.toFixed(2)}), within 8%`)

const landings = r.rows.filter((x, i) => i > 0 && x.events > r.rows[i - 1].events).length
console.log(`proofs landed during the trace: ${landings}`)
for (const [name, pk] of [['target', people.target], ['passer-by', people.passer]]) {
  const rows = r.rows.filter((x) => x.people[pk])
  let worst = 0, worstAtLanding = 0
  const base = rows[0]?.people[pk].world
  for (let i = 0; i < rows.length; i++) {
    const w = rows[i].people[pk].world
    const d = Math.hypot(w[0] - base[0], w[1] - base[1], w[2] - base[2])
    worst = Math.max(worst, d)
    const landed = i > 0 && rows[i].events > rows[i - 1].events
    if (landed || (i > 1 && rows[i - 1].events > rows[i - 2].events)) worstAtLanding = Math.max(worstAtLanding, d)
  }
  console.log(`${name}: ${rows.length} frames drawn; furthest its drawn world point moved ${worst.toFixed(4)} (at a landing ${worstAtLanding.toFixed(4)})`)
  check(rows.length > 20 && worst < 1e-3, `${name}: standing still, its drawn world point never moved (${worst.toFixed(4)} render cells)`)
}
// Standing still (the eye and the camera's turn unchanged from one drawn
// frame to the next), nothing on the screen may move: not the avatars, not
// the HUD's label under the target. The frames a proof landed on are counted.
{
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
  let still = 0, stillLandings = 0, hudMove = 0, hudMoveAtLanding = 0, avatarMove = 0
  const half = size.height / 2
  for (let i = 1; i < r.rows.length; i++) {
    const a = r.rows[i - 1], b = r.rows[i]
    if (!same(a.eye, b.eye) || !same(a.q, b.q)) continue
    still++
    const landed = b.events !== a.events
    if (landed) stillLandings++
    if (a.hudNdc && b.hudNdc && a.hudNdc[2] === b.hudNdc[2]) {
      const d = Math.hypot(b.hudNdc[0] - a.hudNdc[0], b.hudNdc[1] - a.hudNdc[1]) * half
      hudMove = Math.max(hudMove, d)
      if (landed || (i > 1 && a.events !== r.rows[i - 2].events)) hudMoveAtLanding = Math.max(hudMoveAtLanding, d)
    }
    for (const pk of [people.target, people.passer]) {
      const pa = a.people[pk]?.ndc, pb = b.people[pk]?.ndc
      if (pa && pb) avatarMove = Math.max(avatarMove, Math.hypot(pb[0] - pa[0], pb[1] - pa[1]))
    }
  }
  console.log(`standing still: ${still} frame pairs, ${stillLandings} with a proof landing; the HUD label moved up to ${hudMove.toFixed(2)} px (${hudMoveAtLanding.toFixed(2)} px around a landing); the avatars up to ${avatarMove.toFixed(2)} px`)
  check(stillLandings >= 1, `a proof landed while standing still (${stillLandings})`)
  check(hudMove < 0.5, `standing still, the target's HUD label never moved (${hudMove.toFixed(2)} px)`)
  check(avatarMove < 0.5, `standing still, the other avatars never moved on the screen (${avatarMove.toFixed(2)} px)`)
}
// The HUD marker as the page shows it, sampled every animation frame, while
// standing (from 0.5 s after each stop, past the coast): it must not move,
// landings included.
{
  let move = 0, landings = 0
  const h = r.hud
  const standing = (t) => (t >= at('stop1') + 500 && t <= at('diagonal')) || (t >= at('stop2') + 500 && t <= at('end'))
  for (let i = 1; i < h.length; i++) {
    if (!standing(h[i - 1].t) || !standing(h[i].t)) continue
    move = Math.max(move, Math.hypot(h[i].x - h[i - 1].x, h[i].y - h[i - 1].y))
    // A landing counts when the next sample is still standing, so its frame and the one after are both seen.
    if (h[i].events !== h[i - 1].events && i + 1 < h.length && standing(h[i + 1].t)) landings++
  }
  console.log(`HUD marker on the page, standing: moved up to ${move.toFixed(2)} px over ${landings} landings`)
  check(landings >= 1 && move < 0.5, `standing, the HUD marker on the page never moved, landings included (${move.toFixed(2)} px, ${landings} landings)`)
}
check(sent.length === 0, `nothing was sent to a relay (${sent.length})`)
await page.screenshot({ path: `${out}/end.png` })
const video = page.video()
await ctx.close()
if (video) fs.renameSync(await video.path(), `${out}/walk.webm`)
await browser.close()
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.join('\n')}` : '\nall checks passed')
process.exit(fails.length ? 1 : 0)
