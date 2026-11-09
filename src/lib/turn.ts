/**
 * turn.ts - a deployed copy turned by quarter turns on X, Y and Z.
 *
 * The deploy bar turns what goes out, never the workshop's model, the way it
 * already sets its size (SCALE) and its bearing on Earth (spin). A quarter
 * turn is exact on the lattice: every point in whole ticks lands on whole
 * ticks, so nothing is rounded, and a proper rotation keeps every face's
 * winding, so fronts stay fronts (DECK-0003 §1.4). Placed objects turn with
 * the points: their origins swing about the model's origin and each takes the
 * same quarter itself (sno-core quarterTurnPart). No spec field is involved:
 * the turn is baked into the copy, so every reader, old or new, draws it as
 * turned (arkinox chose this over a new orientation field, 2026-09-27).
 *
 * Order: X, then Y, then Z, each about the model's own origin, in the model
 * frame the geometry is stored in.
 */

import { quarterTurnPart } from 'sno-core/parts'
import { ticksOf, vertexAt, type ShardModel } from 'sno-core/shards'

/** Quarter turns about X, Y and Z, each 0..3. */
export type Turns = [number, number, number]

/** The plane each axis turns in, taking its first axis toward its second: right-handed positive. */
const PLANE: Array<[0 | 1 | 2, 0 | 1 | 2]> = [[1, 2], [2, 0], [0, 1]]

/** One quarter turn in the plane (a, b), taking a toward b. */
function quarter(p: readonly number[], a: 0 | 1 | 2, b: 0 | 1 | 2): [number, number, number] {
  const q = [p[0], p[1], p[2]] as [number, number, number]
  q[a] = -p[b]
  q[b] = p[a]
  return q
}

/** A direction turned as turnShard turns a model's points: where a side of the model faces once turned. */
export function turnDirection(d: readonly [number, number, number], turns: Turns): [number, number, number] {
  let q = [d[0], d[1], d[2]] as [number, number, number]
  turns.forEach((t, axis) => {
    const [a, b] = PLANE[axis]
    for (let k = 0; k < ((t % 4) + 4) % 4; k++) q = quarter(q, a, b)
  })
  return q
}

/** The shard turned; the same object when there is nothing to turn. */
export function turnShard(s: ShardModel, turns: Turns): ShardModel {
  if (turns.every((t) => ((t % 4) + 4) % 4 === 0)) return s
  let vertices = s.vertices
  let parts = s.parts
  turns.forEach((t, axis) => {
    const [a, b] = PLANE[axis]
    for (let k = 0; k < ((t % 4) + 4) % 4; k++) {
      vertices = vertices.map((v) => vertexAt(quarter(ticksOf(v), a, b), v.c))
      if (parts) parts = parts.map((part) => quarterTurnPart(part, a, b, [0, 0]) ?? part)
    }
  })
  return parts ? { ...s, vertices, parts } : { ...s, vertices }
}
