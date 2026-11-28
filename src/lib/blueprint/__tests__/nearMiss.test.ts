/**
 * nearMiss.test.ts - a game recipe built right but smashed wrong (owner's
 * lost Glowcore, 2026-11-28: a correct Compiler T whose handle rested on the
 * floor, smashed bare-handed: BREAKS 5 and nothing said why). The preview now
 * says why in the warning red, the line after the smash says how to build
 * it, and the confirm asks before rare materials go.
 */

import { describe, expect, it } from 'vitest'
import { smashGroup, compiles, BARE_REACH } from '../smash'
import { PREVIEW_BREAKS, PREVIEW_NEAR_MISS, previewColor, previewLine, showPreview, smashPreview, useSmashPreview } from '../smashPreview'
import { CAUSE_WORDS, confirmWords, missCause, nearMiss, nearMissLine, posesOf, rareLost, type NearMiss } from '../nearMiss'
import { smashAsk } from '../smashConfirm'
import { CINDERROCK, COMPILER_RECIPE, FERROVEIN, GLOWCORE, GRIDSTONE, QUARRY_CHARGE_RECIPE, RUSTBAND, UMBERSLATE } from '../recipes'

type Read = (x: number, y: number, z: number) => number
const key = (c: readonly number[]): string => c.join(',')

/** The Compiler's T at `at`: the head along X (right), or along Z (turned a quarter about Y). */
function t(at: readonly [number, number, number], alongZ = false): Map<string, number> {
  const m = new Map<string, number>()
  for (const [a, y, id] of [[1, 0, FERROVEIN], [1, 1, FERROVEIN], [0, 2, RUSTBAND], [1, 2, GLOWCORE], [2, 2, RUSTBAND]] as const) {
    m.set(key(alongZ ? [at[0], at[1] + y, at[2] + a] : [at[0] + a, at[1] + y, at[2]]), id)
  }
  return m
}
/** The Quarry Charge's cross at `at`, the Cinderrock on +X, or on -X when mirrored. */
function quarry(at: readonly [number, number, number], mirrored = false): Map<string, number> {
  const m = new Map<string, number>()
  for (const [x, y, z, id] of [[1, 0, 1, UMBERSLATE], [1, 1, 0, RUSTBAND], [0, 1, 1, RUSTBAND], [1, 1, 1, FERROVEIN], [2, 1, 1, CINDERROCK], [1, 1, 2, RUSTBAND], [1, 2, 1, UMBERSLATE]] as const) {
    const mx = mirrored ? 2 - x : x
    m.set(key([at[0] + mx, at[1] + y, at[2] + z]), id)
  }
  return m
}
/** The floor he built on: ground at y < 0, far wider than any reach. */
const ground: Read = (_x, y) => (y < 0 ? GRIDSTONE : 0)
const reader = (m: Map<string, number>, under?: Read): Read => (x, y, z) => m.get(key([x, y, z])) ?? under?.(x, y, z) ?? 0
const FORBIDDEN = /stand-alone|standalone|stand alone|\bstands?\b|\bstanding\b|—|–/i

describe("the owner's build: a correct T resting on the floor", () => {
  const read = reader(t([0, 0, 0]), ground)
  const hit = [1, 1, 0] as const // the upper Ferrovein, where he struck

  it('is not isolated, so it only breaks; the preview says BREAKS 5 · TOUCHING THE GROUND in the warning red', () => {
    const g = smashGroup(read, hit, true)
    expect(g.isolated).toBe(false)
    expect(g.smash).toHaveLength(5)
    const p = smashPreview(read, hit, true)!
    expect(p.state).toBe('breaks')
    expect(p.miss).toMatchObject({ recipe: 'compiler', touching: 'ground', turned: false, needsCompiler: false })
    const cause = missCause(p.miss!)
    expect(previewLine(p.state, p.cells.length, cause)).toBe('BREAKS 5 · TOUCHING THE GROUND')
    expect(previewColor(p.state, cause)).toBe(PREVIEW_NEAR_MISS)
    expect(PREVIEW_NEAR_MISS).not.toBe(PREVIEW_BREAKS)
    // The HUD's line hears the cause.
    showPreview(p)
    expect(useSmashPreview.getState()).toEqual({ state: 'breaks', count: 5, cause: 'ground' })
    showPreview(null)
    expect(useSmashPreview.getState()).toEqual({ state: null, count: 0, cause: null })
  })

  it('struck at any of its five blocks: the same near miss', () => {
    for (const h of [[1, 0, 0], [1, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0]] as const) {
      expect(nearMiss(read, h, true)?.touching, `${h}`).toBe('ground')
    }
  })

  it('with the Compiler in hand too (it compiles nothing either way while it touches)', () => {
    const p = smashPreview(read, hit, false)!
    expect(p.state).toBe('breaks')
    expect(missCause(p.miss!)).toBe('ground')
  })

  it('the line after the smash says what it was and how to build it', () => {
    expect(nearMissLine(nearMiss(read, hit, true)!)).toBe('That was the Compiler, but it touched the ground. Build it with a gap all round.')
  })

  it('the confirm names the Glowcore and the cause', () => {
    const ask = smashAsk(read, hit, true)!
    expect(ask.count).toBe(5)
    expect(ask.rare).toEqual(['Glowcore'])
    expect(ask.words).toBe('This is the Compiler, but it is touching the ground, so it won\'t compile. Build it with a gap all round. Smashing breaks 5 blocks, including your Glowcore. Smash anyway?')
  })
})

describe('other near misses', () => {
  it('a block touching it at a corner, in open air: TOUCHING A BLOCK', () => {
    const m = t([0, 5, 0])
    m.set(key([3, 8, 1]), GRIDSTONE) // diagonal to the right Rustband at (2, 7, 0)
    const read = reader(m)
    const p = smashPreview(read, [1, 6, 0], true)!
    expect(p.state).toBe('breaks')
    // The block is outside the bare hand's box round the hit, so only the T's five go.
    expect(previewLine(p.state, p.cells.length, missCause(p.miss!))).toBe('BREAKS 5 · TOUCHING A BLOCK')
    expect(nearMissLine(p.miss!)).toBe('That was the Compiler, but it touched another block. Build it with a gap all round.')
  })

  it('a block in the T\'s empty corner touches it too', () => {
    const m = t([0, 5, 0])
    m.set(key([0, 5, 0]), GRIDSTONE)
    expect(nearMiss(reader(m), [1, 6, 0], true)?.touching).toBe('block')
  })

  it('a block beside it that is natural ground: TOUCHING THE GROUND, when the world can tell', () => {
    const m = t([0, 5, 0])
    m.set(key([3, 6, 0]), GRIDSTONE)
    const natural = (x: number, y: number, z: number): boolean => key([x, y, z]) === '3,6,0'
    expect(nearMiss(reader(m), [1, 6, 0], true)?.touching).toBe('block')
    expect(nearMiss(reader(m), [1, 6, 0], true, natural)?.touching).toBe('ground')
  })

  it('lifted, the head along Z: TURNED THE WRONG WAY (bare-handed only the right way round compiles)', () => {
    const read = reader(t([0, 1, 0], true), ground)
    const p = smashPreview(read, [0, 3, 1], true)!
    expect(p.state).toBe('breaks')
    expect(p.miss).toMatchObject({ recipe: 'compiler', turned: true, touching: null })
    expect(previewLine(p.state, 5, missCause(p.miss!))).toBe('BREAKS 5 · TURNED THE WRONG WAY')
    expect(nearMissLine(p.miss!)).toBe('That was the Compiler, but it was turned the wrong way. Build it as the card shows.')
  })

  it('upside down and on the floor: turned and touching, both said after', () => {
    const m = new Map<string, number>()
    for (const [x, y, id] of [[1, 2, FERROVEIN], [1, 1, FERROVEIN], [0, 0, RUSTBAND], [1, 0, GLOWCORE], [2, 0, RUSTBAND]] as const) m.set(key([x, y, 0]), id)
    const miss = nearMiss(reader(m, ground), [1, 1, 0], true)!
    expect(missCause(miss)).toBe('turned')
    expect(nearMissLine(miss)).toBe('That was the Compiler, but it was turned the wrong way and it touched the ground. Build it as the card shows, with a gap all round.')
  })

  it('the Quarry Charge, isolated, bare-handed: NEEDS THE COMPILER; with the Compiler it compiles and is no miss', () => {
    const read = reader(quarry([0, 1, 0]), ground)
    const bare = smashPreview(read, [1, 2, 1], true)!
    expect(bare.state).toBe('breaks')
    expect(previewLine('breaks', 7, missCause(bare.miss!))).toBe('BREAKS 7 · NEEDS THE COMPILER')
    expect(nearMissLine(bare.miss!)).toBe('That was the Quarry Charge, but it needs the Compiler in hand.')
    const held = smashPreview(read, [1, 2, 1], false)!
    expect(held.state).toBe('compiles')
    expect(held.miss).toBeNull()
    expect(nearMiss(read, [1, 2, 1], false)).toBeNull()
  })

  it('the Quarry Charge on the floor: TOUCHING THE GROUND, with the Compiler in hand', () => {
    const read = reader(quarry([0, 0, 0]), ground)
    expect(missCause(smashPreview(read, [1, 1, 1], false)!.miss!)).toBe('ground')
  })

  it('the Quarry Charge mirrored across X is turned (bare); mirrored across Y or Z it is the same recipe', () => {
    const read = reader(quarry([0, 1, 0], true), ground)
    expect(nearMiss(read, [1, 2, 1], true)?.turned).toBe(true)
    const poses = posesOf(QUARRY_CHARGE_RECIPE)
    expect(poses.filter((p) => !p.turned)).toHaveLength(1)
    expect(posesOf(COMPILER_RECIPE).filter((p) => !p.turned)).toHaveLength(1)
  })
})

describe('no near miss where there is none', () => {
  it('the lifted T compiles, bare-handed and with the Compiler: no miss and no confirm', () => {
    const read = reader(t([0, 1, 0]), ground)
    for (const bare of [true, false]) {
      const g = smashGroup(read, [1, 3, 0], bare)
      expect(compiles(g.arrangement, bare)).toBe(true)
      const p = smashPreview(read, [1, 3, 0], bare)!
      expect(p.state).toBe('compiles')
      expect(p.miss).toBeNull()
      expect(previewLine(p.state, 5, null)).toBe('COMPILES')
      expect(smashAsk(read, [1, 3, 0], bare)).toBeNull()
    }
    expect(BARE_REACH).toBe(3)
  })

  it('plain ground: BREAKS with no cause and no confirm (nothing rare in it)', () => {
    const p = smashPreview(ground, [0, -1, 0], false)!
    expect(p.miss).toBeNull()
    expect(previewLine(p.state, 4, null)).toBe('BREAKS 4')
    expect(previewColor(p.state, null)).toBe(PREVIEW_BREAKS)
    expect(smashAsk(ground, [0, -1, 0], true)).toBeNull()
  })

  it('an incomplete T on the floor is no recipe (only the full arrangement counts)', () => {
    const m = t([0, 0, 0])
    m.delete(key([0, 2, 0]))
    expect(nearMiss(reader(m, ground), [1, 1, 0], true)).toBeNull()
  })
})

describe('the confirm before rare materials go', () => {
  it('a Glowcore in a heap of rock asks, with no recipe in it', () => {
    const m = new Map<string, number>([[key([0, 0, 0]), GLOWCORE]])
    const ask = smashAsk(reader(m, ground), [0, 0, 0], true)!
    expect(ask.miss).toBeNull()
    expect(ask.words).toBe(`This won't compile. It breaks ${ask.count} blocks, including your Glowcore. Smash anyway?`)
  })

  it('names each rare kind once: the rare band, Glowcore and Cinderrock', () => {
    expect(rareLost([GLOWCORE, GLOWCORE, CINDERROCK, GRIDSTONE, 197])).toEqual(['Glowcore', 'Cinderrock', expect.any(String)])
    expect(rareLost([GRIDSTONE, RUSTBAND, FERROVEIN])).toEqual([])
    expect(confirmWords(1, ['Glowcore', 'Cinderrock'], null)).toBe("This won't compile. It breaks 1 block, including your Glowcore and Cinderrock. Smash anyway?")
  })
})

describe('the words keep the owner\'s rule', () => {
  it('no word for upright posture and no long dash, in every line a near miss or a confirm can say', () => {
    const lines: string[] = [...Object.values(CAUSE_WORDS)]
    for (const recipe of ['compiler', 'quarry'] as const) for (const turned of [false, true]) for (const touching of [null, 'ground', 'block'] as const) for (const needsCompiler of [false, true]) {
      if (!turned && !touching && !needsCompiler) continue
      const m: NearMiss = { recipe, name: recipe === 'compiler' ? 'the Compiler' : 'the Quarry Charge', turned, touching, needsCompiler }
      lines.push(nearMissLine(m), confirmWords(5, ['Glowcore'], m))
    }
    lines.push(confirmWords(3, ['Glowcore'], null))
    for (const l of lines) expect(l, l).not.toMatch(FORBIDDEN)
  })
})
