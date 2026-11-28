/**
 * smashPreview.test.ts - the smash preview (owner, 2026-11-27: "while you
 * hold the compiler, the blocks that will be destroyed/included should pulse
 * a highlight"): the set is exactly what the smash deletes, its colour and
 * line say whether it compiles, it is worked out again only when what it
 * depends on changes, and it holds still with reduced motion.
 */

import { describe, expect, it } from 'vitest'
import { smashGroup, COMPILER_REACH, BARE_REACH, MISS_LINE, NO_MATCH_LINE, OFFLINE_LINE, UNKNOWN_LINE, missLine } from '../smash'
import { FERROVEIN, GLOWCORE, GRIDSTONE, RUSTBAND } from '../recipes'
import { gather, smashCells } from '../arrangement'
import {
  PREVIEW_BREAKS, PREVIEW_COMPILES, PREVIEW_DEBOUNCE_MS, PULSE_FULL_MS, PULSE_HIGH, PULSE_LOW, PULSE_MS, PULSE_STEADY, PreviewTracker, advancePhase, packCell,
  inSet, previewColor, previewLine, pulseOpacity, pulsePeriod, outerFaces, showPreview, smashPreview, useSmashPreview, type Preview, type PreviewAim,
} from '../smashPreview'

type Read = (x: number, y: number, z: number) => number
const key = (c: readonly number[]): string => c.join(',')
const sorted = (cells: ReadonlyArray<readonly number[]>): string[] => cells.map(key).sort()

/** The T hammer (recipes.ts COMPILER_RECIPE) at `at`, standing alone. */
function hammer(at: readonly [number, number, number] = [0, 0, 0]): Map<string, number> {
  const m = new Map<string, number>()
  for (const [x, y, z, id] of [[1, 0, 0, FERROVEIN], [1, 1, 0, FERROVEIN], [0, 2, 0, RUSTBAND], [1, 2, 0, GLOWCORE], [2, 2, 0, RUSTBAND]] as const) m.set(key([x + at[0], y + at[1], z + at[2]]), id)
  return m
}
const reader = (m: Map<string, number>, under?: Read): Read => (x, y, z) => m.get(key([x, y, z])) ?? under?.(x, y, z) ?? 0
/** Ground: everything at y < 0, far wider than any reach. */
const ground: Read = (_x, y) => (y < 0 ? GRIDSTONE : 0)
const HAMMER_CELLS = [[1, 0, 0], [1, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0]] as const

describe('the preview set is the smash set', () => {
  it('the T hammer struck at any of its blocks: all five, COMPILES, with the Compiler and bare-handed', () => {
    const read = reader(hammer([10, 4, -3]))
    for (const bare of [false, true]) for (const c of HAMMER_CELLS) {
      const hit = [c[0] + 10, c[1] + 4, c[2] - 3] as const
      const p = smashPreview(read, hit, bare)!
      expect(sorted(p.cells), `${hit} bare ${bare}`).toEqual(sorted(smashGroup(read, hit, bare).smash))
      expect(p.cells).toHaveLength(5)
      expect(p.state).toBe('compiles')
    }
  })

  it('ground: BREAKS, capped at the reach box round the hit (16 with the Compiler, 3 bare)', () => {
    const hit = [5, -1, 7] as const
    const p = smashPreview(ground, hit, false)!
    expect(sorted(p.cells)).toEqual(sorted(smashGroup(ground, hit, false).smash))
    expect(p.state).toBe('breaks')
    // The box: hit - 8 to hit + 7 on each axis; the ground fills it from y - 8 up to the hit's own layer, 9 layers.
    expect(p.cells).toHaveLength(COMPILER_REACH * COMPILER_REACH * 9)
    for (const [x, y, z] of p.cells) {
      expect(x >= hit[0] - 8 && x <= hit[0] + 7 && z >= hit[2] - 8 && z <= hit[2] + 7 && y >= hit[1] - 8 && y <= hit[1]).toBe(true)
    }
    const b = smashPreview(ground, hit, true)!
    expect(sorted(b.cells)).toEqual(sorted(smashGroup(ground, hit, true).smash))
    expect(b.state).toBe('breaks')
    expect(b.cells).toHaveLength(BARE_REACH * BARE_REACH * 2)
  })

  it('a hammer standing on the ground is not a construction: it breaks, and the set is the smash\'s', () => {
    const read = reader(hammer([0, 0, 0]), ground)
    const p = smashPreview(read, [1, 2, 0], false)!
    expect(p.state).toBe('breaks')
    expect(sorted(p.cells)).toEqual(sorted(smashGroup(read, [1, 2, 0], false).smash))
  })

  it('bare-handed, a build other than the recipe is taken whole and compiles, as with the Compiler (owner, 2026-11-28)', () => {
    const pair = reader(new Map([['0,0,0', GRIDSTONE], ['1,0,0', GRIDSTONE]]))
    const bare = smashPreview(pair, [0, 0, 0], true)!
    expect(sorted(bare.cells)).toEqual(sorted(smashGroup(pair, [0, 0, 0], true).smash))
    expect(bare.cells).toHaveLength(2)
    expect(bare.state).toBe('compiles')
    expect(smashPreview(pair, [0, 0, 0], false)!.state).toBe('compiles')
  })

  it('a too-long row with the Compiler: breaks, 16 of it', () => {
    const row: Read = (x, y, z) => (y === 0 && z === 0 && x >= 0 && x < 17 ? GRIDSTONE : 0)
    const p = smashPreview(row, [8, 0, 0], false)!
    expect(p.state).toBe('breaks')
    expect(p.cells).toHaveLength(16)
    expect(previewLine(p.state, p.cells.length)).toBe('BREAKS 16')
  })

  it('a reach of 0 or 1 takes the struck block alone, and never throws (review of #948)', () => {
    for (const n of [0, 1]) {
      const g = gather(ground, [0, -1, 0], n)
      expect(g.cells).toEqual([[0, -1, 0]])
      expect(smashCells(ground, [0, -1, 0], n, g)).toEqual([[0, -1, 0]])
    }
    const lone: Read = (x, y, z) => (x === 0 && y === 0 && z === 0 ? GRIDSTONE : 0)
    expect(gather(lone, [0, 0, 0], 0).isolated).toBe(true)
  })

  it('open space: nothing to preview', () => {
    expect(smashPreview(ground, [0, 3, 0], false)).toBeNull()
  })
})

describe('colour and line', () => {
  it('mint for COMPILES, the Compiler orange for BREAKS N', () => {
    expect(previewColor('compiles')).toBe(PREVIEW_COMPILES)
    expect(PREVIEW_COMPILES).toBe('#7cffc4')
    expect(previewColor('breaks')).toBe(PREVIEW_BREAKS)
    expect(PREVIEW_BREAKS).toBe('#f47000')
    expect(previewLine('compiles', 5)).toBe('COMPILES')
    expect(previewLine('breaks', 27)).toBe('BREAKS 27')
  })

  it('the HUD hears only changes', () => {
    let heard = 0
    const stop = useSmashPreview.subscribe(() => { heard++ })
    const p = smashPreview(reader(hammer()), [1, 0, 0], false)
    showPreview(p)
    showPreview(p)
    showPreview(p)
    expect(useSmashPreview.getState()).toEqual({ state: 'compiles', count: 5, cause: null })
    showPreview(null)
    showPreview(null)
    expect(useSmashPreview.getState().state).toBeNull()
    expect(heard).toBe(2)
    stop()
  })
})

describe('the line a smash with no prize leaves agrees with the preview', () => {
  it('COMPILES and no blueprint matches: "No blueprint matches."; BREAKS: "Nothing compiled."', () => {
    const hammerRead = reader(hammer())
    const valid = smashPreview(hammerRead, [1, 0, 0], false)!
    expect(valid.state).toBe('compiles')
    expect(missLine(valid.state === 'compiles', false, false)).toBe(NO_MATCH_LINE)
    expect(NO_MATCH_LINE).toBe('No blueprint matches.')
    const broken = smashPreview(ground, [0, -1, 0], false)!
    expect(missLine(broken.state === 'compiles', false, false)).toBe(MISS_LINE)
    // Bare-handed, a build other than the recipe compiles too (owner, 2026-11-28), so a silent relay is said.
    const pair = smashPreview(reader(new Map([['0,0,0', GRIDSTONE], ['1,0,0', GRIDSTONE]])), [0, 0, 0], true)!
    expect(missLine(pair.state === 'compiles', true, false)).toBe(OFFLINE_LINE)
    // Compiled, with no relay answering or a prize this version cannot open: those say so.
    expect(missLine(true, true, false)).toBe(OFFLINE_LINE)
    expect(missLine(true, false, true)).toBe(UNKNOWN_LINE)
    for (const l of [NO_MATCH_LINE, OFFLINE_LINE]) expect(l).not.toMatch(/Nothing compiled/)
  })
})

describe('the pulse', () => {
  it('a gentle 1.2 s pulse at rest, between its low and high', () => {
    expect(pulsePeriod(0)).toBe(PULSE_MS)
    expect(PULSE_MS).toBe(1200)
    expect(pulseOpacity(0, false)).toBeCloseTo(PULSE_LOW)
    expect(pulseOpacity(0.5, false)).toBeCloseTo(PULSE_HIGH)
    // Half a period at rest takes the phase from the low to the high.
    expect(advancePhase(0, PULSE_MS / 2, 0)).toBeCloseTo(0.5)
    expect(advancePhase(0.75, PULSE_MS / 2, 0)).toBeCloseTo(0.25)
  })

  it('quickens with the hold\'s charge, without a jump in phase', () => {
    expect(pulsePeriod(1)).toBe(PULSE_FULL_MS)
    expect(pulsePeriod(0.5)).toBeLessThan(PULSE_MS)
    expect(pulsePeriod(0.5)).toBeGreaterThan(PULSE_FULL_MS)
    expect(pulsePeriod(2)).toBe(PULSE_FULL_MS)
    const p = advancePhase(0.2, 10, 1)
    expect(p - 0.2).toBeCloseTo(10 / PULSE_FULL_MS)
  })

  it('reduced motion: a steady highlight at any phase and charge', () => {
    for (const ph of [0, 0.13, 0.5, 0.9]) expect(pulseOpacity(ph, true)).toBe(PULSE_STEADY)
  })
})

describe('the outer faces', () => {
  it('one block: six faces; two side by side: ten (the face between them is not drawn)', () => {
    const one = [[0, 0, 0]] as const
    expect(outerFaces(one, new Set([packCell(0, 0, 0)])).length).toBe(6 * 18)
    const two = [[0, 0, 0], [1, 0, 0]] as const
    expect(outerFaces(two, new Set(two.map((c) => packCell(c[0], c[1], c[2])))).length).toBe(10 * 18)
  })

  it('a 16 by 16 by 16 set is its outside only: 6 by 256 faces, one array', () => {
    const cells: Array<[number, number, number]> = []
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) cells.push([x, y, z])
    const pos = outerFaces(cells, new Set(cells.map((c) => packCell(c[0], c[1], c[2]))))
    expect(pos.length).toBe(6 * 256 * 18)
    // Every vertex on the box's skin, a hair off it.
    for (let i = 0; i < pos.length; i += 3) {
      const out = [pos[i], pos[i + 1], pos[i + 2]].some((v) => v < 0 || v > 16)
      expect(out).toBe(true)
    }
  })

  it('packed offsets differ for every cell a smash can reach, either side of the block struck', () => {
    const seen = new Set<number>()
    for (let x = -16; x <= 16; x++) for (let y = -16; y <= 16; y++) for (let z = -16; z <= 16; z++) seen.add(packCell(x, y, z))
    expect(seen.size).toBe(33 ** 3)
  })

  it('far out in a field (past 2^19 on an axis), neighbours stay apart and the faces are whole', () => {
    const far = 1 << 29
    const read: Read = (x, y, z) => (y === far && z === -far && (x === far || x === far + 1) ? GRIDSTONE : 0)
    const p = smashPreview(read, [far, far, -far], false)!
    expect(p.cells).toHaveLength(2)
    expect(inSet(p, far + 1, far, -far)).toBe(true)
    expect(inSet(p, far + 2, far, -far)).toBe(false)
    expect(inSet(p, far + 131072, far, -far)).toBe(false)
    expect(outerFaces(p.cells, p.keys, p.hit).length).toBe(10 * 18)
  })
})

describe('worked out only on change', () => {
  const field = {}
  const aimAt = (x: number, y: number, z: number, bare = false, version = 1, f: object = field): PreviewAim => ({ field: f, x, y, z, bare, version })
  const read = reader(hammer(), ground)
  const make = (): PreviewTracker => new PreviewTracker((a) => smashPreview(read, [a.x, a.y, a.z], a.bare))

  it('a resting aim is worked out once, after the debounce, and never again frame by frame', () => {
    const t = make()
    expect(t.step(aimAt(1, 2, 0), 0)).toBeNull()
    expect(t.computed).toBe(0)
    expect(t.step(aimAt(1, 2, 0), PREVIEW_DEBOUNCE_MS - 1)).toBeNull()
    const p = t.step(aimAt(1, 2, 0), PREVIEW_DEBOUNCE_MS)
    expect(p).not.toBeNull()
    for (let f = 0; f < 600; f++) expect(t.step(aimAt(1, 2, 0), PREVIEW_DEBOUNCE_MS + f * 16)).toBe(p)
    expect(t.computed).toBe(1)
  })

  it('again when the cell, the hand or the blocks change, each after the aim rests', () => {
    const t = make()
    t.step(aimAt(1, 2, 0), 0); t.step(aimAt(1, 2, 0), 100)
    expect(t.computed).toBe(1)
    // A sweep across the ground: nothing worked out until it rests.
    for (let x = 0; x < 10; x++) t.step(aimAt(x, -1, 0), 200 + x * 16)
    expect(t.computed).toBe(1)
    t.step(aimAt(9, -1, 0), 200 + 9 * 16 + PREVIEW_DEBOUNCE_MS)
    expect(t.computed).toBe(2)
    t.step(aimAt(9, -1, 0, true), 1000); t.step(aimAt(9, -1, 0, true), 1000 + PREVIEW_DEBOUNCE_MS)
    expect(t.computed).toBe(3)
    t.step(aimAt(9, -1, 0, true, 2), 2000); t.step(aimAt(9, -1, 0, true, 2), 2000 + PREVIEW_DEBOUNCE_MS)
    expect(t.computed).toBe(4)
    const other = {}
    t.step(aimAt(9, -1, 0, true, 2, other), 3000); t.step(aimAt(9, -1, 0, true, 2, other), 3000 + PREVIEW_DEBOUNCE_MS)
    expect(t.computed).toBe(5)
  })

  it('while a new aim waits, the old set stays only if the new cell is in it', () => {
    const t = make()
    t.step(aimAt(1, 0, 0), 0)
    const p = t.step(aimAt(1, 0, 0), 100) as Preview
    expect(p.state).toBe('breaks')
    // Another block of the same set: the old set stays while it waits.
    expect(t.step(aimAt(1, 1, 0), 150)).toBe(p)
    // A block outside it: nothing, rather than a set on blocks it does not hold.
    expect(t.step(aimAt(40, -1, 40), 160)).toBeNull()
    // The blocks changed: the old set is not kept while the new one waits, even on a cell it held.
    const u = make()
    u.step(aimAt(1, 0, 0), 0)
    u.step(aimAt(1, 0, 0), 100)
    expect(u.step(aimAt(1, 1, 0, false, 2), 150)).toBeNull()
  })

  it('nothing aimed: gone at once, and worked out afresh after', () => {
    const t = make()
    t.step(aimAt(1, 2, 0), 0); t.step(aimAt(1, 2, 0), 100)
    expect(t.step(null, 116)).toBeNull()
    expect(t.step(aimAt(1, 2, 0), 132)).toBeNull()
    expect(t.step(aimAt(1, 2, 0), 132 + PREVIEW_DEBOUNCE_MS)).not.toBeNull()
    expect(t.computed).toBe(2)
  })
})
