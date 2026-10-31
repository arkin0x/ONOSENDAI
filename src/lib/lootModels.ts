/**
 * lootModels.ts: the two built-in models loot floats out of a chest as when
 * a content has no model of its own (arkinox, 2026-10-30: "if there is one or
 * more messages, a scroll object comes out ... if not, have a generic item
 * object float out").
 *
 *   SCROLL  a rolled parchment on its side, its rod ends dark wood and a red
 *           ribbon round its middle: the app's message icon (lucide
 *           scroll-text) made solid.
 *   ITEM    a key with a round bow, a shaft and two teeth, in gold: the app's
 *           item icon (lucide key-round) made solid.
 *
 * Low-poly SNO shards in the house style: flat coloured faces, colours from
 * the owner's treasure chest palette (wood, iron, gold, the ribbon's red)
 * and one parchment, wound outward by sno-core's own guess (the workshop's
 * AUTO), one model unit a gibson. Made here, in
 * code, never fetched and never published; they round-trip through sno-core's
 * payload like any shard (lootModels.test.ts).
 */

import { TICKS_PER_UNIT, type ShardModel, type ShardVertex } from 'sno-core/shards'
import { windOutward } from 'sno-core/winding'

type RGB = [number, number, number]
const rgb = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255]

/** The treasure chest's palette (chest-door/models/chest.json), and parchment. */
export const LOOT_PALETTE: RGB[] = [
  rgb(176, 120, 66), rgb(112, 70, 38), rgb(70, 44, 26), rgb(72, 72, 80), rgb(150, 156, 164), rgb(206, 210, 216),
  rgb(232, 184, 52), rgb(252, 226, 128), rgb(168, 118, 30), rgb(255, 168, 40), rgb(208, 104, 24), rgb(118, 26, 42),
  rgb(28, 24, 30), rgb(236, 222, 184), rgb(214, 196, 150),
]
const WOOD_DARK = LOOT_PALETTE[2]
const GOLD = LOOT_PALETTE[6]
const GOLD_DEEP = LOOT_PALETTE[8]
const RED = LOOT_PALETTE[11]
const PARCHMENT = LOOT_PALETTE[13]
const PARCHMENT_SHADE = LOOT_PALETTE[14]

/** A mesh being built: points, triangles and a colour per triangle. */
interface Build { v: Array<[number, number, number]>; c: RGB[]; f: Array<[number, number, number]>; fc: RGB[] }

const build = (): Build => ({ v: [], c: [], f: [], fc: [] })

function point(b: Build, p: [number, number, number], c: RGB): number {
  b.v.push(p)
  b.c.push(c)
  return b.v.length - 1
}

/** A quad a, b, c, d (counter-clockwise seen from outside) as two triangles. */
function quad(b: Build, a: number, bb: number, c: number, d: number, col: RGB): void {
  b.f.push([a, bb, c], [a, c, d])
  b.fc.push(col, col)
}

/** A prism along X from x0 to x1, `sides` round at `radius`, capped: a scroll's barrel, a rod's end. */
function prismX(b: Build, x0: number, x1: number, radius: number, sides: number, side: (i: number) => RGB, cap: RGB): void {
  const ring = (x: number): number[] => Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2 + Math.PI / sides
    return point(b, [x, radius * Math.cos(a), radius * Math.sin(a)], cap)
  })
  const r0 = ring(x0), r1 = ring(x1)
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    quad(b, r0[i], r0[j], r1[j], r1[i], side(i))
  }
  for (let i = 1; i + 1 < sides; i++) {
    b.f.push([r0[0], r0[i + 1], r0[i]]); b.fc.push(cap)
    b.f.push([r1[0], r1[i], r1[i + 1]]); b.fc.push(cap)
  }
}

/** A box from `lo` to `hi`, each face outward. */
function box(b: Build, lo: [number, number, number], hi: [number, number, number], col: RGB): void {
  const p = (x: number, y: number, z: number): number => point(b, [x ? hi[0] : lo[0], y ? hi[1] : lo[1], z ? hi[2] : lo[2]], col)
  const v = [p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0), p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)]
  quad(b, v[0], v[3], v[2], v[1], col) // -z
  quad(b, v[4], v[5], v[6], v[7], col) // +z
  quad(b, v[0], v[1], v[5], v[4], col) // -y
  quad(b, v[3], v[7], v[6], v[2], col) // +y
  quad(b, v[0], v[4], v[7], v[3], col) // -x
  quad(b, v[1], v[2], v[6], v[5], col) // +x
}

/** A flat ring in the XY plane about (cx, cy): a key's round bow, `sides` round, `depth` thick in Z. */
function ringXY(b: Build, cx: number, cy: number, inner: number, outer: number, depth: number, sides: number, col: RGB, edge: RGB): void {
  const at = (r: number, i: number, z: number): number => {
    const a = (i / sides) * Math.PI * 2 + Math.PI / sides
    return point(b, [cx + r * Math.cos(a), cy + r * Math.sin(a), z], col)
  }
  const h = depth / 2
  const of = Array.from({ length: sides }, (_, i) => at(outer, i, h)), inf = Array.from({ length: sides }, (_, i) => at(inner, i, h))
  const ob = Array.from({ length: sides }, (_, i) => at(outer, i, -h)), ib = Array.from({ length: sides }, (_, i) => at(inner, i, -h))
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    quad(b, inf[i], of[i], of[j], inf[j], col) // front, +z
    quad(b, ib[i], ib[j], ob[j], ob[i], col) // back, -z
    quad(b, of[i], ob[i], ob[j], of[j], edge) // outer rim
    quad(b, inf[i], inf[j], ib[j], ib[i], edge) // inner rim
  }
}

/** A built mesh as a shard: unit 0, each point whole units and ticks. */
function shardOf(b: Build, id: string, name: string): ShardModel {
  const vertices: ShardVertex[] = b.v.map((p, i) => {
    const ticks = p.map((x) => Math.round(x * TICKS_PER_UNIT))
    const whole = ticks.map((t) => Math.floor(t / TICKS_PER_UNIT)) as [number, number, number]
    const rest = ticks.map((t, k) => t - whole[k] * TICKS_PER_UNIT) as [number, number, number]
    return { p: whole, t: rest, c: b.c[i] }
  })
  const shard: ShardModel = { id, name, unit: 0, extent: 2, mode: 'solid', vertices, faces: b.f, facecolors: b.fc, palette: LOOT_PALETTE.map((c) => c.map((x) => Math.round(x * 255)) as RGB), up: false, spin: 0, updatedAt: 0 }
  // Wound by sno-core's own outward guess, as the workshop's AUTO winds a shape.
  return windOutward(shard)
}

/** The scroll: a parchment barrel 0.8 long on its side, dark rod ends, a red ribbon. */
export function scrollModel(): ShardModel {
  const b = build()
  const sides = 8
  // Faces round the barrel alternate a little in shade, so its roundness reads unlit.
  prismX(b, -0.4, -0.06, 0.16, sides, (i) => (i % 2 ? PARCHMENT : PARCHMENT_SHADE), PARCHMENT)
  prismX(b, 0.06, 0.4, 0.16, sides, (i) => (i % 2 ? PARCHMENT : PARCHMENT_SHADE), PARCHMENT)
  prismX(b, -0.06, 0.06, 0.175, sides, () => RED, RED)
  prismX(b, -0.5, -0.4, 0.1, 6, () => WOOD_DARK, WOOD_DARK)
  prismX(b, 0.4, 0.5, 0.1, 6, () => WOOD_DARK, WOOD_DARK)
  return shardOf(b, 'loot:scroll', 'Scroll')
}

/** The generic item: a gold key standing upright, a round bow on top. */
export function itemModel(): ShardModel {
  const b = build()
  ringXY(b, 0, 0.28, 0.09, 0.19, 0.08, 10, GOLD, GOLD_DEEP)
  box(b, [-0.035, -0.42, -0.04], [0.035, 0.1, 0.04], GOLD)
  box(b, [0.035, -0.42, -0.035], [0.17, -0.34, 0.035], GOLD_DEEP)
  box(b, [0.035, -0.28, -0.035], [0.13, -0.21, 0.035], GOLD_DEEP)
  return shardOf(b, 'loot:item', 'Item')
}

let made: { scroll: ShardModel; item: ShardModel } | null = null

/** The two, made once and shared. */
export function lootModels(): { scroll: ShardModel; item: ShardModel } {
  return (made ??= { scroll: scrollModel(), item: itemModel() })
}
