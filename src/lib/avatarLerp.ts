/**
 * avatarLerp.ts: how every avatar gets from where it was to where it is.
 *
 * One duration and one helper for all of them (arkinox, 2026-10-12: "All
 * avatar movement should LERP. Also, slow down the lerp a bit and tie it to a
 * single constant we can adjust to taste"). Your own avatar (and a spectated
 * one, which is drawn in its place) glides through scene/Travel.tsx; everyone
 * else, targets and passers-by, through scene/OtherAvatar.tsx. Both use
 * AvatarLerp, so nobody can move at a different pace from anybody else.
 *
 * What is animated is an OFFSET from where the avatar now really stands, in
 * render cells, never the position itself: the store moves in one step, the
 * avatar is drawn at its new place plus this offset, and the offset decays to
 * zero. On the frame a move lands the offset is exactly "where it was minus
 * where it is", so the avatar is drawn where it was and nowhere else; it then
 * travels, and is at the destination only when it arrives (arkinox,
 * 2026-10-12: "The avatar shouldn't be at the destination until it LERPS
 * there"). An offset is also blind to the render frame shifting under it
 * (your own hop moves everyone's render coordinates), so another avatar's
 * glide survives you moving mid-flight.
 */

/**
 * How long one avatar move takes to draw, in milliseconds. The knob to turn.
 *
 * Before 2026-10-12 only your own avatar moved, and its duration scaled with
 * distance: 220 ms plus 45 ms per render cell, capped at 900 ms (a one-cell
 * hop 265 ms, a five-cell hop 445 ms). Now it is one fixed duration for
 * every avatar and every distance, about twice the short hops a sweep is made
 * of, so a moving avatar can be followed by eye (arkinox, 2026-10-12).
 */
export const AVATAR_LERP_MS = 600

/**
 * A move longer than this many render cells is drawn as a cut, not a glide:
 * its start is outside the drawn world, so nobody would see the flight.
 */
export const AVATAR_SNAP_CELLS = 400

export type Vec3 = [number, number, number]

/**
 * The share of a move still to go at `t` (0 at the start, 1 at the end):
 * 1 down to 0, eased out (cubic), so the avatar leaves briskly and settles
 * onto its destination rather than stopping dead on it.
 */
export function lerpRemaining(t: number): number {
  if (t <= 0) return 1
  if (t >= 1) return 0
  const k = 1 - t
  return k * k * k
}

/** One avatar's glide: the offset from its true place to where it is drawn. */
export class AvatarLerp {
  private from: Vec3 = [0, 0, 0]
  private startedAt: number | null = null

  /**
   * The avatar just moved. `was` is where it was drawn before, as an offset
   * from where it now truly stands (old place minus new place, in render
   * cells). A move that lands mid-glide starts from wherever the avatar is
   * drawn right now, so a quick run of moves never jumps.
   */
  move(was: Vec3, now: number): void {
    const cur = this.offset(now)
    const x = cur[0] + was[0], y = cur[1] + was[1], z = cur[2] + was[2]
    if ((x === 0 && y === 0 && z === 0) || Math.hypot(x, y, z) > AVATAR_SNAP_CELLS) { this.clear(); return }
    this.from = [x, y, z]
    this.startedAt = now
  }

  /** Stop wherever it is: a cut (another chain, a scrub), not a journey. */
  clear(): void {
    this.from = [0, 0, 0]
    this.startedAt = null
  }

  /** Whether a glide is under way at `now`. */
  moving(now: number): boolean {
    return this.startedAt !== null && now - this.startedAt < AVATAR_LERP_MS
  }

  /**
   * The offset to draw at `now`, written into `out` (allocation free, since
   * this runs every frame for every avatar) and returned. Zero once arrived.
   */
  offset(now: number, out: Vec3 = [0, 0, 0]): Vec3 {
    if (this.startedAt === null) { out[0] = 0; out[1] = 0; out[2] = 0; return out }
    const k = lerpRemaining((now - this.startedAt) / AVATAR_LERP_MS)
    if (k === 0) this.clear()
    out[0] = this.from[0] * k + 0
    out[1] = this.from[1] * k + 0
    out[2] = this.from[2] * k + 0
    return out
  }
}
