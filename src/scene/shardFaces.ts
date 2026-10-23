/**
 * shardFaces.ts - how a shard's faces, lines and points are blended, opaque or
 * see-through (DECK-0003 §1.11 opacity).
 *
 * Kept apart from ShardMesh so the choice is plain data a test can read: the
 * material props are spread onto the JSX materials there.
 *
 * Opaque faces in the world write their colour with alpha 0, a tag the bloom
 * is blind to (Scene.tsx WorldBloom), and mark the stencil so overlays can
 * keep that tag (CoveringBox, ClipWalls OVER_FACES). Nothing about them
 * changes here.
 *
 * A see-through face (its object's opacity under 100) is blended over what is
 * behind it, and four things make that safe:
 *
 *  - The alpha under it is left as it was (blendSrcAlpha Zero, blendDstAlpha
 *    One: ClipWalls' OVER_FACES blend without the stencil split). Whatever is
 *    behind keeps its own tag: an opaque face behind the water stays a face
 *    to the bloom, a line behind it still glows, and over the empty
 *    background the texel stays alpha 0 with a colour, which the bloom reads
 *    as a face. Ordinary blending would write the water's opacity into alpha
 *    and the bloom would blow it out into a glowing sheet.
 *  - It marks the stencil like an opaque face, so CoveringBox's overlay over
 *    it also leaves its alpha alone.
 *  - It writes no depth, so what lies behind it and is drawn after it is not
 *    hidden by a surface you can see through.
 *  - It draws after every opaque face (TRANSLUCENT_ORDER). Every shard face is
 *    in three's transparent list (opaque ones are transparent at opacity 1),
 *    sorted per object by distance, and a water level placed at its room's
 *    own origin sorts level with the room: without the order it would be a
 *    coin toss whether the room painted over the water.
 *
 * And it keeps one pass for both sides (forceSinglePass). three draws a
 * transparent DoubleSide material in two passes by flipping `side` with
 * `needsUpdate` twice per object per frame, which was the 10 GB Windows tab
 * leak (#339). Faces of one colour blend the same in either order, so one
 * pass draws the same water.
 */

import {
  AddEquation,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ReplaceStencilOp,
  SrcAlphaFactor,
  ZeroFactor,
} from 'three'
import { drawnOpacity, type ShardModel } from 'sno-core/shards'

/**
 * The stencil value a tagged face leaves under every texel it draws.
 *
 * The tag lives in alpha, and anything translucent drawn over a face with
 * ordinary blending adds its own alpha and so erases it: the face then reads
 * to the bloom as bright light and blows out. The covering box did exactly
 * that to a white avatar inside it. Alpha alone cannot tell a tagged face
 * from the empty background (both are 0), so the face also marks the stencil,
 * and an overlay can draw over the mark without touching alpha (CoveringBox)
 * (arkinox, 2026-10-12).
 */
export const FACE_TAG_STENCIL = 1

/** The stencil mark, written wherever a face draws. */
const STENCIL_MARK = { stencilWrite: true, stencilRef: FACE_TAG_STENCIL, stencilZPass: ReplaceStencilOp } as const

/**
 * Colour written opaque, alpha written as 0: the tag. (Blending needs the
 * material transparent, which the face already is for its opacity.) The
 * stencil mark is the tag's second copy, for overlays (arkinox, 2026-10-12).
 */
export const TAG_BLEND = {
  blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: ZeroFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: ZeroFactor,
  ...STENCIL_MARK,
} as const

/** A see-through face in the world: blended colour, the alpha under it kept, the stencil marked. */
export const SEE_THROUGH_BLEND = {
  blending: CustomBlending, blendEquation: AddEquation, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
  ...STENCIL_MARK,
} as const

/** Where a see-through shard draws: after every opaque shard face (0), before the overlays (4 and up). */
export const TRANSLUCENT_ORDER = 1

/** How see-through a ghost (a preview that is not yet real) is drawn, before its own opacity. */
export const GHOST_OPACITY = 0.45

/**
 * What a shard is drawn at: its own opacity (sno-core drawnOpacity, with the
 * 10% floor), times a ghost's. An avatar ignores its own (DECK-0003 §3.3:
 * proof of work prices an avatar's size, not its visibility). A placed
 * object passes its own model here, never its parent's (§1.10).
 */
export function shardOpacity(shard: Pick<ShardModel, 'opacity'>, opts: { ghost?: boolean; ignoreOpacity?: boolean } = {}): number {
  return (opts.ghost ? GHOST_OPACITY : 1) * (opts.ignoreOpacity ? 1 : drawnOpacity(shard))
}

/** Whether a shard drawn at `opacity` is see-through by its own choice rather than a ghost's. */
export function seeThrough(opacity: number, ghost: boolean): boolean {
  return !ghost && opacity < 1
}

/**
 * The props of an unlit face material (meshBasicMaterial) for a shard drawn
 * at `opacity`. Opaque faces are exactly as they always were; a ghost keeps
 * its two passes for cleaner self-overlap (there are few) and its ordinary
 * blending; a see-through face takes the four rules above.
 */
export function basicFaceProps(opacity: number, { ghost, world }: { ghost: boolean; world: boolean }): Record<string, unknown> {
  const see = seeThrough(opacity, ghost)
  return {
    transparent: true,
    opacity,
    forceSinglePass: !ghost,
    ...(see ? { depthWrite: false } : {}),
    ...(world && !ghost ? (see ? SEE_THROUGH_BLEND : TAG_BLEND) : {}),
  }
}

/** The props of a lit face material (the bench's meshLambertMaterial, front and inside) at `opacity`. */
export function litFaceProps(opacity: number, ghost: boolean): Record<string, unknown> {
  return { transparent: true, opacity, ...(seeThrough(opacity, ghost) ? { depthWrite: false } : {}) }
}

/** The props of a line material at `opacity`: no depth written when see-through, so the lines behind still show. */
export function lineProps(opacity: number, ghost: boolean): Record<string, unknown> {
  return { transparent: true, opacity, ...(seeThrough(opacity, ghost) ? { depthWrite: false } : {}) }
}

/** The render order of a mesh or line drawn at `opacity`: after the opaque ones when see-through. */
export function shardOrder(opacity: number, ghost: boolean): number {
  return seeThrough(opacity, ghost) ? TRANSLUCENT_ORDER : 0
}
