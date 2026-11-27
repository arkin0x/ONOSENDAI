/**
 * quarryModel.ts - the Quarry Charge's look, made here rather than drawn in
 * the workshop: a squat dark casing with an orange band round its middle and
 * an orange lamp on top, the Compiler's orange (itemMark.ts ITEM_ORANGE,
 * built-in palette 117). It is the toy a compile leaves, the picture on its
 * blueprint and on the prize card. Plain boxes, so it reads at any size, and
 * made once, with no fetch.
 */

import { fromPayload, type ShardModel, type ShardPayload } from 'sno-core/shards'

/** Built-in palette indices (sno-core snoPalette.json): the casing, its straps, the band and the lamp. */
const CASING = 199
const STRAP = 196
const BAND = 117
const LAMP = 245

/** The model's units have 120 ticks each (DECK-0003 §1.1). */
const TICKS = 120

/** The boxes it is made of: from, to (model units), and colour. */
const BOXES: ReadonlyArray<readonly [readonly [number, number, number], readonly [number, number, number], number]> = [
  [[-2, -1.5, -2], [2, 1.5, 2], CASING],
  [[-2.12, -0.35, -2.12], [2.12, 0.35, 2.12], BAND],
  [[-2.06, -1.5, -0.4], [2.06, 1.5, 0.4], STRAP],
  [[-0.55, 1.5, -0.55], [0.55, 2.3, 0.55], LAMP],
]

/** The Quarry Charge as a payload (DECK-0003 §1.1): its boxes' corners and faces. */
export function quarryPayload(): ShardPayload {
  const vertices: Array<[number, number, number]> = []
  const ticks: Array<[number, number, number]> = []
  const colors: number[] = []
  const faces: Array<[number, number, number]> = []
  const facecolors: number[] = []
  for (const [lo, hi, colour] of BOXES) {
    const base = vertices.length
    for (let k = 0; k < 8; k++) {
      const p = [k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]]
      const whole = p.map((v) => Math.floor(v)) as [number, number, number]
      vertices.push(whole)
      ticks.push(p.map((v, a) => Math.min(TICKS - 1, Math.round((v - whole[a]) * TICKS))) as [number, number, number])
      colors.push(colour)
    }
    // Two triangles a side, corners named by their bits (x 1, y 2, z 4).
    for (const [a, b, c, d] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3]]) {
      faces.push([base + a, base + b, base + c], [base + a, base + c, base + d])
    }
    facecolors.push(colour, -11)
  }
  return { v: 2, name: 'Quarry Charge', unit: 0, mode: 'solid', vertices, ticks, colors, faces, facecolors }
}

let model: ShardModel | null | undefined

/** The Quarry Charge's model, made once. */
export function quarryModel(): ShardModel | null {
  if (model === undefined) model = fromPayload(quarryPayload(), 'quarry-charge')
  return model
}
