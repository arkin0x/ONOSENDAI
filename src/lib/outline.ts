/**
 * outline.ts - the edges of a shard's faces, each one once.
 *
 * LINES mode draws a shard as a wireframe of its faces. The edges come from
 * the faces as they were made, not from the triangles they are cut into for
 * drawing: a polygon's outline is its own edges, and the diagonals the
 * triangulation added are not part of the shape. An edge two faces share is
 * drawn once, so a closed solid costs one line per edge rather than two.
 */

/** Index pairs for every distinct edge of these faces, ready for a LineSegments index. */
export function faceEdges(faces: number[][]): number[] {
  const seen = new Set<string>()
  const edges: number[] = []
  for (const face of faces) {
    if (face.length < 2) continue
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      // A face of two points is one edge, not the same edge there and back.
      if (a === b || (face.length === 2 && i === 1)) continue
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push(a, b)
    }
  }
  return edges
}
