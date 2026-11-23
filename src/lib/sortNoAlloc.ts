/**
 * sortNoAlloc.ts: three's render list orders, without a number boxed per compare.
 *
 * Three sorts each render's lists with comparators that return a difference of
 * two depths. A sort needs only the sign, but a double handed back to the sort
 * builtin is a new heap number: 16 bytes a compare, n log n of them, for every
 * render of every frame. Standing still at his spot in the city it was the
 * largest single allocator in the frame.
 *
 * These give the same order as painterSortStable and reversePainterSortStable,
 * compare for compare, as -1, 0 or 1, which are small integers and allocate
 * nothing.
 */

/** As much of a render item as the orders read. */
export interface Sortable { groupOrder: number; renderOrder: number; material: { id: number }; z: number; id: number }

const sign = (d: number): number => (d > 0 ? 1 : d < 0 ? -1 : 0)

/** Opaque: by group, then render order, then material, then nearest first. */
export function opaqueOrder(a: Sortable, b: Sortable): number {
  if (a.groupOrder !== b.groupOrder) return sign(a.groupOrder - b.groupOrder)
  if (a.renderOrder !== b.renderOrder) return sign(a.renderOrder - b.renderOrder)
  if (a.material.id !== b.material.id) return sign(a.material.id - b.material.id)
  if (a.z !== b.z) return sign(a.z - b.z)
  return sign(a.id - b.id)
}

/** Transparent: by group, then render order, then farthest first. */
export function transparentOrder(a: Sortable, b: Sortable): number {
  if (a.groupOrder !== b.groupOrder) return sign(a.groupOrder - b.groupOrder)
  if (a.renderOrder !== b.renderOrder) return sign(a.renderOrder - b.renderOrder)
  if (a.z !== b.z) return sign(b.z - a.z)
  return sign(a.id - b.id)
}

/** Use them on a renderer. */
export function sortWithoutBoxing(gl: { setOpaqueSort: (f: never) => void; setTransparentSort: (f: never) => void }): void {
  gl.setOpaqueSort(opaqueOrder as never)
  gl.setTransparentSort(transparentOrder as never)
}
