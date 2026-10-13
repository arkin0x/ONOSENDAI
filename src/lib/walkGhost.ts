/**
 * walkGhost.ts: where WALK's proven-head outline is drawn, and how strongly.
 *
 * While a walk runs ahead of its proofs, a faint outline of you stands at the
 * chain's real head (scene/Avatar.tsx). Three rules (arkinox, 2026-10-13):
 *
 * | Moment | The outline |
 * |---|---|
 * | A step is pressed with the chain caught up | appears at the proven head at once, no glide |
 * | A step lands and the chain is still behind | eases from the old proven head to the new one |
 * | The step that catches the chain up lands | stays where it stood, one step back, and fades out |
 *
 * The last row is the point. The catching-up landing is at the eye, so
 * easing there carried the outline across the view, in front of you.
 *
 * Positions are kept as coordinates and placed against the current origin
 * every frame, so a landing re-anchoring the scene moves nothing: the
 * outline is a place in cyberspace, and the frame change cancels out exactly
 * as it does for everything else drawn (lib/space.ts originShift).
 */

import { alignTo, placeCentre, type Position, type ViewAxes } from './space'

/** How long the outline takes to fade out once the chain has caught up. */
export const GHOST_FADE_MS = 350
/** The time constant of the glide from one proven step to the next, in seconds: the avatar's own travel beat. */
export const GHOST_GLIDE_TAU = 0.15

/** What the ghost reads from the store each frame. */
export interface GhostInput {
  walking: boolean
  cursor: Position
  position: Position
  anchor: Position
  scaleExp: number
  axes: () => ViewAxes
}

/** Where to draw it, in render cells, and its strength from 0 to 1; null when it is not drawn. */
export interface GhostFrame {
  at: [number, number, number]
  fade: number
}

const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z

export class WalkGhost {
  /** The coordinate it stands on, or null when it is not drawn. */
  private at: Position | null = null
  /** The rest of a glide, in render cells, added to `at`'s place and easing to zero. */
  private glide: [number, number, number] = [0, 0, 0]
  /** When the fade began, or null while it is at full strength. */
  private fadeFrom: number | null = null

  /** Forget everything: out of WALK it is never drawn, and coming back starts it fresh. */
  reset(): void {
    this.at = null
    this.glide = [0, 0, 0]
    this.fadeFrom = null
  }

  /** One frame: `now` in ms, `dt` in seconds. */
  frame(s: GhostInput, now: number, dt: number): GhostFrame | null {
    if (!s.walking) { this.reset(); return null }
    const behind = !same(s.cursor, s.position)
    const axes = s.axes()
    // The render origin: the anchor's aligned cell, as the scene's own.
    const origin = { x: alignTo(s.anchor.x, s.scaleExp), y: alignTo(s.anchor.y, s.scaleExp), z: alignTo(s.anchor.z, s.scaleExp) }
    const place = (p: Position): [number, number, number] => placeCentre(p, origin, s.scaleExp, axes)

    if (behind) {
      if (this.at === null || this.fadeFrom !== null) {
        // Back, or fading and pressed again: at the proven head at once.
        this.at = { ...s.position }
        this.glide = [0, 0, 0]
        this.fadeFrom = null
      } else if (!same(this.at, s.position)) {
        // A step landed and the chain is still behind: glide on from where
        // it is drawn now to the new proven head, which is still behind the eye.
        const was = place(this.at)
        const next = place(s.position)
        this.glide = [
          was[0] + this.glide[0] - next[0],
          was[1] + this.glide[1] - next[1],
          was[2] + this.glide[2] - next[2],
        ]
        this.at = { ...s.position }
      }
      const k = Math.exp(-Math.max(0, dt) / GHOST_GLIDE_TAU)
      this.glide = [this.glide[0] * k, this.glide[1] * k, this.glide[2] * k]
    } else {
      // Caught up. It stays where it stood and fades there, glide frozen.
      if (this.at === null) return null
      if (this.fadeFrom === null) this.fadeFrom = now
    }

    const fade = this.fadeFrom === null ? 1 : 1 - (now - this.fadeFrom) / GHOST_FADE_MS
    if (fade <= 0) { this.reset(); return null }
    const p = place(this.at)
    return { at: [p[0] + this.glide[0], p[1] + this.glide[1], p[2] + this.glide[2]], fade }
  }
}
