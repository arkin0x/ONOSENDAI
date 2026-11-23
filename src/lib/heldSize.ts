/**
 * heldSize.ts - how big what is held is, on each model axis, in ticks: the
 * step MOVE takes with BY SIZE on (owner, 2026-11-23: "if I select a whole
 * 16x16x16 gibson block, it will only move in 16 gibson increments in any
 * axis while this setting is on").
 *
 * The box around every held point and every held placed object as drawn (its
 * own geometry, turned and scaled where it stands; a unit cube while it has
 * not been read yet, as every bounds reader takes it: sno-core placedBounds).
 * A flat selection has no size across its plane: that axis steps by the snap.
 */

import { placedBounds, refKey, type Placed } from 'sno-core/parts'
import { TICKS_PER_UNIT, ticksOf, type ShardModel } from 'sno-core/shards'

type P3 = [number, number, number]

/** What a placed object resolves to, as lib/parts useResolved hands it over. */
export type ResolvedParts = ReadonlyMap<string, { model: ShardModel | null; children: Placed['children'] }>

/** The box around what is held, in ticks on the model's axes, or null with nothing held. */
export function heldBox(s: ShardModel, selection: readonly number[], partSel: readonly number[], resolved: ResolvedParts): { min: P3; max: P3 } | null {
  const min: P3 = [Infinity, Infinity, Infinity]
  const max: P3 = [-Infinity, -Infinity, -Infinity]
  const take = (p: readonly number[]): void => { for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]) } }
  for (const i of selection) { const v = s.vertices[i]; if (v) take(ticksOf(v)) }
  if (partSel.length) {
    const bare: ShardModel = { ...s, vertices: [], faces: [] }
    for (const i of partSel) {
      const part = s.parts?.[i]
      const ref = part ? s.refs?.[part.ref] : undefined
      if (!part || !ref) continue
      const r = resolved.get(refKey(ref))
      const b = placedBounds(bare, [{ part, ref, model: r?.model ?? null, children: r?.children ?? [] }])
      if (!b) continue
      // Render units to model ticks: Z is mirrored, so its ends swap.
      take([b.min[0] * TICKS_PER_UNIT, b.min[1] * TICKS_PER_UNIT, 0 - b.max[2] * TICKS_PER_UNIT])
      take([b.max[0] * TICKS_PER_UNIT, b.max[1] * TICKS_PER_UNIT, 0 - b.min[2] * TICKS_PER_UNIT])
    }
  }
  return min[0] === Infinity ? null : { min, max }
}

/** The held box's size on each axis, in whole ticks. */
export function heldSize(s: ShardModel, selection: readonly number[], partSel: readonly number[], resolved: ResolvedParts): P3 | null {
  const b = heldBox(s, selection, partSel, resolved)
  return b ? [0, 1, 2].map((k) => Math.round(b.max[k] - b.min[k])) as P3 : null
}

/**
 * One move's step on `axis`: the held size there with BY SIZE on, when it has
 * one, rounded up to whole snap steps so what moves stays on the snap's grid
 * (a piece turned 45 degrees is 22.63 units wide) and pieces moved side by
 * side never overlap; the snap's step otherwise.
 */
export function sizeStep(size: P3 | null, axis: 0 | 1 | 2, snap: number, bySize: boolean): number {
  if (!bySize || !size || size[axis] <= 0 || snap <= 0) return snap
  return Math.ceil(size[axis] / snap - 1e-9) * snap
}
