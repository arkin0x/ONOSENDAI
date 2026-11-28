/**
 * nearMiss.test.ts - a game recipe built right but smashed wrong (owner's
 * lost Glowcore, 2026-11-28: a correct Compiler T whose handle rested on the
 * floor, smashed bare-handed: BREAKS 5 and nothing said why). The preview now
 * says why in the warning red, the line after the smash says how to build
 * it, and the confirm asks before rare materials go.
 */

import { describe, expect, it } from 'vitest'
import { smashGroup, compiles, BARE_REACH } from '../smash'
import { PREVIEW_BREAKS, PREVIEW_NEAR_MISS, previewCause, previewColor, previewLine, showPreview, smashPreview, useSmashPreview } from '../smashPreview'
import { CAUSE_WORDS, TOO_BIG_LINE, confirmWords, missCause, nearMiss, nearMissLine, posesOf, rareLost, tooBigBare, type NearMiss } from '../nearMiss'
import { gather } from '../arrangement'
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
/** That ground is natural (TERRAIN's generated blocks, unchanged); anything in a map was placed. */
const nat = (_x: number, y: number): boolean => y < 0
const FORBIDDEN = /stand-alone|standalone|stand alone|\bstands?\b|\bstanding\b|—|–/i

describe("the owner's build: a correct T resting on the floor", () => {
  const read = reader(t([0, 0, 0]), ground)
  const hit = [1, 1, 0] as const // the upper Ferrovein, where he struck

  it('is not isolated, so it only breaks; the preview says BREAKS 5 · TOUCHING THE GROUND in the warning red', () => {
    const g = smashGroup(read, hit, true)
    expect(g.isolated).toBe(false)
    expect(g.smash).toHaveLength(5)
    const p = smashPreview(read, hit, true, nat)!
    expect(p.state).toBe('breaks')
    expect(p.miss).toMatchObject({ recipe: 'compiler', touching: 'ground', turned: false })
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
      expect(nearMiss(read, h, nat)?.touching, `${h}`).toBe('ground')
    }
  })

  it('with the Compiler in hand too (it compiles nothing either way while it touches)', () => {
    const p = smashPreview(read, hit, false, nat)!
    expect(p.state).toBe('breaks')
    expect(missCause(p.miss!)).toBe('ground')
  })

  it('the line after the smash says what it was and how to build it', () => {
    expect(nearMissLine(nearMiss(read, hit, nat)!)).toBe('That was the Compiler, but it touched the ground. Build it with a gap all round.')
  })

  it('where the world cannot tell natural ground, the floor counts as part of the build: no near miss', () => {
    expect(nearMiss(read, hit)).toBeNull()
  })

  it('the confirm names the Glowcore and the cause', () => {
    const ask = smashAsk(read, hit, true, nat)!
    expect(ask.count).toBe(5)
    expect(ask.rare).toEqual(['Glowcore'])
    expect(ask.words).toBe('This is the Compiler, but it is touching the ground, so it won\'t compile. Build it with a gap all round. Smashing breaks 5 blocks, including placed Glowcore. Smash anyway?')
  })
})

describe('other near misses', () => {
  it('a placed block touching it at a corner makes a bigger build, never a near miss (only the recipe\'s blocks count)', () => {
    const m = t([0, 5, 0])
    m.set(key([3, 8, 1]), GRIDSTONE) // corner to the right Rustband at (2, 7, 0)
    const read = reader(m)
    expect(nearMiss(read, [1, 6, 0])).toBeNull()
    const p = smashPreview(read, [1, 6, 0], true)!
    expect(p.miss).toBeNull()
    // Six blocks, four wide: too big for a bare hand, said as that.
    expect(previewLine(p.state, p.cells.length, previewCause(p))).toBe('BREAKS 5 · TOO BIG FOR A BARE HAND')
  })

  it('a placed block in the T\'s empty corner: a bigger build, no near miss', () => {
    const m = t([0, 5, 0])
    m.set(key([0, 5, 0]), GRIDSTONE)
    expect(nearMiss(reader(m), [1, 6, 0])).toBeNull()
  })

  it('a block beside it that is natural ground: TOUCHING THE GROUND, when the world can tell (else it counts as built)', () => {
    const m = t([0, 5, 0])
    m.set(key([3, 6, 0]), GRIDSTONE)
    const natural = (x: number, y: number, z: number): boolean => key([x, y, z]) === '3,6,0'
    expect(nearMiss(reader(m), [1, 6, 0])).toBeNull()
    expect(nearMiss(reader(m), [1, 6, 0], natural)?.touching).toBe('ground')
  })

  it('lifted, the head along Z, bare-handed: it compiles as another shape, so COMPILES · TURNED THE WRONG WAY', () => {
    const read = reader(t([0, 1, 0], true), ground)
    const p = smashPreview(read, [0, 3, 1], true)!
    expect(p.state).toBe('compiles')
    expect(p.miss).toMatchObject({ recipe: 'compiler', turned: true, touching: null })
    expect(previewLine(p.state, 5, missCause(p.miss!))).toBe('COMPILES · TURNED THE WRONG WAY')
    expect(nearMissLine(p.miss!)).toBe('That was the Compiler, but it was turned the wrong way. Build it as the card shows.')
  })

  it('upside down and on the floor: turned and touching, both said after', () => {
    const m = new Map<string, number>()
    for (const [x, y, id] of [[1, 2, FERROVEIN], [1, 1, FERROVEIN], [0, 0, RUSTBAND], [1, 0, GLOWCORE], [2, 0, RUSTBAND]] as const) m.set(key([x, y, 0]), id)
    const miss = nearMiss(reader(m, ground), [1, 1, 0], nat)!
    expect(missCause(miss)).toBe('turned')
    expect(nearMissLine(miss)).toBe('That was the Compiler, but it was turned the wrong way and it touched the ground. Build it as the card shows, with a gap all round.')
  })

  it('the Quarry Charge, isolated, compiles in either hand (owner, 2026-11-28: a bare hand compiles anything in reach)', () => {
    const read = reader(quarry([0, 1, 0]), ground)
    for (const bare of [true, false]) {
      const p = smashPreview(read, [1, 2, 1], bare)!
      expect(p.state, `bare ${bare}`).toBe('compiles')
      expect(p.miss).toBeNull()
      expect(p.tooBig).toBe(false)
      expect(smashAsk(read, [1, 2, 1], bare)).toBeNull()
    }
    expect(nearMiss(read, [1, 2, 1])).toBeNull()
  })

  it('the Quarry Charge on the floor: TOUCHING THE GROUND, with the Compiler in hand', () => {
    const read = reader(quarry([0, 0, 0]), ground)
    expect(missCause(smashPreview(read, [1, 1, 1], false, nat)!.miss!)).toBe('ground')
  })

  it('dug out only under the handle: it still touches the ground at its edges and corners', () => {
    const dug: Read = (x, y, z) => (x === 1 && y === -1 && z === 0 ? 0 : ground(x, y, z))
    const read = reader(t([0, 0, 0]), dug)
    expect(read(1, -1, 0)).toBe(0)
    const p = smashPreview(read, [1, 1, 0], true, nat)!
    expect(p.state).toBe('breaks')
    expect(previewLine(p.state, p.cells.length, missCause(p.miss!))).toBe('BREAKS 5 · TOUCHING THE GROUND')
  })

  it('on a placed platform: a bigger build, so no near miss; the placed Glowcore still brings up the confirm', () => {
    const m = t([0, 0, 0])
    for (let x = -1; x <= 3; x++) for (let z = -1; z <= 1; z++) m.set(key([x, -1, z]), GRIDSTONE)
    const placed = new Set([...m.keys()])
    const natural = (x: number, y: number, z: number): boolean => y < 0 && !placed.has(key([x, y, z]))
    const read = reader(m, ground)
    const p = smashPreview(read, [1, 1, 0], true, natural)!
    expect(p.miss).toBeNull()
    expect(previewLine(p.state, p.cells.length, previewCause(p))).toBe('BREAKS 5')
    expect(smashAsk(read, [1, 1, 0], true, natural)!.words).toBe("This won't compile. It breaks 5 blocks, including placed Glowcore. Smash anyway?")
  })

  it('the Quarry Charge mirrored across X is turned (bare); mirrored across Y or Z it is the same recipe', () => {
    const read = reader(quarry([0, 1, 0], true), ground)
    expect(nearMiss(read, [1, 2, 1])?.turned).toBe(true)
    const poses = posesOf(QUARRY_CHARGE_RECIPE)
    expect(poses.filter((p) => !p.turned)).toHaveLength(1)
    expect(posesOf(COMPILER_RECIPE).filter((p) => !p.turned)).toHaveLength(1)
  })
})

describe('a turned recipe compiles as another shape, in either hand: still a near miss', () => {
  it('the T turned a quarter, lifted: COMPILES · TURNED THE WRONG WAY in red, and it asks first', () => {
    const read = reader(t([0, 1, 0], true), ground)
    const g = smashGroup(read, [0, 3, 1], false)
    expect(compiles(g.arrangement)).toBe(true)
    const p = smashPreview(read, [0, 3, 1], false, nat)!
    expect(p.state).toBe('compiles')
    expect(previewLine(p.state, 5, missCause(p.miss!))).toBe('COMPILES · TURNED THE WRONG WAY')
    expect(previewColor(p.state, missCause(p.miss!))).toBe(PREVIEW_NEAR_MISS)
    const ask = smashAsk(read, [0, 3, 1], false, nat)!
    expect(ask.words).toBe("This is the Compiler, but it is turned the wrong way, so it won't make the Compiler. Build it as the card shows. Smashing breaks 5 blocks, including placed Glowcore. Smash anyway?")
    expect(nearMissLine(p.miss!)).toBe('That was the Compiler, but it was turned the wrong way. Build it as the card shows.')
  })

  it('the Quarry Charge mirrored across X never silently compiles into nothing: it warns and asks', () => {
    const read = reader(quarry([0, 1, 0], true), ground)
    const p = smashPreview(read, [1, 2, 1], false, nat)!
    expect(p.state).toBe('compiles')
    expect(previewLine(p.state, 7, missCause(p.miss!))).toBe('COMPILES · TURNED THE WRONG WAY')
    const ask = smashAsk(read, [1, 2, 1], false, nat)!
    expect(ask.rare).toEqual(['Cinderrock'])
    expect(ask.words).toBe("This is the Quarry Charge, but it is turned the wrong way, so it won't make Quarry Charges. Build it as the card shows. Smashing breaks 7 blocks, including placed Cinderrock. Smash anyway?")
  })
})

describe('a bare hand compiles anything that fits its reach of 3 (owner, 2026-11-28)', () => {
  it('a player build of 3 by 3 by 3 or less compiles bare-handed', () => {
    const m = new Map<string, number>([[key([0, 1, 0]), GRIDSTONE], [key([2, 3, 2]), FERROVEIN], [key([1, 2, 1]), RUSTBAND]])
    const read = reader(m, ground)
    const g = smashGroup(read, [1, 2, 1], true)
    expect(g.arrangement?.size).toEqual([3, 3, 3])
    expect(compiles(g.arrangement)).toBe(true)
    const p = smashPreview(read, [1, 2, 1], true)!
    expect(p.state).toBe('compiles')
    expect(previewLine(p.state, 3, previewCause(p))).toBe('COMPILES')
  })

  it('an isolated build 4 long, bare-handed: BREAKS · TOO BIG FOR A BARE HAND; with the Compiler it compiles', () => {
    const four: Read = (x, y, z) => (y === 1 && z === 0 && x >= 0 && x <= 3 ? GRIDSTONE : ground(x, y, z))
    for (const x of [0, 1, 3]) {
      const p = smashPreview(four, [x, 1, 0], true)!
      expect(p.state, `x ${x}`).toBe('breaks')
      expect(p.tooBig).toBe(true)
      expect(previewLine(p.state, p.cells.length, previewCause(p))).toBe(`BREAKS ${p.cells.length} · TOO BIG FOR A BARE HAND`)
      expect(previewColor(p.state, previewCause(p))).toBe(PREVIEW_NEAR_MISS)
      const held = smashPreview(four, [x, 1, 0], false)!
      expect(held.state).toBe('compiles')
      expect(previewCause(held)).toBeNull()
    }
    expect(TOO_BIG_LINE).toBe('Nothing compiled. That build is too big for a bare hand, which compiles builds up to 3 blocks on every side. The Compiler reaches 16.')
  })

  it('a 4-long build touching the ground is not too big, only not a construction', () => {
    const four: Read = (x, y, z) => (y === 0 && z === 0 && x >= 0 && x <= 3 ? GRIDSTONE : ground(x, y, z))
    expect(smashPreview(four, [1, 0, 0], true)!.tooBig).toBe(false)
  })

  it('too big with a placed Glowcore in it: the confirm says so', () => {
    const m = new Map<string, number>([[key([0, 1, 0]), GRIDSTONE], [key([1, 1, 0]), GLOWCORE], [key([2, 1, 0]), GRIDSTONE], [key([3, 1, 0]), GRIDSTONE]])
    const ask = smashAsk(reader(m, ground), [1, 1, 0], true, nat)!
    expect(ask.words).toBe(`This won't compile. It is too big for a bare hand, which compiles builds up to 3 blocks on every side. It breaks ${ask.count} blocks, including placed Glowcore. Smash anyway?`)
  })
})

describe("isolated means touching no block on a face, edge or corner (the owner's rule; the Compiler repro, 2026-11-28)", () => {
  it('a block in the T\'s box grown by one that touches nothing: the T still compiles, in either hand, struck anywhere', () => {
    for (const stray of [[-1, 1, 0], [-1, 1, 1], [3, 1, -1], [-1, 5, 1]] as const) {
      const m = t([0, 1, 0])
      m.set(key(stray), GRIDSTONE)
      const read = reader(m, ground)
      for (const bare of [true, false]) for (const h of [[1, 1, 0], [1, 2, 0], [0, 3, 0], [1, 3, 0], [2, 3, 0]] as const) {
        const g = smashGroup(read, h, bare)
        expect(g.isolated, `${stray} ${h} bare ${bare}`).toBe(true)
        expect(g.smash).toHaveLength(5)
        expect(smashPreview(read, h, bare, nat)!.state).toBe('compiles')
      }
      expect(nearMiss(read, [1, 2, 0], nat)).toBeNull()
      expect(smashAsk(read, [1, 2, 0], true, nat)).toBeNull()
    }
  })

  it('a block at a corner of it does touch: it joins the group, which is no longer the T, and is no near miss', () => {
    const m = t([0, 1, 0])
    m.set(key([-1, 4, 1]), GRIDSTONE) // corner to the left Rustband at (0, 3, 0)
    const read = reader(m, ground)
    const g = smashGroup(read, [1, 2, 0], true)
    expect(g.cells).toHaveLength(6)
    // Four wide: too wide for a bare hand; the placed Glowcore still asks.
    const p = smashPreview(read, [1, 2, 0], true, nat)!
    expect(p.miss).toBeNull()
    expect(previewLine(p.state, p.cells.length, previewCause(p))).toBe('BREAKS 5 · TOO BIG FOR A BARE HAND')
    expect(smashAsk(read, [1, 2, 0], true, nat)!.words).toMatch(/^This won't compile\. It is too big for a bare hand/)
    // With the Compiler the six compile as the shape they are: no warning and no question.
    const held = smashPreview(read, [1, 2, 0], false, nat)!
    expect(previewLine(held.state, held.cells.length, previewCause(held))).toBe('COMPILES')
    expect(smashAsk(read, [1, 2, 0], false, nat)).toBeNull()
  })
})

describe('a near miss only when the struck build is exactly a recipe\'s blocks (coordinator\'s ruling)', () => {
  it('a larger player build holding the T\'s shape: no near miss and no recipe question, in either hand', () => {
    const m = t([0, 1, 0], true) // turned, so alone it would be TURNED THE WRONG WAY
    m.set(key([0, 4, 1]), FERROVEIN) // one more block on top of the Glowcore
    const read = reader(m, ground)
    expect(nearMiss(read, [0, 2, 1], nat)).toBeNull()
    const held = smashPreview(read, [0, 2, 1], false, nat)!
    expect(held.state).toBe('compiles')
    expect(previewCause(held)).toBeNull()
    expect(smashAsk(read, [0, 2, 1], false, nat)).toBeNull()
    // Without the extra block it is the near miss again.
    m.delete(key([0, 4, 1]))
    expect(nearMiss(read, [0, 2, 1], nat)?.turned).toBe(true)
  })

  it('the recipe\'s materials in a shape that is no turn of it: no near miss', () => {
    const m = new Map<string, number>()
    for (const [x, id] of [[0, FERROVEIN], [1, FERROVEIN], [2, RUSTBAND], [3, GLOWCORE], [4, RUSTBAND]] as const) m.set(key([x, 1, 0]), id)
    expect(nearMiss(reader(m, ground), [2, 1, 0], nat)).toBeNull()
  })
})

describe('tooBigBare stays within its bound (timing-free: it counts the cells it reads)', () => {
  it('bare-handed into endless ground: it stops once the group passes 16, far short of the whole window', () => {
    const counted = (n: { count: number }): Read => (x, y, z) => { n.count++; return ground(x, y, z) }
    const hit = [0, -1, 0] as const
    const g = smashGroup(ground, hit, true)
    expect(g.isolated).toBe(false)
    const bounded = { count: 0 }
    expect(tooBigBare(ground, hit, true, g, bounded)).toBe(false)
    // The bound: each cell is read once, and it stops once the group spans 17, so it reads within 19 by 19 by 19.
    expect(bounded.count).toBeGreaterThan(0)
    expect(bounded.count).toBeLessThanOrEqual(19 ** 3)
    // What the whole Compiler window costs, for scale: the bounded check reads well under half of it.
    const whole = { count: 0 }
    gather(counted(whole), hit)
    expect(bounded.count * 2).toBeLessThan(whole.count)
  })

  it('an isolated bare gather with no arrangement is too big already: no second flood at all', () => {
    const four: Read = (x, y, z) => (y === 1 && z === 0 && x >= 0 && x <= 3 ? GRIDSTONE : ground(x, y, z))
    const g = smashGroup(four, [1, 1, 0], true)
    expect(g.isolated).toBe(true)
    expect(g.arrangement).toBeNull()
    const reads = { count: 0 }
    expect(tooBigBare(four, [1, 1, 0], true, g, reads)).toBe(true)
    expect(reads.count).toBe(0)
  })

  it('a bare window cut off a longer build: the second look finds it isolated and too big', () => {
    const six: Read = (x, y, z) => (y === 1 && z === 0 && x >= 0 && x <= 5 ? GRIDSTONE : ground(x, y, z))
    const g = smashGroup(six, [0, 1, 0], true)
    expect(g.isolated).toBe(false)
    expect(tooBigBare(six, [0, 1, 0], true, g)).toBe(true)
    // With the Compiler in hand it is never asked.
    expect(tooBigBare(six, [0, 1, 0], false, g)).toBe(false)
  })
})

describe('no near miss where there is none', () => {
  it('the lifted T compiles, bare-handed and with the Compiler: no miss and no confirm', () => {
    const read = reader(t([0, 1, 0]), ground)
    for (const bare of [true, false]) {
      const g = smashGroup(read, [1, 3, 0], bare)
      expect(compiles(g.arrangement)).toBe(true)
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
    expect(nearMiss(reader(m, ground), [1, 1, 0])).toBeNull()
  })
})

describe('the confirm before rare materials go (owner\'s ruling on bulk digging: placed only)', () => {
  it('a placed Glowcore on the ground asks, with no recipe in it', () => {
    const m = new Map<string, number>([[key([0, 0, 0]), GLOWCORE]])
    const ask = smashAsk(reader(m, ground), [0, 0, 0], true, nat)!
    expect(ask.miss).toBeNull()
    expect(ask.words).toBe(`This won't compile. It breaks ${ask.count} blocks, including placed Glowcore. Smash anyway?`)
  })

  it('natural ore in the ground never asks, bare-handed or with the Compiler', () => {
    const ore: Read = (x, y, z) => (x === 0 && y === -1 && z === 0 ? GLOWCORE : (x === 1 && y === -1 && z === 0 ? CINDERROCK : ground(x, y, z)))
    for (const bare of [true, false]) {
      expect(smashGroup(ore, [0, -1, 0], bare).blocks.some((b) => b.id === GLOWCORE)).toBe(true)
      expect(smashAsk(ore, [0, -1, 0], bare, nat), `bare ${bare}`).toBeNull()
    }
  })

  it('names each placed rare kind once: the rare band, Glowcore and Cinderrock; natural ones not at all', () => {
    const at = (i: number): [number, number, number] => [i, 0, 0]
    const ids = [GLOWCORE, GLOWCORE, CINDERROCK, GRIDSTONE, 197]
    expect(rareLost(ids.map((id, i) => ({ at: at(i), id })))).toEqual(['Glowcore', 'Cinderrock', expect.any(String)])
    expect(rareLost(ids.map((id, i) => ({ at: at(i), id })), () => true)).toEqual([])
    expect(rareLost([GRIDSTONE, RUSTBAND, FERROVEIN].map((id, i) => ({ at: at(i), id })))).toEqual([])
    expect(confirmWords(1, ['Glowcore', 'Cinderrock'], null)).toBe("This won't compile. It breaks 1 block, including placed Glowcore and Cinderrock. Smash anyway?")
  })
})

describe('the words keep the owner\'s rule', () => {
  it('no word for upright posture and no long dash, in every line a near miss or a confirm can say', () => {
    const lines: string[] = [...Object.values(CAUSE_WORDS)]
    for (const recipe of ['compiler', 'quarry'] as const) for (const turned of [false, true]) for (const touching of [null, 'ground', 'block'] as const) {
      if (!turned && !touching) continue
      const m: NearMiss = { recipe, name: recipe === 'compiler' ? 'the Compiler' : 'the Quarry Charge', turned, touching }
      lines.push(nearMissLine(m), confirmWords(5, ['Glowcore'], m), confirmWords(5, ['Glowcore'], m, true))
    }
    lines.push(confirmWords(3, ['Glowcore'], null), confirmWords(3, ['Glowcore'], null, false, true), TOO_BIG_LINE)
    for (const l of lines) expect(l, l).not.toMatch(FORBIDDEN)
  })
})
