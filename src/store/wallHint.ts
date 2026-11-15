/**
 * wallHint.ts - a brief outline of a wall the walker cannot see.
 *
 * An object at opacity 0 still stops a walker by its `constrain` (owner
 * ruling, 2026-11-15: invisible walls and floors are a building tool). So
 * that a stop is never a mystery, a WALK step stopped by the face of an
 * object that draws nothing you can see flashes a faint outline of that
 * object's faces for a moment (scene/WalkContactHint.tsx). A visible wall
 * never flashes: you can see what stopped you.
 *
 * Unseen means: opacity 0 (its glow, if any, does not show where the faces
 * are), or POINTS mode at point size 0 with no glow. Judged on the object
 * the walls name (WallItem.shard), its own drawing; a wall in a placed part
 * of an object you can see is not told apart.
 */

import { create } from 'zustand'
import { drawnGlow, drawnPointSize } from 'sno-core/glow'
import { drawnOpacity, type ShardModel } from 'sno-core/shards'

/** How long the outline shows, all told, ms: in, held, out. */
export const WALL_HINT_MS = 700
/** Its fade in and its fade out, ms. */
export const WALL_HINT_IN_MS = 120
export const WALL_HINT_OUT_MS = 380
/** How strong the outline is at its peak: faint. */
export const WALL_HINT_OPACITY = 0.45

/** Whether a walker stopped by `s` could not see it. */
export function unseenWall(s: Pick<ShardModel, 'mode' | 'opacity' | 'vertices'> & Partial<Pick<ShardModel, 'extra'>>): boolean {
  if (s.vertices.length === 0) return false
  if (drawnOpacity(s) === 0) return true
  return s.mode === 'points' && drawnPointSize(s) === 0 && drawnGlow(s) === undefined
}

/**
 * The outline's share of WALL_HINT_OPACITY `elapsed` ms after the stop: up
 * over WALL_HINT_IN_MS, held, down over WALL_HINT_OUT_MS, 0 once WALL_HINT_MS
 * has passed (expired). Reduced motion: no fade in, it shows at once and
 * fades out.
 */
export function wallHintShare(elapsed: number, reduced = false): number {
  if (!(elapsed >= 0) || elapsed >= WALL_HINT_MS) return 0
  const out = Math.min(1, (WALL_HINT_MS - elapsed) / WALL_HINT_OUT_MS)
  const into = reduced ? 1 : Math.min(1, elapsed / WALL_HINT_IN_MS)
  return Math.min(into, out)
}

interface WallHintState {
  /** The wall's key (WallItem.key) and when it stopped the walker (performance.now()), or null. */
  key: string | null
  at: number
}

export const useWallHint = create<WallHintState>(() => ({ key: null, at: 0 }))

/** A WALK step was stopped by `by`: flash it if it cannot be seen. Returns whether it flashes. */
export function noteWallContact(by: { key: string; shard: Parameters<typeof unseenWall>[0] }, now = performance.now()): boolean {
  if (!unseenWall(by.shard)) return false
  const s = useWallHint.getState()
  // A held key's repeats keep one flash going rather than restarting it every step.
  if (s.key === by.key && now - s.at < WALL_HINT_MS - WALL_HINT_OUT_MS) return true
  useWallHint.setState({ key: by.key, at: now })
  return true
}

/** Whether the hint for `key` is still showing at `now`. */
export function wallHintLive(key: string, now = performance.now()): boolean {
  const s = useWallHint.getState()
  return s.key === key && now - s.at < WALL_HINT_MS
}
