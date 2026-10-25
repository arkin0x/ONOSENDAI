/**
 * avatarMarker.ts - how the icosahedron marker (AvatarShape) is drawn, kept
 * apart as plain data so a test can put it through three's own render list.
 */

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
