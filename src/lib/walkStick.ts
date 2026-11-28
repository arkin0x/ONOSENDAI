/**
 * walkStick.ts: the WALK and TERRAIN stick's math, for a phone (owner,
 * 2026-11-28: "joystick should be SOTA. Where you start touching is where
 * the amount comes from - starting a touch at the left side doesn't start
 * turning left immediately. we went over this with the drone game
 * joystick ... joystick is only on the left for planar movement; vertical
 * movement belongs to the buttons on the right").
 *
 * The drawing and the touches are hud/WalkStick.tsx; what the stick drives
 * is store/walkHold.ts (stickHold). Everything here is plain numbers, so it
 * is tested without a screen.
 *
 * | Part | Rule | Where it comes from |
 * |---|---|---|
 * | origin | where the thumb lands is the stick's centre: a touch anywhere in the zone starts at no movement | DRONE RUN's floating sticks (owner, 2026-11-16); Unity's ExactPositionWithDynamicOrigin; nipplejs `dynamic` |
 * | dead zone | STICK_DEAD (12%) of the reach, radial, so no direction is favoured; once out, the stick stays pushed until it is back inside STICK_RELEASE (8%), so a thumb on the edge never flickers in and out | DRONE RUN's STICK_DEAD; Josh Sutphin, "Doing Thumbstick Dead Zones Right" (scaled radial) |
 * | magnitude | rescaled from 0 at the dead zone's edge to 1 at the ring, linear, so movement never kicks in with a jump | the same (scaled radial); DRONE RUN's MOVE stick, linear |
 * | the ring | the knob is drawn inside it; past it the push stays 1 | every stick library |
 * | follow | a thumb past the ring drags the centre behind it, so reversing is instant | nipplejs `follow`, Joystick Pack "Dynamic", Godot FOLLOWING |
 * | 8 ways | the step WALK takes whole gibsons: the nearest of 8 directions, held a little past its edge (STICK_SECTOR_HOLD) so it never flickers between two | the keys' own diagonals (lib/walkKeys.ts) |
 * | pace | in the step WALK a light push steps slowly, a full push at the keys' pace (WALK_HOLD_MS) | |
 *
 * Forward is up the screen, right is right; store/walkHold.ts turns that
 * into the way you face (lib/walkSlide.ts for the steps, store/walkFluid.ts
 * walkFacing for fluid WALK). Nothing here is ever vertical.
 */

/** The dead zone, as a share of the reach: a resting thumb moves nothing. The DRONE RUN's MOVE stick's. */
export const STICK_DEAD = 0.12

/**
 * Once pushed past STICK_DEAD the stick stays pushed until it comes back
 * inside this share of the reach (hysteresis): a thumb resting on the dead
 * zone's edge wobbles a pixel or two either way, and without it every wobble
 * out was a new push, a new step (review of #974).
 */
export const STICK_RELEASE = 0.08

/** How far past a direction's edge (radians, about 7 degrees) the stick keeps it before taking the next one: no flicker on a boundary. */
export const STICK_SECTOR_HOLD = (7 * Math.PI) / 180

/** The slowest step pace, as a share of the keys' pace, for a push just past the dead zone: about three steps a second. */
export const STICK_SLOW_SHARE = 0.35

/** A stick reading: forward (up the screen) and right, each -1..1, inside the unit circle, and the push 0..1. */
export interface StickVec { fwd: number; strafe: number; mag: number }

/** A point on screen, CSS px. */
export interface StickPt { x: number; y: number }

/**
 * The stick's output for a thumb at (dx, dy) pixels from its centre, reach
 * `radius` (screen y grows down). Inside the dead zone nothing; past it the
 * push rises from 0 at the dead zone's edge to 1 at the ring, and stays 1
 * beyond it, the direction kept.
 */
export function stickVector(dx: number, dy: number, radius: number, dead = STICK_DEAD): StickVec {
  const r = Math.hypot(dx, dy)
  if (!(radius > 0) || !(r > dead * radius)) return { fwd: 0, strafe: 0, mag: 0 }
  const mag = Math.min(1, (r / radius - dead) / (1 - dead))
  return { fwd: (-dy / r) * mag, strafe: (dx / r) * mag, mag }
}

/**
 * The centre after the thumb moved to `at`: where it was while the thumb is
 * inside the ring, or dragged along behind the thumb, `radius` short of it,
 * once the thumb goes past (semi-dynamic). Pulling back the other way then
 * reverses at once instead of first crossing a ring left far behind.
 */
export function followCentre(origin: StickPt, at: StickPt, radius: number): StickPt {
  const dx = at.x - origin.x
  const dy = at.y - origin.y
  const r = Math.hypot(dx, dy)
  if (!(radius > 0) || r <= radius) return origin
  const k = (r - radius) / r
  return { x: origin.x + dx * k, y: origin.y + dy * k }
}

/** The knob's place from the centre for a thumb at (dx, dy): kept inside the ring. */
export function knobAt(dx: number, dy: number, radius: number): { dx: number; dy: number } {
  const r = Math.hypot(dx, dy)
  const k = r > radius && r > 0 ? radius / r : 1
  return { dx: dx * k, dy: dy * k }
}

/** One of 8 directions, as the keys make them: forward +1 or back -1, right +1 or left -1. */
export interface Dir8 { fwd: -1 | 0 | 1; strafe: -1 | 0 | 1 }

/** The 8 directions by sector, counter-clockwise from right (sector 0 is right, 2 forward, 4 left, 6 back). */
const SECTORS: readonly Dir8[] = [
  { fwd: 0, strafe: 1 }, { fwd: 1, strafe: 1 }, { fwd: 1, strafe: 0 }, { fwd: 1, strafe: -1 },
  { fwd: 0, strafe: -1 }, { fwd: -1, strafe: -1 }, { fwd: -1, strafe: 0 }, { fwd: -1, strafe: 1 },
]

/** The sector (0..7) a reading points into, or null inside the dead zone. */
function sectorOf(v: StickVec): number | null {
  if (v.mag <= 0) return null
  const a = Math.atan2(v.fwd, v.strafe)
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8
}

/** How far (radians, 0..PI) the reading's angle is from sector `s`'s middle. */
function offSector(v: StickVec, s: number): number {
  const d = Math.atan2(v.fwd, v.strafe) - s * (Math.PI / 4)
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))
}

/**
 * The nearest of 8 directions for a reading, keeping `prev`'s sector until
 * the stick is STICK_SECTOR_HOLD past its edge. Null inside the dead zone.
 * Returns the sector too, to hand back as `prev` next time.
 */
export function quantize8(v: StickVec, prev: number | null = null): { dir: Dir8; sector: number } | null {
  const s = sectorOf(v)
  if (s === null) return null
  const keep = prev !== null && offSector(v, prev) <= Math.PI / 8 + STICK_SECTOR_HOLD
  const sector = keep ? prev : s
  return { dir: SECTORS[sector], sector }
}

/**
 * The step WALK's beat for a push `mag` (0..1), in ms: `fastest` (the keys'
 * WALK_HOLD_MS) at a full push, slower for a lighter one, never slower than
 * `fastest` / STICK_SLOW_SHARE.
 */
export function stickPeriod(mag: number, fastest: number): number {
  const m = Math.max(0, Math.min(1, mag))
  return fastest / (STICK_SLOW_SHARE + (1 - STICK_SLOW_SHARE) * m)
}

/** What a finger on the stick is now: the centre, the finger, the knob from the centre, the reading and the 8-way direction. */
export interface StickState {
  id: number
  origin: StickPt
  at: StickPt
  knob: { dx: number; dy: number }
  vec: StickVec
  /** The step WALK's direction and its sector (kept with STICK_SECTOR_HOLD); null inside the dead zone. */
  dir: Dir8 | null
  sector: number | null
  /** Pushed: out past STICK_DEAD, and not yet back inside STICK_RELEASE. */
  pushed: boolean
}

/**
 * One finger's stick: down, move and up by pointer id. A second finger
 * while one holds it is not taken (it returns false), so it is free for
 * whatever else it lands on. `radius` is the reach in CSS px.
 */
export class StickTracker {
  private s: StickState | null = null
  constructor(private radius: () => number) {}

  /** A finger lands at (x, y): true when it took the stick (the stick was free). */
  down(id: number, x: number, y: number): boolean {
    if (this.s) return false
    const p = { x, y }
    this.s = { id, origin: p, at: p, knob: { dx: 0, dy: 0 }, vec: { fwd: 0, strafe: 0, mag: 0 }, dir: null, sector: null, pushed: false }
    return true
  }

  /** The finger `id` moved to (x, y): the new state, or null when it is not the stick's finger. */
  move(id: number, x: number, y: number): StickState | null {
    const s = this.s
    if (!s || s.id !== id) return null
    const radius = this.radius()
    s.at = { x, y }
    s.origin = followCentre(s.origin, s.at, radius)
    const dx = x - s.origin.x
    const dy = y - s.origin.y
    s.vec = stickVector(dx, dy, radius)
    s.knob = knobAt(dx, dy, radius)
    const r = Math.hypot(dx, dy)
    // Out past STICK_DEAD to push; back inside STICK_RELEASE to let go. Between the two a push already on stays on,
    // its direction from the thumb's (its speed 0 there, so fluid WALK coasts and the step WALK keeps its slowest pace).
    s.pushed = radius > 0 && (s.pushed ? r >= STICK_RELEASE * radius : r > STICK_DEAD * radius)
    const q = s.pushed && r > 0 ? quantize8({ fwd: -dy / r, strafe: dx / r, mag: 1 }, s.sector) : null
    s.dir = q?.dir ?? null
    s.sector = q?.sector ?? null
    return s
  }

  /** The finger `id` lifted (or was cancelled): true when it was the stick's. */
  up(id: number): boolean {
    if (!this.s || this.s.id !== id) return false
    this.s = null
    return true
  }

  /** Let go whatever finger holds it. */
  clear(): void { this.s = null }

  /** The finger on the stick now, or null. */
  get state(): Readonly<StickState> | null { return this.s }
}
