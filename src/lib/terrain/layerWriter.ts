/**
 * layerWriter.ts - the next version of this device's layer for a chunk
 * (DECK-0009 §5.3, §5.5, §5.7): what changed since the version last
 * published, settled at one new block.
 *
 * - A cell placed for the first time, or placed again after it was released
 *   (returned to its ground), takes the new settle as both its first and its
 *   latest change, and the new settle claims it (Claiming).
 * - A cell still placed keeps its first settle; its latest is the new settle
 *   only when its value changed.
 * - Every settle a cell of the new version still names is carried unchanged,
 *   claims and all (Carrying); settles nothing names are let go.
 * - Past 32 settles the newest are merged into the new one, which claims
 *   every cell whose first settle moves to it (Merging): the oldest keep
 *   their place in the order, as the DECK recommends.
 * - The plane not being written is carried as it was (§5.7).
 */

import { CELLS } from './coords'
import {
  GROUND_REVISION, SETTLES_MAX, claimsOf, decodePlane, encodePlane,
  type LayerPlaintext, type PlaneObject, type Settle,
} from './blockLayer'

/** The block a new settle commits to: at least 6 below the tip (§5.3). */
export interface CommittedBlock {
  height: number
  hash: string
}

/** Sixteen random hex characters, a settle's nonce. */
export function randomNonce(): string {
  const b = new Uint8Array(8)
  globalThis.crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

interface Cell { v: number; t0: number; t1: number }

/** A plane of `prev`'s, decoded to its placements by cell, with settle indexes into prev's settles; null when it is not one this client reads. */
function placementsOf(pl: PlaneObject | undefined, ground: Uint8Array, settleCount: number): Map<number, Cell> | null {
  if (!pl) return null
  const d = decodePlane(pl, ground, settleCount)
  if (!d || d === 'aside') return null
  const out = new Map<number, Cell>()
  d.placements.forEach((cell, k) => out.set(cell, { v: d.values[cell], t0: d.t0[k], t1: d.t1[k] }))
  return out
}

/**
 * The next plaintext: `prev` is the version last published for this chunk
 * (null for the first), `values` what this device holds in `plane` now, over
 * its `ground`. Returns null when nothing changed since `prev`.
 */
export function nextPlaintext(o: {
  prev: LayerPlaintext | null
  plane: 0 | 1
  values: ArrayLike<number>
  ground: Uint8Array
  /** The other plane's ground, needed only to carry its times through a merge. */
  otherGround?: Uint8Array | null
  block: CommittedBlock
  nonce?: string
  builders?: string[]
}): LayerPlaintext | null {
  const { prev, plane, values, ground, block } = o
  const prevSettles = prev?.settles ?? []
  const was = placementsOf(prev?.planes.find((p) => p.plane === plane), ground, prevSettles.length) ?? new Map<number, Cell>()
  const otherPlane = (1 - plane) as 0 | 1
  // The other plane is carried when it can be read (its ground given); one this client cannot read is let go, never rewritten blind.
  const otherObj = prev?.planes.find((p) => p.plane === otherPlane)
  const other = otherObj && o.otherGround ? placementsOf(otherObj, o.otherGround, prevSettles.length) : null

  // This plane's placements now, by cell: the old settle index where kept, -1 (the new settle) where not.
  const NEW = -1
  const now = new Map<number, { t0: number; t1: number }>()
  let changed = false
  for (let c = 0; c < CELLS; c++) {
    if (values[c] === ground[c]) continue
    const w = was.get(c)
    if (w) {
      const t1 = w.v === values[c] ? w.t1 : NEW
      if (t1 === NEW) changed = true
      now.set(c, { t0: w.t0, t1 })
    } else {
      changed = true
      now.set(c, { t0: NEW, t1: NEW })
    }
  }
  for (const c of was.keys()) if (!now.has(c)) changed = true
  if (prev && !changed) return null

  // The settles still named, in either plane.
  const named = new Set<number>()
  for (const t of now.values()) { if (t.t0 >= 0) named.add(t.t0); if (t.t1 >= 0) named.add(t.t1) }
  if (other) for (const t of other.values()) { named.add(t.t0); named.add(t.t1) }

  // Merging (§5.3): keep the oldest; the newest move to the new settle.
  const carried = [...named].sort((a, b) => prevSettles[a][0] - prevSettles[b][0] || a - b)
  const keep = new Set(carried.slice(0, SETTLES_MAX - 1))
  const move = (i: number): number => (i >= 0 && !keep.has(i) ? NEW : i)
  for (const [c, t] of now) now.set(c, { t0: move(t.t0), t1: move(t.t1) })
  const otherNow = new Map<number, { t0: number; t1: number }>()
  if (other) for (const [c, t] of other) otherNow.set(c, { t0: move(t.t0), t1: move(t.t1) })

  // The new settle's claims: every cell whose first settle is it, in either plane (Claiming).
  const claim: [Set<number>, Set<number>] = [new Set(), new Set()]
  for (const [c, t] of now) if (t.t0 === NEW) claim[plane].add(c)
  for (const [c, t] of otherNow) if (t.t0 === NEW) claim[otherPlane].add(c)
  const usesNew = [...now.values(), ...otherNow.values()].some((t) => t.t0 === NEW || t.t1 === NEW)

  // A new settle is never earlier than a settle it follows (t0 no later than t1).
  const order = [...keep].sort((a, b) => a - b)
  let height = block.height
  let hash = block.hash
  for (const i of order) if (prevSettles[i][0] > height) { height = prevSettles[i][0]; hash = prevSettles[i][1] }
  const fresh: Settle = [height, hash, o.nonce ?? randomNonce(), claimsOf(claim[0], claim[1])]
  const settles: Settle[] = order.map((i) => prevSettles[i])
  // A layer holds at least one settle: one that claims nothing when no cell names any (a layer that only surveys).
  if (usesNew || settles.length === 0) settles.push(fresh)
  const index = new Map<number, number>(order.map((i, k) => [i, k]))
  const NEW_AT = settles.length - 1
  const at = (i: number): number => (i === NEW ? NEW_AT : index.get(i)!)

  const t0 = new Map<number, number>(), t1 = new Map<number, number>()
  for (const [c, t] of now) { t0.set(c, at(t.t0)); t1.set(c, at(t.t1)) }
  const planes: PlaneObject[] = [encodePlane(plane, true, values, ground, t0, t1)]
  if (otherObj && other && o.otherGround) {
    const g = o.otherGround
    const vals = otherObj.survey ? Int32Array.from(g) : new Int32Array(CELLS)
    const o0 = new Map<number, number>(), o1 = new Map<number, number>()
    for (const [c, t] of otherNow) { o0.set(c, at(t.t0)); o1.set(c, at(t.t1)); vals[c] = other.get(c)!.v }
    planes.push(encodePlane(otherPlane, otherObj.survey, vals, g, o0, o1))
  }
  planes.sort((a, b) => a.plane - b.plane)
  return { settles, builders: o.builders ?? prev?.builders ?? [], planes }
}

/** A version that only surveys: the plane's base, no placements, one settle that claims nothing (§5.5, §5.7). */
export function surveyOnlyPlaintext(plane: 0 | 1, block: CommittedBlock, nonce: string = randomNonce()): LayerPlaintext {
  return {
    settles: [[block.height, block.hash, nonce, claimsOf(new Set(), new Set())]],
    builders: [],
    planes: [{ plane, survey: true, ground: GROUND_REVISION, form: 'diff', pal: [null], cells: [0, -(CELLS - 1)], t0: [], t1: [] }],
  }
}
