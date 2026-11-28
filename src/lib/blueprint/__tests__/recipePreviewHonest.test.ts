/**
 * recipePreviewHonest.test.ts - the owner's Quarry Charge of 2026-11-28 (his layer of 06:43:57Z): built exactly, its
 * bottom Umberslate a natural one he dug round, and the preview said "COMPILES · A BLOCK IS WRONG" aimed at the
 * Cinderrock and plain "COMPILES" aimed at the bottom Umberslate. The near-miss gate counted only placed blocks from
 * the hit, so with the natural Umberslate left out the recipe's own reading was skipped and the X mirror (Cinderrock
 * and Rustband swapped, two "wrong" blocks) won; from the natural block it gave up at once. Now a build is judged
 * whole: the same label from every block, the prize named when it will yield, a near miss never COMPILES.
 */

import { describe, expect, it } from 'vitest'
import { TerrainWorld } from '../../terrain/world'
import { gather, type Cell } from '../arrangement'
import { smashGroup, compiles } from '../smash'
import { CINDERROCK, COMPILER_RECIPE, FERROVEIN, GLOWCORE, GRIDSTONE, QUARRY_CHARGE_RECIPE, RUSTBAND, UMBERSLATE } from '../recipes'
import { nearMiss, nearMissLine, naturalOf, posesOf, recipeOf } from '../nearMiss'
import { previewLabel, smashPreview } from '../smashPreview'
import { smashAsk } from '../smashConfirm'
import { cellAt } from '../format'

const ORIGIN = { x: 0n, y: 0n, z: 0n, plane: 1 } as never
const AXES = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } } as never
type B = readonly [number, number, number, number]

/** His build at 06:43:57Z, in chunk cells: six placed blocks and a natural Umberslate at the bottom. */
const PLACED: ReadonlyArray<B> = [
  [12, 15, 7, RUSTBAND], [11, 15, 8, RUSTBAND], [12, 15, 8, FERROVEIN], [13, 15, 8, CINDERROCK], [12, 15, 9, RUSTBAND], [12, 16, 8, UMBERSLATE],
]
const NATURAL: ReadonlyArray<B> = [[12, 14, 8, UMBERSLATE]]

/** A real TerrainWorld: `natural` cells are its generated ground, `placed` ones are changes over open air. */
function world(placed: ReadonlyArray<B>, natural: ReadonlyArray<B> = []): { w: TerrainWorld; read: (x: number, y: number, z: number) => number } {
  const w = new TerrainWorld(ORIGIN, AXES)
  const s = w.slotAt(0, 0, 0, true)!
  const gen = new Uint8Array(32768)
  w.setBlocks(s.key, gen, gen.slice())
  for (const [x, y, z, id] of natural) { gen[x + 32 * z + 1024 * y] = id; w.setCs(x, y, z, id) }
  for (const [x, y, z, id] of placed) w.setCs(x, y, z, id)
  return { w, read: (x, y, z) => w.blockCs(x, y, z) }
}

/** The preview's label and the smash's outcome from every block, in a hand. */
function fromEvery(read: (x: number, y: number, z: number) => number, cells: ReadonlyArray<B>, bare: boolean, natural?: (x: number, y: number, z: number) => boolean): Set<string> {
  const out = new Set<string>()
  for (const [x, y, z] of cells) {
    const hit: Cell = [x, y, z]
    const p = smashPreview(read, hit, bare, natural)!
    const g = smashGroup(read, hit, bare)
    const m = nearMiss(read, hit, natural)
    out.add(`${previewLabel(p)} | compiles ${compiles(g.arrangement)} | recipe ${recipeOf(g.arrangement)} | ${m ? nearMissLine(m) : '-'}`)
  }
  return out
}

describe("the owner's Quarry Charge (06:43:57Z), natural Umberslate at the bottom", () => {
  it('QUARRY CHARGE from every block, in either hand, and no question before the smash', () => {
    const { w, read } = world(PLACED, NATURAL)
    const natural = naturalOf(w)
    expect(natural!(12, 14, 8)).toBe(true)
    for (const bare of [true, false]) {
      const seen = fromEvery(read, [...PLACED, ...NATURAL], bare, natural)
      expect([...seen]).toEqual(['QUARRY CHARGE | compiles true | recipe quarry | -'])
      for (const [x, y, z] of [...PLACED, ...NATURAL]) expect(smashAsk(read, [x, y, z], bare, natural)).toBeNull()
    }
  })

  it('without its centre Ferrovein: MISSING A BLOCK from every block', () => {
    const { w, read } = world(PLACED.filter((b) => b[3] !== FERROVEIN), NATURAL)
    const cells = [...PLACED.filter((b) => b[3] !== FERROVEIN), ...NATURAL]
    for (const bare of [true, false]) {
      expect([...fromEvery(read, cells, bare, naturalOf(w))]).toEqual(['MISSING A BLOCK | compiles true | recipe null | No Quarry Charges: a block missing.'])
    }
  })

  it('without its top Umberslate: MISSING A BLOCK from every block', () => {
    const top = PLACED.filter((b) => b[1] !== 16)
    const { w, read } = world(top, NATURAL)
    expect([...fromEvery(read, [...top, ...NATURAL], true, naturalOf(w))]).toEqual(['MISSING A BLOCK | compiles true | recipe null | No Quarry Charges: a block missing.'])
  })

  it('without its Cinderrock: MISSING A BLOCK, never plain COMPILES', () => {
    const noC = PLACED.filter((b) => b[3] !== CINDERROCK)
    const { w, read } = world(noC, NATURAL)
    expect([...fromEvery(read, [...noC, ...NATURAL], true, naturalOf(w))]).toEqual(['MISSING A BLOCK | compiles true | recipe null | No Quarry Charges: a block missing.'])
  })

  it('a Rustband where the top Umberslate goes: WRONG BLOCK; two Umberslates wrong: 2 WRONG BLOCKS', () => {
    const one = PLACED.map((b) => (b[1] === 16 ? [b[0], b[1], b[2], RUSTBAND] as B : b))
    const a = world(one, NATURAL)
    expect([...fromEvery(a.read, [...one, ...NATURAL], true, naturalOf(a.w))]).toEqual(['WRONG BLOCK | compiles true | recipe null | No Quarry Charges: a Rustband where an Umberslate goes.'])
    const two = [...one, [12, 14, 8, RUSTBAND] as B]
    const b = world(two)
    expect([...fromEvery(b.read, two, true)]).toEqual(['2 WRONG BLOCKS | compiles true | recipe null | No Quarry Charges: two Rustbands where Umberslates go.'])
  })

  it('mirrored across X (Cinderrock on -X): TURNED from every block', () => {
    const mirrored = PLACED.map((b) => [24 - b[0], b[1], b[2], b[3]] as B)
    const { read } = world([...mirrored, [12, 14, 8, UMBERSLATE]])
    expect([...fromEvery(read, [...mirrored, [12, 14, 8, UMBERSLATE]], true)]).toEqual(['TURNED | compiles true | recipe null | No Quarry Charges: turned the wrong way.'])
  })
})

describe('labels', () => {
  it('a correct Quarry Charge says QUARRY CHARGE, the T says COMPILER, any other isolated build COMPILES, ground BREAKS', () => {
    const q = blocks(QUARRY_CHARGE_RECIPE, [5, 5, 5])
    expect([...fromEvery(world(q).read, q, true)][0]).toMatch(/^QUARRY CHARGE /)
    const t = blocks(COMPILER_RECIPE, [5, 5, 5])
    expect([...fromEvery(world(t).read, t, false)][0]).toMatch(/^COMPILER /)
    const other: B[] = [[5, 5, 5, GRIDSTONE], [6, 5, 5, GRIDSTONE]]
    expect([...fromEvery(world(other).read, other, true)][0]).toMatch(/^COMPILES /)
    const floor: B[] = []
    for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) floor.push([x, 2, z, GRIDSTONE])
    const { read } = world(floor)
    expect(previewLabel(smashPreview(read, [3, 2, 3], true)!)).toBe('BREAKS 9')
  })

  it('the T on the ground: NOT AIR GAPPED from each of its blocks', () => {
    const floor: B[] = []
    for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) floor.push([x, 4, z, GRIDSTONE])
    const t = blocks(COMPILER_RECIPE, [3, 5, 4])
    const { w, read } = world(t, floor)
    const labels = new Set(t.map(([x, y, z]) => previewLabel(smashPreview(read, [x, y, z], true, naturalOf(w))!)))
    expect([...labels]).toEqual(['NOT AIR GAPPED'])
  })
})

describe('property: one build, one verdict, from every block', () => {
  it('his cells, every recipe pose with 0 to 2 blocks wrong or missing, and random builds', () => {
    let seed = 0x9e3779b9
    const rnd = (n: number): number => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return seed % n }
    const ids = [GRIDSTONE, UMBERSLATE, RUSTBAND, CINDERROCK, FERROVEIN, GLOWCORE]
    const builds: B[][] = []
    for (const recipe of [QUARRY_CHARGE_RECIPE, COMPILER_RECIPE]) for (const pose of posesOf(recipe)) {
      for (let k = 0; k < 6; k++) {
        let cells = pose.blocks.map(([x, y, z, id]) => [x + 8, y + 8, z + 8, id] as B)
        const wrong = rnd(3), missing = rnd(3)
        for (let i = 0; i < wrong; i++) { const j = rnd(cells.length); cells[j] = [cells[j][0], cells[j][1], cells[j][2], ids[rnd(ids.length)]] }
        for (let i = 0; i < missing && cells.length > 2; i++) cells = cells.filter((_, j) => j !== rnd(cells.length))
        builds.push(cells)
      }
    }
    for (let k = 0; k < 150; k++) {
      const cells: B[] = []
      const n = 2 + rnd(9)
      while (cells.length < n) {
        const c: B = [8 + rnd(3), 8 + rnd(3), 8 + rnd(3), ids[rnd(ids.length)]]
        if (!cells.some((d) => d[0] === c[0] && d[1] === c[1] && d[2] === c[2])) cells.push(c)
      }
      builds.push(cells)
    }
    let checked = 0
    for (const cells of builds) {
      const { read } = world(cells)
      // One build only: every cell in one group (a build in pieces is several builds).
      if (gather(read, [cells[0][0], cells[0][1], cells[0][2]], 3).cells.length !== cells.length) continue
      for (const bare of [true, false]) expect([...fromEvery(read, cells, bare)], JSON.stringify(cells)).toHaveLength(1)
      checked++
    }
    expect(checked).toBeGreaterThan(200)
  })
})

/** An arrangement's blocks placed with its low corner at `at`. */
function blocks(a: typeof QUARRY_CHARGE_RECIPE, at: readonly [number, number, number]): B[] {
  const out: B[] = []
  a.cells.forEach((id, i) => { if (id) { const [x, y, z] = cellAt(a.size, i); out.push([x + at[0], y + at[1], z + at[2], id]) } })
  return out
}
