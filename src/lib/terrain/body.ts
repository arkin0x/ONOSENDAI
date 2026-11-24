/**
 * body.ts - the builder's body in TERRAIN mode: a first-person walker on the
 * block grid, moved locally, never on the chain (decision D7: building does
 * not move your chain; reach still proves presence).
 *
 * Numbers, one block being one gibson (arkinox, 2026-11-24: the mode sets its
 * own speed and jump; design §5.1):
 * - walking speed WALK_SPEED, about 4.5 blocks a second, rising to RUN_SPEED
 *   once a direction has been held for RUN_AFTER_S;
 * - a jump of JUMP_HEIGHT, a little over one block, so a one-block step is a
 *   hop and a two-block wall is a wall;
 * - the eye EYE_HEIGHT over the feet, about 1.4 blocks, and the body
 *   BODY_HEIGHT tall, so a two-block doorway fits;
 * - gravity along the builder's down, which is the compass's (lib/walkDown.ts);
 *   here that is the scene's -Y, since the TERRAIN view is built with the
 *   compass's up as its Y.
 *
 * Works in the TERRAIN view's frame: Y up, a block at integer cell (i, j, k)
 * spanning [i - 0.5, i + 0.5] on each axis, the feet at the bottom middle of
 * the body. Collision is axis by axis against whatever `solid` says, which is
 * the block grid plus the box's edges, and `wall`, which asks the shards'
 * walls (WALK's own, store/walkWalls.ts) whenever the body would cross into a
 * new cell. Pure: no store, no clock.
 */

export const WALK_SPEED = 4.5
export const RUN_SPEED = 6
export const RUN_AFTER_S = 1.2
export const JUMP_HEIGHT = 1.25
export const GRAVITY = 30
export const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT)
export const EYE_HEIGHT = 1.4
export const BODY_HEIGHT = 1.75
export const HALF_WIDTH = 0.3
/** The fastest fall, blocks a second, so a long drop never tunnels through a floor between frames. */
export const MAX_FALL = 40
/** The longest frame stepped at once, seconds: a frame after a pause is cut to this. */
export const MAX_DT = 0.05

export interface Body {
  /** Feet, in the view's frame. */
  x: number
  y: number
  z: number
  /** Vertical speed, blocks a second, up positive. */
  vy: number
  onGround: boolean
  /** How long a direction has been held, seconds: past RUN_AFTER_S the walk is a run. */
  held: number
}

/** What the body asks of the world, in the view's integer cells. */
export interface BodyWorld {
  /** Whether the cell stops the body: a block, or the edge of where the body may go. */
  solid: (i: number, j: number, k: number) => boolean
  /** Whether gravity holds here: false in a chunk not yet surveyed, where the body floats. */
  gravity: (i: number, j: number, k: number) => boolean
  /** Whether a shard's face stops a step of one cell from (i, j, k) along axis 0, 1 or 2, in direction dir. Absent: no shards. */
  wall?: (i: number, j: number, k: number, axis: 0 | 1 | 2, dir: 1 | -1) => boolean
}

/** What the controls ask for this frame: a direction in the view's horizontal plane (forward and right, each -1..1), a look heading, and jump. */
export interface BodyInput {
  forward: number
  right: number
  /** Radians about Y; 0 looks along -Z. */
  yaw: number
  jump: boolean
  /** Up and down while floating (no gravity): -1, 0 or 1. */
  lift: number
}

export function newBody(x: number, y: number, z: number): Body {
  return { x, y, z, vy: 0, onGround: false, held: 0 }
}

const cell = (v: number): number => Math.round(v)
const EPS = 1e-4

/** Whether the body's box at (x, y, z) overlaps any solid cell. */
export function overlaps(w: BodyWorld, x: number, y: number, z: number): boolean {
  const i0 = cell(x - HALF_WIDTH + EPS), i1 = cell(x + HALF_WIDTH - EPS)
  const j0 = cell(y + EPS), j1 = cell(y + BODY_HEIGHT - EPS)
  const k0 = cell(z - HALF_WIDTH + EPS), k1 = cell(z + HALF_WIDTH - EPS)
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) if (w.solid(i, j, k)) return true
  return false
}

/** Whether moving the body's centre column from one cell to the next crosses a shard's face, feet or head. */
function wallCrossed(w: BodyWorld, b: Body, axis: 0 | 1 | 2, from: number, to: number): boolean {
  if (!w.wall || from === to) return false
  const dir: 1 | -1 = to > from ? 1 : -1
  const ci = cell(b.x), ck = cell(b.z)
  const rows = axis === 1 ? [cell(b.y + (dir > 0 ? BODY_HEIGHT - EPS : EPS))] : [cell(b.y + EPS), cell(b.y + BODY_HEIGHT - EPS)]
  for (const j of rows) {
    const p: [number, number, number] = axis === 0 ? [from, j, ck] : axis === 1 ? [ci, from, ck] : [ci, j, from]
    if (w.wall(p[0], p[1], p[2], axis, dir)) return true
  }
  return false
}

/** Move along one axis by `d`, stopping at the first solid cell or shard face. True when it was stopped. */
function moveAxis(w: BodyWorld, b: Body, axis: 0 | 1 | 2, d: number): boolean {
  if (d === 0) return false
  const key = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'
  // Small steps, so a fast move never passes through a block.
  const steps = Math.max(1, Math.ceil(Math.abs(d) / 0.4))
  const s = d / steps
  const lead = (v: number): number => (axis === 1 ? cell(v + (s > 0 ? BODY_HEIGHT - EPS : EPS)) : cell(v))
  for (let n = 0; n < steps; n++) {
    const before = b[key]
    const fromCell = lead(before)
    const fits = (t: number): boolean => {
      b[key] = before + s * t
      return !overlaps(w, b.x, b.y, b.z) && !wallCrossed(w, b, axis, fromCell, lead(b[key]))
    }
    if (fits(1)) continue
    // As far as it goes: the largest share of the step that fits, found by halving.
    let lo = 0, hi = 1
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid }
    b[key] = before + s * lo
    return true
  }
  return false
}

/**
 * Whether gravity holds for the body: where its feet are, or anywhere in the
 * two cells under them, is surveyed. Feet on the top layer of a surveyed
 * chunk round into the chunk above, which may not be, and a jump from there
 * rises more than a block into it: both must still stand, jump and land.
 */
export function gravityHolds(w: BodyWorld, b: Pick<Body, 'x' | 'y' | 'z'>): boolean {
  const i = cell(b.x), k = cell(b.z)
  return w.gravity(i, cell(b.y + EPS), k) || w.gravity(i, cell(b.y - 1), k) || w.gravity(i, cell(b.y - 2), k)
}

/** The longest step of the physics, seconds: a slow frame is stepped in parts, so a jump is as high at 20 frames a second as at 120. */
export const SUBSTEP = 1 / 120

/** One frame of the body: walk, jump, fall, collide, in steps of at most SUBSTEP. Mutates and returns `b`. */
export function stepBody(b: Body, input: BodyInput, w: BodyWorld, dtIn: number): Body {
  const dt = Math.min(MAX_DT, Math.max(0, dtIn))
  const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9))
  for (let i = 0; i < n; i++) step(b, input, w, dt / n)
  return b
}

function step(b: Body, input: BodyInput, w: BodyWorld, dt: number): Body {
  const moving = input.forward !== 0 || input.right !== 0
  b.held = moving ? b.held + dt : 0
  const speed = b.held > RUN_AFTER_S ? RUN_SPEED : WALK_SPEED
  // Forward is -Z turned by yaw; right is +X turned by yaw.
  const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw)
  let fx = input.right * cos - input.forward * sin
  let fz = -input.right * sin - input.forward * cos
  const len = Math.hypot(fx, fz)
  if (len > 1) { fx /= len; fz /= len }
  moveAxis(w, b, 0, fx * speed * dt)
  moveAxis(w, b, 2, fz * speed * dt)

  const falls = gravityHolds(w, b)
  if (!falls) {
    // Floating in a chunk not surveyed: no fall, and up and down move straight.
    b.vy = 0
    b.onGround = false
    if (input.lift !== 0) moveAxis(w, b, 1, input.lift * WALK_SPEED * dt)
    return b
  }
  if (input.jump && b.onGround) { b.vy = JUMP_VELOCITY; b.onGround = false }
  b.vy = Math.max(-MAX_FALL, b.vy - GRAVITY * dt)
  const stopped = moveAxis(w, b, 1, b.vy * dt)
  if (stopped) {
    if (b.vy < 0) b.onGround = true
    b.vy = 0
  } else {
    // Standing still on a floor: a hair below the feet is solid.
    b.onGround = b.vy <= 0 && overlaps(w, b.x, b.y - 0.02, b.z)
  }
  return b
}

/**
 * Lift a body out of anything solid it stands in (a chunk just surveyed may
 * fill the space round it): straight up to the first place it fits, at most
 * `max` blocks. True when it now fits.
 */
export function liftFree(b: Body, w: BodyWorld, max = 96): boolean {
  if (!overlaps(w, b.x, b.y, b.z)) return true
  const start = b.y
  for (let up = 1; up <= max; up++) {
    const y = cell(start) + up - 0.5
    if (!overlaps(w, b.x, y, b.z)) { b.y = y; b.vy = 0; return true }
  }
  return false
}
