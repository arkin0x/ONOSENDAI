/**
 * quarryWrongBlock.test.ts - the owner's third failed smash (smash-fail-3.mp4, 2026-11-28): a Quarry Charge
 * bare-handed, the preview said plain COMPILES, and the smash said "Compiled. No blueprint matches." His published
 * layer (kind 33339, 04:59:08Z) had the recipe exactly, at these chunk cells, and it compiles as the Quarry Charge
 * through the app's own read (TerrainWorld.blockCs, cs offsets). In the video he then mined the top Umberslate and
 * put a Rustband there: an isolated construction of the recipe's shape with one wrong block, which compiles as an
 * unknown arrangement and makes nothing. The preview must say so instead of plain COMPILES.
 */

import { describe, expect, it } from 'vitest'
import { TerrainWorld } from '../../terrain/world'
import { gather } from '../arrangement'
import { BARE_REACH, compiles } from '../smash'
import { CINDERROCK, FERROVEIN, QUARRY_CHARGE_RECIPE, RUSTBAND, UMBERSLATE, sameArrangement } from '../recipes'
import { CAUSE_WORDS, confirmWords, missCause, nearMiss, nearMissLine } from '../nearMiss'
import { previewCause, previewLine, smashPreview } from '../smashPreview'

const ORIGIN = { x: 0n, y: 0n, z: 0n, plane: 1 } as never
const AXES = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } } as never

/** His build as published at 04:59:08Z, in chunk cells (x, y, z), the chunk's other cells open air. */
const HIS_BUILD: ReadonlyArray<readonly [number, number, number, number]> = [
  [6, 24, 28, UMBERSLATE],
  [6, 25, 27, RUSTBAND],
  [5, 25, 28, RUSTBAND],
  [6, 25, 28, FERROVEIN],
  [7, 25, 28, CINDERROCK],
  [6, 25, 29, RUSTBAND],
  [6, 26, 28, UMBERSLATE],
]

function worldWith(cells: ReadonlyArray<readonly [number, number, number, number]>): TerrainWorld {
  const w = new TerrainWorld(ORIGIN, AXES)
  const s = w.slotAt(0, 0, 0, true)!
  w.setBlocks(s.key, new Uint8Array(32768), new Uint8Array(32768))
  for (const [x, y, z, id] of cells) expect(w.setCs(x, y, z, id)).not.toBeNull()
  return w
}

describe("the owner's Quarry Charge, through the app's read", () => {
  it('as published: the Quarry Charge, bare-handed, from every block, no warning', () => {
    const w = worldWith(HIS_BUILD)
    const read = (x: number, y: number, z: number): number => w.blockCs(x, y, z)
    for (const [x, y, z] of HIS_BUILD) {
      const g = gather(read, [x, y, z], BARE_REACH)
      expect(sameArrangement(g.arrangement!, QUARRY_CHARGE_RECIPE), `${x},${y},${z}`).toBe(true)
      const p = smashPreview(read, [x, y, z], true)!
      expect(previewLine(p.state, p.cells.length, previewCause(p))).toBe('COMPILES')
    }
  })

  it('a Rustband where the top Umberslate goes: compiles as another shape, and the preview and the line say a block is wrong', () => {
    const w = worldWith(HIS_BUILD.map(([x, y, z, id]) => (y === 26 ? [x, y, z, RUSTBAND] as const : [x, y, z, id] as const)))
    const read = (x: number, y: number, z: number): number => w.blockCs(x, y, z)
    for (const [x, y, z] of HIS_BUILD) {
      const g = gather(read, [x, y, z], BARE_REACH)
      expect(compiles(g.arrangement)).toBe(true)
      expect(sameArrangement(g.arrangement!, QUARRY_CHARGE_RECIPE)).toBe(false)
      const m = nearMiss(read, [x, y, z])
      expect(m, `${x},${y},${z}`).not.toBeNull()
      expect(m!.recipe).toBe('quarry')
      expect(m!.wrong).toEqual([{ is: RUSTBAND, should: UMBERSLATE }])
      expect(missCause(m!)).toBe('wrong')
      const p = smashPreview(read, [x, y, z], true)!
      expect(previewLine(p.state, p.cells.length, previewCause(p))).toBe(`COMPILES · ${CAUSE_WORDS.wrong}`)
    }
    const m = nearMiss(read, [6, 25, 28])!
    expect(nearMissLine(m)).toBe('That was nearly the Quarry Charge, but a Rustband was where an Umberslate goes. Build it as the card shows.')
    expect(confirmWords(7, ['Cinderrock'], m, true)).toBe("This is nearly the Quarry Charge, but a Rustband is where an Umberslate goes, so it won't make Quarry Charges. Build it as the card shows. Smashing breaks 7 blocks, including placed Cinderrock. Smash anyway?")
  })

  it('more than two wrong blocks is not called a near miss of the Quarry Charge', () => {
    const w = worldWith(HIS_BUILD.map(([x, y, z, id]) => (id === RUSTBAND ? [x, y, z, UMBERSLATE] as const : [x, y, z, id] as const)))
    expect(nearMiss((x, y, z) => w.blockCs(x, y, z), [6, 25, 28])).toBeNull()
  })

  it("the Compiler's T with a wrong head block is a near miss too, one block at most", () => {
    const T = [[1, 0, 0, FERROVEIN], [1, 1, 0, FERROVEIN], [0, 2, 0, RUSTBAND], [1, 2, 0, UMBERSLATE], [2, 2, 0, RUSTBAND]] as const
    const w = worldWith(T.map(([x, y, z, id]) => [x + 10, y + 10, z + 10, id] as const))
    const m = nearMiss((x, y, z) => w.blockCs(x, y, z), [11, 11, 10])!
    expect(m.recipe).toBe('compiler')
    expect(m.wrong.length).toBe(1)
    const w2 = worldWith(T.map(([x, y, z, id]) => [x + 10, y + 10, z + 10, id === RUSTBAND ? UMBERSLATE : id] as const))
    expect(nearMiss((x, y, z) => w2.blockCs(x, y, z), [11, 11, 10])).toBeNull()
  })
})
