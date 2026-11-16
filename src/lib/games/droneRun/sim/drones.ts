/**
 * drones.ts - the enemy drones: perception, the four behaviours, steering,
 * attacks, their projectiles, and collision with the world.
 *
 * Perception. A drone sees the player when the eye is within `detect` (the
 * fog limit) AND the straight line from the drone to the eye meets no solid.
 * Seeing, it is alerted and remembers where the eye was. Out of sight it
 * flies to that last known place, and after `loseAfterS` without sight it
 * gives up and patrols around its spawn point. A drone is told where the
 * player is when it spawns (the wave sends it): it starts alerted, heading
 * for the player's place at that moment.
 *
 * Behaviours (DroneDef.behaviour):
 * - dive (scout): hangs `hoverAbove` over the target at about commitRange,
 *   then, seeing the player within commitRange with its attack ready,
 *   commits: it locks the player's chest as it was at that moment and flies
 *   straight at it at speed x speedFactor (a dive can be dodged). A contact
 *   ends the dive; so does reaching the locked point, maxS, or a wall. It
 *   pulls up and away for pullUpS, then lines up again.
 * - dive tracking (dive.track, degrees a second, default 0): while diving and
 *   seeing the player, the level bearing of the dive's heading turns toward
 *   the player's chest by at most track a second; its descent and the
 *   locked point's height and distance stay as committed (sim trackDive).
 *   So moving across a dive no longer dodges it, a late sidestep faster
 *   than the drone can turn still does, and running straight at it meets
 *   it no sooner than a locked dive. 0 keeps the point locked where the
 *   chest was at the commit.
 * - standoff (sniper): holds preferRange (a band of 4 either side), strafing
 *   side to side; seeing the player within shot.range it winds up for
 *   windupS (the telegraph) and fires a slow projectile at the player's
 *   chest. Projectiles fly straight and stop at any solid.
 * - Leading (attack.lead, 0..1, default 0; attack.leadMaxS, default 1.5):
 *   a shot fired while the drone sees the player aims at the chest plus the
 *   player's level velocity (vertical left out: a jump is not predicted)
 *   times lead times t, where t is when a bolt from the drone would meet a
 *   target moving at full level velocity (the intercept, counting the
 *   muzzle offset), held to leadMaxS (leadMaxS when there is none). Lead 1
 *   hits a player running in a straight line at constant speed; lead 0 aims
 *   where the player is. A sidestep or a change of direction after the
 *   shot still dodges it.
 * - tank (heavy): slow, approaches to preferRange (default 20), barely
 *   strafes, and fires bursts of `burst` shots `burstGapS` apart.
 * - swarm (swarmer): seeks the player, keeping `separation` from other
 *   swarmers and pulled toward the middle of its group (`neighbour`); a
 *   contact hit, then it backs off briefly.
 *
 * Steering. Each behaviour asks for a velocity; obstacle avoidance probes
 * ahead with a segment cast and steers off the face it finds; the altitude
 * band keeps it between altitude.min and altitude.max over the ground below
 * (not while diving). The velocity turns toward what is asked by at most
 * `accel` a second and its heading by at most `turnRate` radians a second.
 *
 * Collision. Every move is cut into sub-steps of at most half the radius and
 * a sub-step is taken only if the drone's sphere touches no solid where it
 * ends (pushed clear of what it touches if that frees it, by at most half
 * the radius), so a drone can never pass through a face: to cross one it
 * would have to jump twice its radius. It never leaves the region. Drones
 * pass through each other (only swarmers keep apart, by steering).
 *
 * Contact and shot hits are reported to the run (DroneContext.playerHits),
 * which decides about damage (invulnerability). Mutates in place.
 */

import type { DroneDef, DroneShotDef, Vec3 } from '../types'
import type { RunEvent } from './events'
import type { Bounds } from './player'
import { next, range, type Rng } from './rng'
import { groundBelow, segmentCast, segmentClear, sphereHits, spherePush, type Solids } from './solids'

export const DIVE_DEFAULTS = { commitRange: 14, speedFactor: 1.5, maxS: 1.6, pullUpS: 0.9, hoverAbove: 5, track: 0 }
export const SWARM_DEFAULTS = { separation: 2, neighbour: 10, cohesion: 0.6 }
/** A tank's range when its def gives none. */
export const TANK_RANGE = 20
/** Half the width of the band a standoff or tank drone holds around its range. */
export const RANGE_BAND = 4
/** How far a patrolling drone wanders from its spawn point, and how fast (share of speed). */
export const PATROL_RADIUS = 12
export const PATROL_SPEED = 0.5
/** A swarmer backs off this long after a contact. */
export const SWARM_BACKOFF_S = 0.6

export type DroneMode = 'patrol' | 'hunt' | 'dive' | 'pullup'

/** One drone. Plain data. */
export interface Drone {
  id: number
  /** Index into spec.enemies. */
  def: number
  enemy: string
  pos: Vec3
  vel: Vec3
  hp: number
  /** Its sphere, from its def. */
  radius: number
  mode: DroneMode
  modeT: number
  alerted: boolean
  sees: boolean
  lastKnown: Vec3
  sinceSeen: number
  /** Seconds until it may attack again. */
  cooldown: number
  /** Seconds of windup left, or -1 when not winding up. */
  windup: number
  burstLeft: number
  burstGap: number
  /** The dive's locked point. */
  aim: Vec3
  strafe: 1 | -1
  strafeT: number
  home: Vec3
  patrolTo: Vec3
}

/** A drone's projectile in flight. */
export interface DroneShot {
  id: number
  drone: number
  enemy: string
  pos: Vec3
  vel: Vec3
  radius: number
  travelled: number
  range: number
  damage: number
}

/** The player, as drones see and hit it. */
export interface PlayerTarget {
  feet: Vec3
  eye: Vec3
  height: number
  radius: number
  /** The body's velocity (only its level part is read, for leading). Absent: standing still. */
  vel?: Vec3
}

/** A hit on the player for the run to judge. */
export interface PlayerHit {
  drone: number
  enemy: string
  damage: number
}

/** What a step of the drones needs. */
export interface DroneContext {
  defs: readonly DroneDef[]
  solids: Solids
  bounds: Bounds
  player: PlayerTarget
  rng: Rng
  dt: number
  events: RunEvent[]
  playerHits: PlayerHit[]
  shots: DroneShot[]
  ids: { next: number }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
function norm(a: Vec3, k = 1): Vec3 {
  const l = len(a)
  return l > 1e-9 ? [(a[0] / l) * k, (a[1] / l) * k, (a[2] / l) * k] : [0, 0, 0]
}

/** The player's chest: where shots and dives aim. */
export function chestOf(p: PlayerTarget): Vec3 {
  return [p.feet[0], p.feet[1] + p.height * 0.5, p.feet[2]]
}

/** A new drone of def `defIndex` at `at`, told the player is at `told`. */
export function makeDrone(id: number, defs: readonly DroneDef[], defIndex: number, at: Vec3, told: Vec3, rng: Rng): Drone {
  const def = defs[defIndex]
  return {
    id, def: defIndex, enemy: def.id, pos: [at[0], at[1], at[2]], vel: [0, 0, 0], hp: def.hp, radius: def.radius,
    mode: 'hunt', modeT: 0, alerted: true, sees: false, lastKnown: [told[0], told[1], told[2]], sinceSeen: 0,
    cooldown: 0, windup: -1, burstLeft: 0, burstGap: 0, aim: [at[0], at[1], at[2]],
    strafe: next(rng) < 0.5 ? 1 : -1, strafeT: range(rng, 2, 4), home: [at[0], at[1], at[2]], patrolTo: [at[0], at[1], at[2]],
  }
}

/** The shortest distance between segments p1-q1 and p2-q2 (Ericson 5.1.9), and the parameter on the first. */
export function segSegDist(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): { d: number; s: number } {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2)
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2]
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2]
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2]
  let s = 0, t = 0
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0 }
  else if (a <= 1e-12) { s = 0; t = clamp01(f / e) }
  else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2]
    if (e <= 1e-12) { t = 0; s = clamp01(-c / a) }
    else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]
      const den = a * e - b * b
      s = den > 1e-12 ? clamp01((b * f - c * e) / den) : 0
      t = (b * s + f) / e
      if (t < 0) { t = 0; s = clamp01(-c / a) } else if (t > 1) { t = 1; s = clamp01((b - c) / a) }
    }
  }
  const c1: Vec3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s]
  const c2: Vec3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t]
  return { d: dist(c1, c2), s }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** The player's body axis: the segment the body capsule is drawn round. */
function axisOf(p: PlayerTarget): [Vec3, Vec3] {
  return [[p.feet[0], p.feet[1] + p.radius, p.feet[2]], [p.feet[0], p.feet[1] + p.height - p.radius, p.feet[2]]]
}

/** Whether a sphere at `c` of radius `r` touches the player's body capsule. */
export function touchesPlayer(c: Vec3, r: number, p: PlayerTarget): boolean {
  const [a, b] = axisOf(p)
  return segSegDist(c, c, a, b).d <= r + p.radius
}

function inBounds(b: Bounds, c: Vec3, r: number): boolean {
  return c[0] - r >= b.lo[0] && c[0] + r <= b.hi[0] && c[1] - r >= b.lo[1] && c[1] + r <= b.hi[1] && c[2] - r >= b.lo[2] && c[2] + r <= b.hi[2]
}

const pushV: Vec3 = [0, 0, 0]

/**
 * Moves a sphere by `vel * dt`, never into a solid or out of the bounds:
 * sub-steps of at most half the radius, each taken only where the sphere is
 * clear, pushed clear by at most half the radius if that frees it. The
 * velocity loses what pushes into a face. Returns whether it was blocked.
 */
export function moveSphere(s: Solids, bounds: Bounds, pos: Vec3, vel: Vec3, r: number, dt: number): boolean {
  const dx = vel[0] * dt, dy = vel[1] * dt, dz = vel[2] * dt
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / Math.max(0.05, r * 0.5)))
  let blocked = false
  for (let i = 0; i < n; i++) {
    const c: Vec3 = [pos[0] + vel[0] * dt / n, pos[1] + vel[1] * dt / n, pos[2] + vel[2] * dt / n]
    if (inBounds(bounds, c, r) && !sphereHits(s, c, r)) { pos[0] = c[0]; pos[1] = c[1]; pos[2] = c[2]; continue }
    blocked = true
    pushV[0] = 0; pushV[1] = 0; pushV[2] = 0
    spherePush(s, c, r * 1.001, pushV)
    // A second round for a corner's other wall.
    const c1: Vec3 = [c[0] + pushV[0], c[1] + pushV[1], c[2] + pushV[2]]
    spherePush(s, c1, r * 1.001, pushV)
    // The region walls push too.
    for (let a = 0; a < 3; a++) {
      if (c[a] - r < bounds.lo[a]) pushV[a] += bounds.lo[a] - (c[a] - r)
      if (c[a] + r > bounds.hi[a]) pushV[a] -= c[a] + r - bounds.hi[a]
    }
    const pl = len(pushV)
    if (pl > 1e-12) {
      const k = Math.min(1, (r * 0.5) / pl)
      const c2: Vec3 = [c[0] + pushV[0] * k, c[1] + pushV[1] * k, c[2] + pushV[2] * k]
      const nrm: Vec3 = [pushV[0] / pl, pushV[1] / pl, pushV[2] / pl]
      const into = vel[0] * nrm[0] + vel[1] * nrm[1] + vel[2] * nrm[2]
      if (into < 0) { vel[0] -= nrm[0] * into; vel[1] -= nrm[1] * into; vel[2] -= nrm[2] * into }
      if (inBounds(bounds, c2, r) && !sphereHits(s, c2, r)) { pos[0] = c2[0]; pos[1] = c2[1]; pos[2] = c2[2]; continue }
    }
    vel[0] = 0; vel[1] = 0; vel[2] = 0
    break
  }
  return blocked
}

/** Turns unit vector `from` toward unit `to` by at most `max` radians. */
function turnToward(from: Vec3, to: Vec3, max: number): Vec3 {
  const c = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]))
  const ang = Math.acos(c)
  if (ang <= max || ang < 1e-9) return to
  // The part of `to` across `from`, as the second axis of the turn's plane.
  let px = to[0] - from[0] * c, py = to[1] - from[1] * c, pz = to[2] - from[2] * c
  const pl = Math.hypot(px, py, pz)
  if (pl < 1e-9) {
    // Straight behind: turn about whichever axis is across it.
    const ref: Vec3 = Math.abs(from[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    px = from[1] * ref[2] - from[2] * ref[1]; py = from[2] * ref[0] - from[0] * ref[2]; pz = from[0] * ref[1] - from[1] * ref[0]
    const l = Math.hypot(px, py, pz); px /= l; py /= l; pz /= l
  } else { px /= pl; py /= pl; pz /= pl }
  const cm = Math.cos(max), sm = Math.sin(max)
  return [from[0] * cm + px * sm, from[1] * cm + py * sm, from[2] * cm + pz * sm]
}

/** Steers `d.vel` toward `want` (its speed capped at `max`) by at most accel*dt, the heading by at most turnRate*dt. */
export function steer(vel: Vec3, want: Vec3, max: number, accel: number, turnRate: number, dt: number): void {
  const w = len(want) > max ? norm(want, max) : want
  const dv = sub(w, vel)
  const dl = len(dv), lim = accel * dt
  const k = dl > lim ? lim / dl : 1
  let nv: Vec3 = [vel[0] + dv[0] * k, vel[1] + dv[1] * k, vel[2] + dv[2] * k]
  const oldSpeed = len(vel), newSpeed = len(nv)
  if (oldSpeed > 0.5 && newSpeed > 1e-9 && turnRate > 0) nv = norm(turnToward(norm(vel), norm(nv), turnRate * dt), newSpeed)
  const sp = len(nv)
  if (sp > max) nv = norm(nv, max)
  vel[0] = nv[0]; vel[1] = nv[1]; vel[2] = nv[2]
}

/**
 * A tracking dive's step: the level part of the heading (toward the locked
 * point) turned toward the chest's bearing by at most `maxTurn` radians;
 * the heading's climb or descent and the locked point's distance stay as
 * they were. So a player moving across the dive is followed, but one
 * running straight at it is met no sooner than by a locked dive.
 */
export function trackDive(d: Drone, chest: Vec3, maxTurn: number): void {
  const to = sub(d.aim, d.pos)
  const far = len(to)
  const lx = to[0], lz = to[2], level = Math.hypot(lx, lz)
  const cx = chest[0] - d.pos[0], cz = chest[2] - d.pos[2], cl = Math.hypot(cx, cz)
  if (far < 1e-9 || level < 1e-9 || cl < 1e-9) return
  // The signed level angle from the heading's bearing to the chest's, held to maxTurn.
  const ux = lx / level, uz = lz / level, vx = cx / cl, vz = cz / cl
  const ang = Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz)
  const turn = Math.max(-maxTurn, Math.min(maxTurn, ang))
  const c = Math.cos(turn), sn = Math.sin(turn)
  const nx = (ux * c - uz * sn) * level, nz = (ux * sn + uz * c) * level
  d.aim = [d.pos[0] + nx, d.aim[1], d.pos[2] + nz]
}

/** Whether a drone sees the eye: within its detect range and with a clear line. */
export function canSee(s: Solids, def: DroneDef, from: Vec3, eye: Vec3): boolean {
  return dist(from, eye) <= def.detect && segmentClear(s, from, eye)
}

function pickPatrol(d: Drone, ctx: DroneContext): void {
  const a = range(ctx.rng, 0, Math.PI * 2), r = range(ctx.rng, PATROL_RADIUS * 0.3, PATROL_RADIUS), h = range(ctx.rng, -2, 2)
  d.patrolTo = [d.home[0] + Math.cos(a) * r, d.home[1] + h, d.home[2] + Math.sin(a) * r]
}

/** A shot's prediction time when the drone's def gives none, seconds. */
export const DEFAULT_LEAD_MAX_S = 1.5

/**
 * When a bolt fired from `from` at `speed` (leaving `off` out along its way)
 * meets a target at `at` moving at constant `vel`: the smallest t > 0 with
 * |at + vel t - from| = off + speed t, or null for none.
 */
export function interceptTime(from: Vec3, at: Vec3, vel: Vec3, speed: number, off: number): number | null {
  const rx = at[0] - from[0], ry = at[1] - from[1], rz = at[2] - from[2]
  const a = vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2] - speed * speed
  const b = 2 * (rx * vel[0] + ry * vel[1] + rz * vel[2] - off * speed)
  const c = rx * rx + ry * ry + rz * rz - off * off
  if (Math.abs(a) < 1e-9) return Math.abs(b) < 1e-12 ? null : -c / b > 0 ? -c / b : null
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const q = Math.sqrt(disc)
  const t1 = (-b - q) / (2 * a), t2 = (-b + q) / (2 * a)
  const lo = Math.min(t1, t2), hi = Math.max(t1, t2)
  return lo > 0 ? lo : hi > 0 ? hi : null
}

/** Where a drone aims a shot: `at`, led by the player's level velocity (see the file header) when it sees them and its def leads. */
export function leadPoint(d: Drone, def: DroneDef, shot: DroneShotDef, at: Vec3, player: PlayerTarget): Vec3 {
  const lead = Math.max(0, Math.min(1, def.attack.lead ?? 0))
  const v = player.vel
  if (!(lead > 0) || !d.sees || !v) return at
  const lv: Vec3 = [v[0], 0, v[2]]
  if (lv[0] === 0 && lv[2] === 0) return at
  const maxS = def.attack.leadMaxS ?? DEFAULT_LEAD_MAX_S
  const t = Math.min(maxS, interceptTime(d.pos, at, lv, shot.speed, def.radius + shot.radius + 0.05) ?? maxS)
  return [at[0] + lv[0] * t * lead, at[1], at[2] + lv[2] * t * lead]
}

/** Fires one drone shot at `at` (led, when its def leads). */
function fireShot(d: Drone, def: DroneDef, shot: DroneShotDef, at: Vec3, ctx: DroneContext): void {
  const dir = norm(sub(leadPoint(d, def, shot, at, ctx.player), d.pos))
  if (len(dir) === 0) return
  const off = def.radius + shot.radius + 0.05
  const id = ctx.ids.next++
  const origin: Vec3 = [d.pos[0] + dir[0] * off, d.pos[1] + dir[1] * off, d.pos[2] + dir[2] * off]
  const vel: Vec3 = [dir[0] * shot.speed, dir[1] * shot.speed, dir[2] * shot.speed]
  ctx.shots.push({ id, drone: d.id, enemy: d.enemy, pos: origin, vel, radius: shot.radius, travelled: 0, range: shot.range, damage: def.attack.damage })
  ctx.events.push({ type: 'drone-shot', drone: d.id, shot: id, origin: [origin[0], origin[1], origin[2]], vel: [vel[0], vel[1], vel[2]], radius: shot.radius })
}

/** One step of every drone, in order. Hits on the player go to ctx.playerHits. */
export function stepDrones(drones: Drone[], ctx: DroneContext): void {
  const { dt, player } = ctx
  const chest = chestOf(player)
  for (const d of drones) {
    if (d.hp <= 0) continue
    const def = ctx.defs[d.def]
    d.modeT += dt
    d.cooldown = Math.max(0, d.cooldown - dt)

    // Perception.
    d.sees = canSee(ctx.solids, def, d.pos, player.eye)
    if (d.sees) {
      if (!d.alerted) { d.alerted = true; d.mode = 'hunt'; d.modeT = 0; ctx.events.push({ type: 'drone-alert', drone: d.id, seen: true }) }
      d.lastKnown = [player.eye[0], player.eye[1], player.eye[2]]
      d.sinceSeen = 0
    } else {
      d.sinceSeen += dt
      if (d.alerted && d.sinceSeen > def.loseAfterS) {
        d.alerted = false; d.mode = 'patrol'; d.modeT = 0; d.windup = -1; d.burstLeft = 0
        pickPatrol(d, ctx)
        ctx.events.push({ type: 'drone-alert', drone: d.id, seen: false })
      }
    }
    const target: Vec3 = d.sees ? chest : d.lastKnown
    let max = def.speed, accel = def.accel
    let want: Vec3 = [0, 0, 0]

    if (!d.alerted) {
      if (dist(d.pos, d.patrolTo) < 1.5) pickPatrol(d, ctx)
      want = norm(sub(d.patrolTo, d.pos), def.speed * PATROL_SPEED)
    } else if (def.behaviour === 'dive') {
      const t = { ...DIVE_DEFAULTS, ...def.dive }
      if (d.mode === 'dive') {
        max = def.speed * t.speedFactor
        accel = def.accel * 2
        if (t.track > 0 && d.sees) trackDive(d, chest, (t.track * Math.PI) / 180 * dt)
        want = norm(sub(d.aim, d.pos), max)
        if (dist(d.pos, d.aim) < def.radius + 0.3 || d.modeT > t.maxS) { d.mode = 'pullup'; d.modeT = 0; d.cooldown = Math.max(d.cooldown, def.attack.cooldownS) }
      } else if (d.mode === 'pullup') {
        const away = sub(d.pos, target); away[1] = 0
        const a = norm(away)
        want = norm([a[0], 1.2, a[2]], def.speed)
        if (d.modeT > t.pullUpS) { d.mode = 'hunt'; d.modeT = 0 }
      } else {
        d.mode = 'hunt'
        const flat = sub(d.pos, target); flat[1] = 0
        const f = len(flat) > 1e-6 ? norm(flat) : [0, 0, 1] as Vec3
        const hover: Vec3 = [target[0] + f[0] * t.commitRange * 0.7, target[1] + t.hoverAbove, target[2] + f[2] * t.commitRange * 0.7]
        const toHover = sub(hover, d.pos)
        const dh = len(toHover)
        want = norm(toHover, Math.min(def.speed, dh * 2))
        if (d.sees && d.cooldown <= 0 && dist(d.pos, chest) <= t.commitRange) {
          d.mode = 'dive'; d.modeT = 0
          d.aim = [chest[0], chest[1], chest[2]]
          ctx.events.push({ type: 'drone-dive', drone: d.id, target: [chest[0], chest[1], chest[2]] })
        }
      }
    } else if (def.behaviour === 'standoff' || def.behaviour === 'tank') {
      const prefer = def.preferRange ?? (def.behaviour === 'tank' ? TANK_RANGE : 30)
      const to = sub(target, d.pos)
      const flat: Vec3 = [to[0], 0, to[2]]
      const fd = len(flat)
      const e = fd - prefer
      const radial = Math.max(-1, Math.min(1, e / RANGE_BAND))
      const dir = fd > 1e-6 ? norm(flat) : ([0, 0, -1] as Vec3)
      const side: Vec3 = [-dir[2], 0, dir[0]]
      d.strafeT -= dt
      if (d.strafeT <= 0) { d.strafe = d.strafe === 1 ? -1 : 1; d.strafeT = range(ctx.rng, 2, 4) }
      const strafe = def.behaviour === 'tank' ? 0.2 : 0.6
      // Out of sight, it closes on the last known place rather than holding range from it.
      const r = d.sees ? radial : 1
      want = [dir[0] * r * def.speed + side[0] * d.strafe * strafe * def.speed, 0, dir[2] * r * def.speed + side[2] * d.strafe * strafe * def.speed]
      if (!d.sees && fd < 2) want = [0, 0, 0]
    } else {
      // swarm
      const t = { ...SWARM_DEFAULTS, ...def.swarm }
      if (d.mode === 'pullup') {
        want = norm(sub(d.pos, target), def.speed)
        want[1] = Math.abs(want[1]) + def.speed * 0.3
        if (d.modeT > SWARM_BACKOFF_S) { d.mode = 'hunt'; d.modeT = 0 }
      } else {
        want = norm(sub(target, d.pos), def.speed)
      }
      let sx = 0, sy = 0, sz = 0, cx = 0, cy = 0, cz = 0, n = 0
      for (const o of drones) {
        if (o === d || o.hp <= 0 || ctx.defs[o.def].behaviour !== 'swarm') continue
        const dd = dist(d.pos, o.pos)
        if (dd > t.neighbour) continue
        cx += o.pos[0]; cy += o.pos[1]; cz += o.pos[2]; n++
        if (dd < t.separation) {
          const away = dd > 1e-6 ? norm(sub(d.pos, o.pos), (t.separation - dd) / t.separation) : ([1, 0, 0] as Vec3)
          sx += away[0]; sy += away[1]; sz += away[2]
        }
      }
      want = [want[0] + sx * def.speed * 1.5, want[1] + sy * def.speed * 1.5, want[2] + sz * def.speed * 1.5]
      if (n > 0) {
        const pull = norm([cx / n - d.pos[0], cy / n - d.pos[1], cz / n - d.pos[2]], def.speed * t.cohesion)
        want = [want[0] + pull[0], want[1] + pull[1], want[2] + pull[2]]
      }
    }

    // The altitude band over the ground below (not while diving at the player).
    if (d.mode !== 'dive') {
      const g = groundBelow(ctx.solids, d.pos[0], d.pos[1], d.pos[2], 256) ?? ctx.bounds.lo[1]
      const lo = g + def.altitude.min, hi = g + def.altitude.max
      if (d.pos[1] < lo) want[1] = Math.max(want[1], Math.min(def.speed, (lo - d.pos[1]) * 2 + 1))
      else if (d.pos[1] > hi) want[1] = Math.min(want[1], -Math.min(def.speed, (d.pos[1] - hi) * 2 + 1))
      else if (def.behaviour === 'standoff' || def.behaviour === 'tank') want[1] = ((lo + hi) / 2 - d.pos[1]) * 0.5
    }

    // Obstacle avoidance: a probe ahead along what it wants.
    const wl = len(want)
    if (wl > 1e-6) {
      const look = def.radius + Math.max(1.5, len(d.vel) * 0.6)
      const ahead = norm(want, look)
      const hit = segmentCast(ctx.solids, d.pos, [d.pos[0] + ahead[0], d.pos[1] + ahead[1], d.pos[2] + ahead[2]])
      if (hit && d.mode !== 'dive') {
        const k = (1 - hit.t) * max * 1.5
        want = [want[0] + hit.normal[0] * k, want[1] + hit.normal[1] * k + max * 0.3 * (1 - hit.t), want[2] + hit.normal[2] * k]
      }
    }

    steer(d.vel, want, max, accel, def.turnRate * (d.mode === 'dive' ? 2 : 1), dt)
    const blocked = moveSphere(ctx.solids, ctx.bounds, d.pos, d.vel, def.radius, dt)
    if (blocked && d.mode === 'dive') { d.mode = 'pullup'; d.modeT = 0; d.cooldown = Math.max(d.cooldown, def.attack.cooldownS) }

    // Attacks.
    if (def.attack.kind === 'contact') {
      if (d.cooldown <= 0 && touchesPlayer(d.pos, def.radius, player)) {
        ctx.playerHits.push({ drone: d.id, enemy: d.enemy, damage: def.attack.damage })
        d.cooldown = def.attack.cooldownS
        d.mode = 'pullup'; d.modeT = 0
      }
    } else if (def.attack.shot) {
      const shot = def.attack.shot
      if (d.burstLeft > 0) {
        d.burstGap -= dt
        if (d.burstGap <= 1e-9) {
          fireShot(d, def, shot, target, ctx)
          d.burstLeft--
          d.burstGap += def.attack.burstGapS ?? 0.25
          if (d.burstLeft === 0) d.cooldown = def.attack.cooldownS
        }
      } else if (d.windup >= 0) {
        d.windup -= dt
        if (d.windup <= 1e-9) {
          d.windup = -1
          d.burstLeft = Math.max(1, Math.floor(def.attack.burst ?? 1))
          d.burstGap = 0
          fireShot(d, def, shot, target, ctx)
          d.burstLeft--
          d.burstGap = def.attack.burstGapS ?? 0.25
          if (d.burstLeft === 0) d.cooldown = def.attack.cooldownS
        }
      } else if (d.alerted && d.sees && d.cooldown <= 0 && dist(d.pos, chest) <= shot.range) {
        d.windup = shot.windupS
        ctx.events.push({ type: 'drone-windup', drone: d.id, windupS: shot.windupS })
      }
    }
  }
}

/** One step of the drones' projectiles: straight on, stopped by any solid, hitting the player's body. Mutates ctx.shots. */
export function stepDroneShots(ctx: DroneContext): void {
  const keep: DroneShot[] = []
  const [a, b] = axisOf(ctx.player)
  for (const s of ctx.shots) {
    const speed = len(s.vel)
    const l = Math.min(speed * ctx.dt, s.range - s.travelled)
    const dir = norm(s.vel)
    const end: Vec3 = [s.pos[0] + dir[0] * l, s.pos[1] + dir[1] * l, s.pos[2] + dir[2] * l]
    const wall = segmentCast(ctx.solids, s.pos, end)
    const stopEnd: Vec3 = wall ? wall.point : end
    const near = segSegDist(s.pos, stopEnd, a, b)
    if (near.d <= s.radius + ctx.player.radius) {
      ctx.playerHits.push({ drone: s.drone, enemy: s.enemy, damage: s.damage })
      const at: Vec3 = [s.pos[0] + (stopEnd[0] - s.pos[0]) * near.s, s.pos[1] + (stopEnd[1] - s.pos[1]) * near.s, s.pos[2] + (stopEnd[2] - s.pos[2]) * near.s]
      ctx.events.push({ type: 'drone-shot-ended', shot: s.id, at, reason: 'player' })
      continue
    }
    if (wall) { ctx.events.push({ type: 'drone-shot-ended', shot: s.id, at: wall.point, reason: 'solid' }); continue }
    s.travelled += l
    s.pos = end
    if (s.travelled >= s.range - 1e-9) { ctx.events.push({ type: 'drone-shot-ended', shot: s.id, at: end, reason: 'range' }); continue }
    keep.push(s)
  }
  ctx.shots.length = 0
  ctx.shots.push(...keep)
}
