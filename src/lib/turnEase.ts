/**
 * turnEase.ts - an avatar turning to a new heading, over TURN_MS.
 *
 * Someone else's avatar faces the way their last move went (lib/facing.ts
 * seenTurn). A new heading is not a snap: the drawn shape turns from where
 * it pointed to the new heading over a fifth of a second, eased in and out,
 * along the shorter way round (a quaternion slerp takes the shorter arc), so
 * a turn from just left of behind to just right of behind is a small swing
 * and not most of a circle. A view turn snaps, as the rest of the world does
 * (scene/Avatar.tsx turnedFor); only a new heading within one view eases.
 *
 * Driven per frame, allocation free: one slerp per avatar.
 */

import { Quaternion } from 'three'

/** How long a turn to a new heading takes (ms). */
export const TURN_MS = 200

const ease = (t: number): number => t * t * (3 - 2 * t)

export class TurnEase {
  private readonly from = new Quaternion()
  private readonly to = new Quaternion()
  private startedAt: number | null = null

  /** Snap to `q` at once: the first heading, or a view turn. */
  snap(q: Quaternion): void {
    this.to.copy(q)
    this.from.copy(q)
    this.startedAt = null
  }

  /**
   * Turn toward `q` from wherever the turn stands at `now`; nothing to do
   * when `q` is already the heading turned to.
   */
  aim(q: Quaternion, now: number): void {
    if (Math.abs(this.to.dot(q)) > 1 - 1e-9) return
    this.at(now, this.from)
    this.to.copy(q)
    this.startedAt = now
  }

  /** The turn at `now`, written into `out`. */
  at(now: number, out: Quaternion): Quaternion {
    if (this.startedAt === null) return out.copy(this.to)
    const t = (now - this.startedAt) / TURN_MS
    if (t >= 1) {
      this.startedAt = null
      return out.copy(this.to)
    }
    return out.slerpQuaternions(this.from, this.to, ease(Math.max(0, t)))
  }

  /** Whether a turn is under way at `now`. */
  turning(now: number): boolean {
    return this.startedAt !== null && now - this.startedAt < TURN_MS
  }
}
