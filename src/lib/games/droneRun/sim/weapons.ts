/**
 * weapons.ts - the player's guns, from their WeaponDefs.
 *
 * - Cadence: each gun keeps the time until its next trigger pull (`cool`).
 *   Held, a shot fires whenever it reaches zero and the remainder carries
 *   over, so the average rate is exact whatever the step (a rate of 1.4 a
 *   second fires every 42 or 43 steps, never drifting). Let go, nothing is
 *   banked.
 * - Modes: auto fires while held; semi once a press (held through the
 *   cooldown, it fires as soon as it is ready, then waits for a release);
 *   charge charges while held once ready and fires on release, scaling
 *   damage and range from (damage, range) at charge.minS to (damageMax,
 *   rangeMax) at charge.maxS; let go before minS it fizzles.
 * - Hitscan: each pellet is a straight segment from the eye, in a seeded
 *   random direction inside the spread cone (uniform over the cone's cap),
 *   out to range. It stops at the first solid; along the way it hits the
 *   drones whose spheres it crosses, nearest first, up to 1 + pierce of
 *   them. Damage falls off with distance (falloff).
 * - Projectile: each pellet flies at projectileSpeed, swept every step
 *   against solids and drone spheres the same way (stepProjectiles).
 * - Heat: each pull adds perShot; it cools coolPerS a second, holstered
 *   too; reaching overheatAt locks the gun for lockS. Ammo: each pull spends
 *   one round; an empty mag, or a reload press, reloads for reloadS (on the
 *   gun in hand; switching away cancels it).
 * - Aimed shots: a gun with `assist: "auto"` fires along the step's aim
 *   (RunInput.aim) when it carries one, dead straight (no spread; the two
 *   spread draws are still taken, so the random stream does not depend on
 *   aiming). Any other gun ignores the aim.
 * - The assist roll: each aimed pull draws two numbers from the run's
 *   assist stream (never the guns' stream, so a run without aims draws
 *   exactly what it always drew), always both, in this order: `roll`, then
 *   `turn`. When roll >= the gun's `assistHit` (default 1: never), the pull
 *   goes wide: the first live drone the aimed line meets before a solid,
 *   within range, is the one it was aimed at; every pellet then leaves along
 *   the line from the eye to that drone's centre, tilted away from it by the
 *   angle whose sine is (radius + assistMissBy) / distance (90 degrees when
 *   the eye is that close), toward the side `turn` names (turn * 2 pi round
 *   the line, in the same basis as the spread cone). Its closest pass to the
 *   centre is then radius + assistMissBy: it clears the drone by
 *   assistMissBy. A wide pull whose aimed line meets no drone keeps its aim
 *   (it misses anyway). The shot event says `wide: true`.
 * - Switching takes readyS (default 0.3 s) before the new gun fires; a
 *   charge in progress is dropped.
 *
 * Mutates the arsenal in place; draws spread from the run's weapons RNG and
 * the assist roll from the run's assist RNG, nothing else.
 */

import type { FalloffDef, RunInput, Vec3, WeaponDef } from '../types'
import type { RunEvent } from './events'
import { next, type Rng } from './rng'
import { segmentCast, type Solids } from './solids'

/** Seconds a newly selected gun takes before it fires, when its def says none. */
export const DEFAULT_READY_S = 0.3
/** A player projectile's radius when its def says none. */
export const DEFAULT_PROJECTILE_RADIUS = 0.1
/** How far a wide assisted shot clears the drone's surface when its def says none, gibsons. */
export const DEFAULT_ASSIST_MISS_BY = 1
/** Float slack on the cadence clock. */
const CADENCE_EPS = 1e-9

/** One gun's state. */
export interface GunState {
  /** Seconds until the next pull may fire. */
  cool: number
  heat: number
  /** Seconds of overheat lock left. */
  lock: number
  /** Rounds in the mag (ammo guns). */
  mag: number
  /** Seconds of reload left, 0 when not reloading. */
  reload: number
  /** Seconds charged (charge guns), counted once the gun is ready. */
  charge: number
  charging: boolean
  /** A semi gun has fired this press. */
  latched: boolean
}

/** The guns the player carries. */
export interface Arsenal {
  current: number
  /** Seconds until the gun in hand is ready after a switch. */
  ready: number
  guns: GunState[]
  /** Shots fired, all guns (pulls, not pellets). */
  pulls: number
}

/** A player projectile in flight. */
export interface Projectile {
  id: number
  weapon: number
  pos: Vec3
  vel: Vec3
  radius: number
  travelled: number
  range: number
  damage: number
  pierceLeft: number
  hit: number[]
}

/** What a gun can hit besides solids. */
export interface Target {
  id: number
  pos: Vec3
  radius: number
  hp: number
}

/** A fresh arsenal holding gun 0: every gun cool, full, unlocked. */
export function makeArsenal(defs: readonly WeaponDef[]): Arsenal {
  return { current: 0, ready: 0, pulls: 0, guns: defs.map((d) => ({ cool: 0, heat: 0, lock: 0, mag: d.ammo?.mag ?? 0, reload: 0, charge: 0, charging: false, latched: false })) }
}

/** The damage factor at `dist`: 1 up to start, straight down to minFactor at end, minFactor beyond. */
export function falloffAt(f: FalloffDef | undefined, dist: number): number {
  if (!f || dist <= f.start) return 1
  if (dist >= f.end || f.end <= f.start) return f.minFactor
  return 1 + (f.minFactor - 1) * ((dist - f.start) / (f.end - f.start))
}

/** A unit direction inside the cone of half-angle `deg` around unit `dir`, uniform over the cap (two draws, always). */
export function coneSample(dir: Vec3, deg: number, rng: Rng): Vec3 {
  const a = next(rng), b = next(rng)
  if (!(deg > 0)) return [dir[0], dir[1], dir[2]]
  const cosMax = Math.cos((deg * Math.PI) / 180)
  const cosT = 1 - a * (1 - cosMax)
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT))
  return tilt(dir, cosT, sinT, 2 * Math.PI * b)
}

/** Unit `dir` tilted by the angle whose cosine and sine are `cosT` and `sinT`, toward the side `phi` (radians round dir, in a fixed basis across it). */
export function tilt(dir: Vec3, cosT: number, sinT: number, phi: number): Vec3 {
  // A basis across dir.
  const ref: Vec3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  let ux = dir[1] * ref[2] - dir[2] * ref[1], uy = dir[2] * ref[0] - dir[0] * ref[2], uz = dir[0] * ref[1] - dir[1] * ref[0]
  const ul = Math.hypot(ux, uy, uz)
  ux /= ul; uy /= ul; uz /= ul
  const wx = dir[1] * uz - dir[2] * uy, wy = dir[2] * ux - dir[0] * uz, wz = dir[0] * uy - dir[1] * ux
  const c = Math.cos(phi) * sinT, s = Math.sin(phi) * sinT
  return [dir[0] * cosT + ux * c + wx * s, dir[1] * cosT + uy * c + wy * s, dir[2] * cosT + uz * c + wz * s]
}

/** Where a ray from `o` along unit `d` enters a sphere, or -1 (0 when it starts inside). */
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2]
  const b = ox * d[0] + oy * d[1] + oz * d[2]
  const cc = ox * ox + oy * oy + oz * oz - r * r
  if (cc <= 0) return 0
  const disc = b * b - cc
  if (disc < 0 || b > 0) return -1
  return -b - Math.sqrt(disc)
}

/** Damage dealt this step, for the run to apply. */
export interface DamageHit {
  target: number
  damage: number
  point: Vec3
}

/** Everything one step of the guns needs from the run. */
export interface GunContext {
  defs: readonly WeaponDef[]
  solids: Solids
  targets: readonly Target[]
  rng: Rng
  eye: Vec3
  dir: Vec3
  /**
   * An aimed shot's unit direction this step (RunInput.aim), or null. A gun
   * with `assist: "auto"` fires along it with no spread; any other gun
   * ignores it.
   */
  aim?: Vec3 | null
  /**
   * The run's assist stream: two draws an aimed pull (the roll, then the
   * side of a miss). Absent (a test rig), every aimed pull hits as aimed and
   * nothing is drawn.
   */
  assistRng?: Rng
  dt: number
  events: RunEvent[]
  hits: DamageHit[]
  projectiles: Projectile[]
  /** The next projectile id (advanced in place). */
  ids: { next: number }
}

/** What a hitscan line meets: where the first solid stops it, and the live drones it crosses before that, nearest first. */
export interface HitscanCast { stop: number; along: Array<{ t: number; id: number }> }

/** Scratch: the far end of a hitscan line (read by segmentCast only during the call). */
const castEnd: Vec3 = [0, 0, 0]

/** What a hitscan line from `o` along unit `d` meets within `range`. Fills and returns `out` when given (its list emptied first), so a caller that casts every step makes no new lists. */
export function castHitscan(solids: Solids, targets: readonly Target[], o: Vec3, d: Vec3, range: number, out?: HitscanCast): HitscanCast {
  castEnd[0] = o[0] + d[0] * range; castEnd[1] = o[1] + d[1] * range; castEnd[2] = o[2] + d[2] * range
  const wall = segmentCast(solids, o, castEnd)
  const stop = wall ? wall.t * range : range
  const along = out ? out.along : []
  along.length = 0
  for (const tg of targets) {
    if (tg.hp <= 0) continue
    const t = raySphere(o, d, tg.pos, tg.radius)
    if (t >= 0 && t <= stop) along.push({ t, id: tg.id })
  }
  along.sort((a, b) => a.t - b.t || a.id - b.id)
  if (out) { out.stop = stop; return out }
  return { stop, along }
}

/** Scratch for the assist roll's cast. */
const rollCast: HitscanCast = { stop: 0, along: [] }

/**
 * An aimed pull's direction after the assist roll (see the file header):
 * `aim` as it is on a hit, or the line to the aimed drone tilted wide of it
 * on a miss (with `wide` set on `out`). Draws two numbers from `rng`.
 */
export function rollAim(def: WeaponDef, aim: Vec3, range: number, ctx: Pick<GunContext, 'solids' | 'targets' | 'eye'>, rng: Rng, out: { wide: boolean }): Vec3 {
  const roll = next(rng), turn = next(rng)
  out.wide = false
  if (!(roll >= (def.assistHit ?? 1))) return aim
  out.wide = true
  const o = ctx.eye
  const { along } = castHitscan(ctx.solids, ctx.targets, o, aim, range, rollCast)
  const id = along.length ? along[0].id : -1
  const tg = id < 0 ? undefined : ctx.targets.find((x) => x.id === id)
  if (!tg) return aim
  const cx = tg.pos[0] - o[0], cy = tg.pos[1] - o[1], cz = tg.pos[2] - o[2]
  const dist = Math.hypot(cx, cy, cz)
  if (!(dist > 1e-9)) return aim
  const sinT = Math.min(1, (tg.radius + Math.max(0, def.assistMissBy ?? DEFAULT_ASSIST_MISS_BY)) / dist)
  return tilt([cx / dist, cy / dist, cz / dist], Math.sqrt(1 - sinT * sinT), sinT, 2 * Math.PI * turn)
}

/** One hitscan pellet along `d`: hits up to 1 + pierce drones before the first solid, within `range`. */
function hitscan(ctx: GunContext, w: number, d: Vec3, range: number, damage: number, pierce: number, falloff: FalloffDef | undefined, wide = false): void {
  const o = ctx.eye
  const { stop, along } = castHitscan(ctx.solids, ctx.targets, o, d, range)
  let last = stop
  const n = Math.min(along.length, 1 + pierce)
  for (let i = 0; i < n; i++) {
    const { t, id } = along[i]
    const point: Vec3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]
    ctx.hits.push({ target: id, damage: damage * falloffAt(falloff, t), point })
    if (i === 1 + pierce - 1) last = t
  }
  const end: Vec3 = [o[0] + d[0] * last, o[1] + d[1] * last, o[2] + d[2] * last]
  ctx.events.push(wide ? { type: 'shot', weapon: w, origin: [o[0], o[1], o[2]], dir: d, end, wide: true } : { type: 'shot', weapon: w, origin: [o[0], o[1], o[2]], dir: d, end })
}

/** Scratch: whether this pull's assist roll went wide. */
const rolled = { wide: false }

/** One trigger pull of gun `w` at charge factor `k` (0 for a non-charge gun). */
function pull(ctx: GunContext, a: Arsenal, w: number, k: number): void {
  const def = ctx.defs[w], g = a.guns[w]
  const damage = def.charge ? def.damage + (def.charge.damageMax - def.damage) * k : def.damage
  const range = def.charge ? def.range + (def.charge.rangeMax - def.range) * k : def.range
  const pellets = Math.max(1, Math.floor(def.pellets ?? 1))
  const pierce = Math.max(0, Math.floor(def.pierce ?? 0))
  // An aimed shot skips the cone but draws the same two numbers, so the guns' random stream is the same whether or not a step was aimed.
  // Its assist roll draws from the assist stream alone, once a pull.
  rolled.wide = false
  const aimed = def.assist === 'auto' && ctx.aim ? (ctx.assistRng ? rollAim(def, ctx.aim, range, ctx, ctx.assistRng, rolled) : ctx.aim) : null
  for (let p = 0; p < pellets; p++) {
    const d = aimed ? coneSample(aimed, 0, ctx.rng) : coneSample(ctx.dir, def.spread, ctx.rng)
    if (def.fire === 'projectile') {
      const speed = def.projectileSpeed ?? 60
      const id = ctx.ids.next++
      ctx.projectiles.push({ id, weapon: w, pos: [ctx.eye[0], ctx.eye[1], ctx.eye[2]], vel: [d[0] * speed, d[1] * speed, d[2] * speed], radius: def.projectileRadius ?? DEFAULT_PROJECTILE_RADIUS, travelled: 0, range, damage, pierceLeft: pierce, hit: [] })
      ctx.events.push({ type: 'shot', weapon: w, origin: [ctx.eye[0], ctx.eye[1], ctx.eye[2]], dir: d, end: [ctx.eye[0], ctx.eye[1], ctx.eye[2]], projectile: id })
    } else hitscan(ctx, w, d, range, damage, pierce, def.falloff, rolled.wide)
  }
  a.pulls++
  g.cool += 1 / def.rate
  if (def.heat) {
    g.heat += def.heat.perShot
    if (g.heat >= def.heat.overheatAt - CADENCE_EPS) { g.lock = def.heat.lockS; g.charging = false; g.charge = 0; ctx.events.push({ type: 'overheated', weapon: w }) }
  }
  if (def.ammo) {
    g.mag -= 1
    if (g.mag <= 0) { g.mag = 0; startReload(ctx, g, def, w) }
  }
}

function startReload(ctx: GunContext, g: GunState, def: WeaponDef, w: number): void {
  if (!def.ammo || g.reload > 0 || g.mag >= def.ammo.mag) return
  g.reload = def.ammo.reloadS
  g.charging = false
  g.charge = 0
  ctx.events.push({ type: 'reload-started', weapon: w })
}

/** Whether gun `w` may pull now (ignoring its cadence clock). */
function armed(a: Arsenal, def: WeaponDef, g: GunState): boolean {
  return a.ready <= 0 && g.lock <= 0 && g.reload <= 0 && (!def.ammo || g.mag > 0)
}

/** One step of the guns: switch, cool, reload, fire. Fills ctx.events, ctx.hits and ctx.projectiles. */
export function stepGuns(a: Arsenal, input: Pick<RunInput, 'fire' | 'select' | 'reload'>, ctx: GunContext): void {
  const { defs, dt } = ctx
  // Switching.
  if (input.select !== null && Number.isInteger(input.select) && input.select >= 0 && input.select < defs.length && input.select !== a.current) {
    const from = a.current, old = a.guns[from]
    old.charging = false; old.charge = 0; old.latched = false
    if (old.reload > 0) old.reload = 0
    a.current = input.select
    a.ready = defs[a.current].readyS ?? DEFAULT_READY_S
    ctx.events.push({ type: 'weapon-switched', from, to: a.current })
  }
  // Every gun cools; the overheat lock runs out.
  defs.forEach((def, w) => {
    const g = a.guns[w]
    if (def.heat) g.heat = Math.max(0, g.heat - def.heat.coolPerS * dt)
    if (g.lock > 0) g.lock = Math.max(0, g.lock - dt)
  })
  a.ready = Math.max(0, a.ready - dt)
  const w = a.current, def = defs[w], g = a.guns[w]
  // Reloading the gun in hand.
  if (input.reload) startReload(ctx, g, def, w)
  if (g.reload > 0) {
    g.reload -= dt
    if (g.reload <= CADENCE_EPS) { g.reload = 0; g.mag = def.ammo!.mag; ctx.events.push({ type: 'reloaded', weapon: w }) }
  }
  if (def.mode === 'auto') {
    while (input.fire && g.cool <= CADENCE_EPS && armed(a, def, g)) pull(ctx, a, w, 0)
  } else if (def.mode === 'semi') {
    if (!input.fire) g.latched = false
    else if (!g.latched && g.cool <= CADENCE_EPS && armed(a, def, g)) { pull(ctx, a, w, 0); g.latched = true }
  } else {
    const c = def.charge ?? { minS: 0, maxS: 0, damageMax: def.damage, rangeMax: def.range }
    if (input.fire) {
      if (g.charging) g.charge += dt
      else if (g.cool <= CADENCE_EPS && armed(a, def, g)) { g.charging = true; g.charge = 0 }
    } else if (g.charging) {
      g.charging = false
      if (g.charge + CADENCE_EPS >= c.minS && armed(a, def, g)) {
        const k = c.maxS > c.minS ? Math.min(1, Math.max(0, (g.charge - c.minS) / (c.maxS - c.minS))) : 1
        g.cool = Math.max(g.cool, 0)
        pull(ctx, a, w, k)
      } else ctx.events.push({ type: 'charge-fizzled', weapon: w })
      g.charge = 0
    }
  }
  // The clock runs after the trigger is served, so a pull from rest fires at once and the next comes a full 1 / rate later.
  g.cool -= dt
  // Nothing banked while not firing.
  if (!input.fire || !armed(a, def, g)) g.cool = Math.max(g.cool, 0)
}

/** One step of the player's projectiles in flight: swept against drone spheres and solids. Mutates `list`. */
export function stepProjectiles(ctx: GunContext): void {
  const list = ctx.projectiles
  const keep: Projectile[] = []
  for (const p of list) {
    const speed = Math.hypot(p.vel[0], p.vel[1], p.vel[2])
    const len = Math.min(speed * ctx.dt, p.range - p.travelled)
    const d: Vec3 = speed > 0 ? [p.vel[0] / speed, p.vel[1] / speed, p.vel[2] / speed] : [0, 0, -1]
    const end: Vec3 = [p.pos[0] + d[0] * len, p.pos[1] + d[1] * len, p.pos[2] + d[2] * len]
    const wall = segmentCast(ctx.solids, p.pos, end)
    const stop = wall ? wall.t * len : len
    const along: Array<{ t: number; id: number }> = []
    for (const tg of ctx.targets) {
      if (tg.hp <= 0 || p.hit.includes(tg.id)) continue
      const t = raySphere(p.pos, d, tg.pos, tg.radius + p.radius)
      if (t >= 0 && t <= stop) along.push({ t, id: tg.id })
    }
    along.sort((a, b) => a.t - b.t || a.id - b.id)
    let ended: Vec3 | null = null
    for (const { t, id } of along) {
      const point: Vec3 = [p.pos[0] + d[0] * t, p.pos[1] + d[1] * t, p.pos[2] + d[2] * t]
      ctx.hits.push({ target: id, damage: p.damage * falloffAt(ctx.defs[p.weapon].falloff, p.travelled + t), point })
      p.hit.push(id)
      if (p.pierceLeft-- <= 0) { ended = point; break }
    }
    if (!ended && (wall || p.travelled + len >= p.range - 1e-9)) ended = wall ? wall.point : end
    if (ended) { ctx.events.push({ type: 'projectile-ended', id: p.id, at: ended }); continue }
    p.pos = end
    p.travelled += len
    keep.push(p)
  }
  list.length = 0
  list.push(...keep)
}
