/**
 * renderFrame.ts: the anchor the scene on screen is drawn against.
 *
 * Everything React draws is placed against the anchor's aligned origin, and
 * a landing moves the anchor in the store first and in the scene only when
 * React commits. A frame can be drawn in between. Per-frame code that read
 * the store's anchor then worked in the new frame while the meshes were
 * still in the old one: the camera absorbed the origin shift a frame early
 * and the world seemed to step back a cell and forward again, the hitch at
 * every landing of a walk (measured 2026-10-13: the eye's forward motion
 * read -0.6 cell on the landing frame, then +1.1).
 *
 * So per-frame code places things against this instead: written in a layout
 * effect, in the same commit that moves the meshes (scene/Scene.tsx
 * FrameCommit), it is always the anchor the scene was drawn with.
 */

import type { Position } from './space'

let committed: Position | null = null

/** The anchor the scene was last committed with, or null before the first commit. */
export function committedAnchor(): Position | null {
  return committed
}

/** Called from the commit that draws the scene against `anchor`. */
export function commitAnchor(anchor: Position): void {
  committed = anchor
}
