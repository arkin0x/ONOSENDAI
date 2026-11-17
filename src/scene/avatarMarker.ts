/**
 * avatarMarker.ts - how the icosahedron marker (AvatarShape) is drawn, kept
 * apart as plain data so a test can put it through three's own render list.
 */

import { EdgesGeometry, IcosahedronGeometry } from 'three'
import { AVATAR_MARKER_HALF } from '../lib/avatar'

/**
 * The default avatar's shape: a wireframe icosahedron one cell across, with
 * a vertex straight above and below its centre. An avatar's origin is the
 * point that touches the ground (arkinox, 2026-11-17), and the icosahedron's
 * is its lowest vertex: it is drawn MARKER_LIFT up from where an avatar
 * stands, outside the turn that faces it the way it moved, so it still
 * turns about its centre and never swings off its gibson (review of #800).
 * `lifted` builds the lift into the shape, for the workshop's still views,
 * which never turn it.
 */
export function markerEdges(lifted = false): EdgesGeometry {
  const ico = new IcosahedronGeometry(AVATAR_MARKER_HALF, 1)
  ico.computeBoundingBox()
  if (lifted) ico.translate(0, -ico.boundingBox!.min.y, 0)
  const edges = new EdgesGeometry(ico)
  ico.dispose()
  return edges
}

/** How far the icosahedron is drawn above where it stands, in its own cells (times its spectator shrink): its lowest vertex onto the ground. */
export const MARKER_LIFT = AVATAR_MARKER_HALF

/**
 * The marker's line material: depth tested, or drawn over everything (your
 * own avatar, Avatar.tsx), or the faint outline.
 *
 * Drawn over everything, it is transparent at full opacity. Every shard face
 * is in three's transparent list (shardFaces.ts), which three draws after the
 * whole opaque list whatever the render orders say, and a material with no
 * depth test writes no depth either. Opaque, the marker was drawn first and
 * every shard face behind it on screen painted over it, at any distance: a
 * floor below you hid the half of you seen against it (arkinox, 2026-10-24:
 * "glitch - default avatar is clipped by shards"). In the transparent list
 * its render order (10) draws it after every shard face (0 to OVERLAY_ORDER),
 * as the outline and the cursor's ghost already were. Blended at opacity 1 it
 * writes the colour and alpha it wrote opaque, so the bloom sees it as before.
 *
 * Depth tested (anyone else's marker), it stays opaque: depth decides who is
 * in front, against shards as against everything else.
 */
export function markerMaterialProps({ depthTest = true, outline = false }: { depthTest?: boolean; outline?: boolean }): { depthTest: boolean; transparent?: boolean; opacity?: number } {
  if (outline) return { depthTest, transparent: true, opacity: 0.3 }
  return depthTest ? { depthTest } : { depthTest, transparent: true, opacity: 1 }
}
