/**
 * assay.test.ts - the survey card's numbers (lib/terrain/assay.ts): one pass
 * over a chunk counts every kind exactly as a direct scan does, marks a kind
 * visible only when one of its faces is drawn (open space, or a see-through
 * or walk-through block of another kind, across the chunk's edge too), finds
 * each layer's kind for the core, sorts the card rarest first, says the
 * recipe lines gently, and is worked out once per version, never again
 * until the chunk or a neighbour changes. What you mined (owner, 2026-11-28)
 * is your own blocks against the base ground at the revision shown: others'
 * removals and blocks you placed and mined again never count; a blast does.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { generate } from '../generate'
import { CELLS, idx, type ChunkBase } from '../coords'
import { KINDS } from '../blocks'
import { TerrainWorld } from '../world'
import { encodeLayer, applyLayer } from '../layer'
import {
  AVERAGE_HARDNESS, COMMON, RARITY, hardnessLine, STRATA_MIN, assayBlocks, assayRuns, chunkAssay, chunkMined, forgetAssays, minedBlocks, recipeNotes, surveyCard, type GroundFacts,
} from '../assay'

const GRIDSTONE = 1, UMBERSLATE = 2, RUSTBAND = 5, CINDERROCK = 7, PRISMITE = 8, RIMEGLASS = 10, TIDEWATER = 11, FERROVEIN = 40, COBALTINE = 41, GLOWCORE = 42, VOIDPEARL = 193

const BASE: ChunkBase = { x: 0x1234567890abcdef12340n, y: 0xfedcba0987654321fed80n, z: 0x0f0f0f0f0f0f0f0f0f0e0n, plane: 0 }

/** A chunk of solid Gridstone. */
const solid = (id = GRIDSTONE): Uint8Array => new Uint8Array(CELLS).fill(id)

const facts: GroundFacts = { family: 'volcanic', maxK: 12, meanK: 8.4, top: CINDERROCK }

beforeEach(() => forgetAssays())

describe('the counts', () => {
  it('match a direct scan of a real generated chunk, kind by kind', () => {
    const g = generate(BASE)
    const a = assayBlocks(g.blocks)
    const direct = new Map<number, number>()
    for (const id of g.blocks) direct.set(id, (direct.get(id) ?? 0) + 1)
    for (let id = 0; id < 256; id++) expect(a.counts[id]).toBe(direct.get(id) ?? 0)
    const card = surveyCard(a, { family: g.family, maxK: g.maxK, meanK: g.meanK, top: g.top })
    expect(card.total).toBe(CELLS - (direct.get(0) ?? 0))
    for (const r of [...card.finds, ...card.common]) expect(r.count).toBe(direct.get(r.id))
    expect(card.hardness).toEqual({ max: g.maxK, mean: g.meanK })
    expect(card.ground?.family).toBe(g.family)
  })

  it('mined and placed blocks show through the layers: the ground with a layer over it is what is counted', () => {
    const ground = solid()
    const built = ground.slice()
    built[idx(4, 4, 4)] = 0 // mined
    built[idx(5, 5, 5)] = GLOWCORE // placed (a Glowcore someone carried in)
    const merged = applyLayer(ground, encodeLayer(ground, built, 0, 2), 2)!
    const a = assayBlocks(merged)
    expect(a.counts[0]).toBe(1)
    expect(a.counts[GLOWCORE]).toBe(1)
    expect(a.counts[GRIDSTONE]).toBe(CELLS - 2)
  })
})

describe('visible or buried', () => {
  it('a block with open space beside it is visible; one walled in on all six sides is buried', () => {
    const b = solid()
    b[idx(10, 10, 10)] = GLOWCORE // buried deep
    b[idx(20, 31, 20)] = PRISMITE // on the top face of the chunk: the chunk above is open space
    const a = assayBlocks(b)
    expect(a.seen[GLOWCORE]).toBe(0)
    expect(a.seen[PRISMITE]).toBe(1)
    // A cave beside the Glowcore opens it.
    b[idx(11, 10, 10)] = 0
    expect(assayBlocks(b).seen[GLOWCORE]).toBe(1)
  })

  it('seen through glass or water counts as visible; glass beside glass does not', () => {
    const b = solid()
    b[idx(8, 8, 8)] = COBALTINE
    b[idx(8, 9, 8)] = RIMEGLASS
    b[idx(16, 16, 16)] = FERROVEIN
    b[idx(16, 16, 17)] = TIDEWATER
    b[idx(3, 3, 3)] = RIMEGLASS
    b[idx(3, 3, 4)] = RIMEGLASS
    const a = assayBlocks(b)
    expect(a.seen[COBALTINE]).toBe(1)
    expect(a.seen[FERROVEIN]).toBe(1)
    // The Rimeglass at (8, 9, 8) sits on Cobaltine and Gridstone: walled in, each Rimeglass block only touches rock or Rimeglass.
    expect(a.seen[RIMEGLASS]).toBe(0)
  })

  it('on the chunk\'s edge it looks at the next chunk: open space where none is held, buried against its rock', () => {
    const b = solid()
    b[idx(0, 12, 12)] = GLOWCORE
    expect(assayBlocks(b).seen[GLOWCORE]).toBe(1)
    // Every neighbour solid: the edge block is walled in, and so is everything else.
    const all = Array.from({ length: 6 }, () => solid())
    const a = assayBlocks(b, all)
    expect(a.seen[GLOWCORE]).toBe(0)
    expect(a.seen[GRIDSTONE]).toBe(0)
    // The -x neighbour open at the facing cell (31, 12, 12): seen again.
    all[0][idx(31, 12, 12)] = 0
    expect(assayBlocks(b, all).seen[GLOWCORE]).toBe(1)
    // The +x neighbour's facing cell for (31, y, z) is (0, y, z).
    const c = solid()
    c[idx(31, 2, 3)] = VOIDPEARL
    const n = Array.from({ length: 6 }, () => solid())
    expect(assayBlocks(c, n).seen[VOIDPEARL]).toBe(0)
    n[1][idx(0, 2, 3)] = 0
    expect(assayBlocks(c, n).seen[VOIDPEARL]).toBe(1)
  })
})

describe('the core', () => {
  it('each layer\'s kind is the one most of it is made of; a mostly open layer is open', () => {
    const b = solid()
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
      b[idx(x, 3, z)] = x < 20 ? RUSTBAND : UMBERSLATE
      b[idx(x, 31, z)] = (x + 32 * z) < STRATA_MIN - 1 ? GRIDSTONE : 0
    }
    const a = assayBlocks(b)
    expect(a.strata[0]).toBe(GRIDSTONE)
    expect(a.strata[3]).toBe(RUSTBAND)
    expect(a.strata[31]).toBe(0)
  })
})

describe('the card', () => {
  it('sorts rarest first: the rare band and Glowcore, Cinderrock, Prismite, Cobaltine, Ferrovein, then the common rock', () => {
    const b = solid()
    b.fill(UMBERSLATE, 0, 5000)
    for (const [i, id] of [[100, FERROVEIN], [200, COBALTINE], [300, PRISMITE], [400, CINDERROCK], [500, GLOWCORE], [600, VOIDPEARL]] as const) b[20000 + i] = id
    const card = surveyCard(assayBlocks(b), facts)
    expect(card.finds.map((r) => r.id)).toEqual([VOIDPEARL, GLOWCORE, CINDERROCK, PRISMITE, COBALTINE, FERROVEIN])
    expect(card.common.map((r) => r.id)).toEqual([UMBERSLATE, GRIDSTONE])
    expect(card.finds.filter((r) => r.prized).map((r) => r.id)).toEqual([VOIDPEARL, GLOWCORE])
    expect(card.ground).toEqual({ family: 'volcanic', name: 'Volcanic', rock: CINDERROCK })
  })

  it('every kind the block table names has its place, and the common rock is the last six', () => {
    for (const k of KINDS) expect(RARITY).toContain(k.id)
    expect(RARITY.slice(-COMMON.size).every((id) => COMMON.has(id))).toBe(true)
  })

  it('a ground type this build does not know (a later revision) keeps its own name and its skin for a swatch', () => {
    const card = surveyCard(assayBlocks(solid()), { family: 'mire', maxK: 3, meanK: 2, top: 4 })
    expect(card.ground).toEqual({ family: 'mire', name: 'Mire', rock: 4 })
    expect(surveyCard(assayBlocks(solid()), null).ground).toBeNull()
    expect(surveyCard(assayBlocks(solid()), null).hardness).toBeNull()
  })
})

describe('the hardness line', () => {
  it('the average chunk\'s hardness is 10, from the measured shares; a chunk is richer, about the same or leaner', () => {
    expect(AVERAGE_HARDNESS).toBe(10)
    expect(hardnessLine(12)).toBe('Richer than the average hardness of 10.')
    expect(hardnessLine(10)).toBe('About the average hardness of 10.')
    expect(hardnessLine(7)).toBe('Leaner than the average hardness of 10.')
  })
})

describe('the recipe lines', () => {
  it('Glowcore, Ferrovein and Cinderrock here: what the Compiler and the Quarry Charge need, in words', () => {
    expect(recipeNotes([GLOWCORE, CINDERROCK, FERROVEIN, RUSTBAND], false)).toEqual([
      'Glowcore here: the Compiler needs one.',
      'Cinderrock here: the Quarry Charge needs one.',
      'Ferrovein here: the Compiler needs two and the Quarry Charge one.',
    ])
  })

  it('the common rock never gets a line, and with the Compiler made its needs are left out', () => {
    expect(recipeNotes([RUSTBAND, UMBERSLATE], false)).toEqual([])
    expect(recipeNotes([GLOWCORE, FERROVEIN], true)).toEqual(['Ferrovein here: the Quarry Charge needs one.'])
    expect(recipeNotes([PRISMITE], false)).toEqual([])
  })

  it('the card carries them only for what is present', () => {
    const b = solid()
    b[123] = GLOWCORE
    expect(surveyCard(assayBlocks(b), facts).notes).toEqual(['Glowcore here: the Compiler needs one.'])
    expect(surveyCard(assayBlocks(solid()), facts).notes).toEqual([])
  })
})

describe('kept per chunk and version', () => {
  function field(): TerrainWorld {
    const w = new TerrainWorld(BASE, { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } })
    const s = w.slotAt(0, 0, 0, true)!
    const g = solid()
    w.setBlocks(s.key, g, g.slice())
    return w
  }

  it('opened again with nothing changed: the kept pass, no new count', () => {
    const w = field()
    const s = w.slotAt(0, 0, 0)!
    const before = assayRuns()
    const a = chunkAssay(w, s)
    expect(assayRuns()).toBe(before + 1)
    expect(chunkAssay(w, s)).toBe(a)
    expect(chunkAssay(w, s)).toBe(a)
    expect(assayRuns()).toBe(before + 1)
  })

  it('a block mined or placed (a new version) counts again, and the counts follow it', () => {
    const w = field()
    const s = w.slotAt(0, 0, 0)!
    const a = chunkAssay(w, s)!
    expect(a.counts[0]).toBe(0)
    w.setCs(1, 1, 1, 0)
    const b = chunkAssay(w, s)!
    expect(b).not.toBe(a)
    expect(b.counts[0]).toBe(1)
    w.setCs(2, 2, 2, GLOWCORE)
    expect(chunkAssay(w, s)!.counts[GLOWCORE]).toBe(1)
  })

  it('a neighbour coming in counts again (its edge may wall a face in)', () => {
    const w = field()
    const s = w.slotAt(0, 0, 0)!
    const a = chunkAssay(w, s)!
    expect(a.seen[GRIDSTONE]).toBe(1)
    for (const [x, y, z] of [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]] as const) {
      const n = w.slotAt(x, y, z, true)!
      w.setBlocks(n.key, solid(), solid())
    }
    const b = chunkAssay(w, s)!
    expect(b).not.toBe(a)
    expect(b.seen[GRIDSTONE]).toBe(0)
  })

  it('no blocks yet: no pass', () => {
    const w = new TerrainWorld(BASE, { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } })
    expect(chunkAssay(w, w.slotAt(0, 0, 0, true)!)).toBeNull()
  })

  it('a chunk dropped and loaded again, its version back where it was, is counted again (review of #956)', () => {
    const w = field()
    const s = w.slotAt(0, 0, 0)!
    const a = chunkAssay(w, s)!
    expect(a.counts[GLOWCORE]).toBe(0)
    const version = s.version
    w.drop(s)
    const again = w.slotAt(0, 0, 0, true)!
    const b = solid()
    b[idx(9, 9, 9)] = GLOWCORE
    w.setBlocks(again.key, b, b.slice())
    again.version = version
    expect(chunkAssay(w, again)!.counts[GLOWCORE]).toBe(1)
    // A neighbour dropped and loaded again at the same version counts again too.
    const n = w.slotAt(1, 0, 0, true)!
    w.setBlocks(n.key, solid(), solid())
    const c = chunkAssay(w, again)!
    const nv = n.version
    w.drop(n)
    const n2 = w.slotAt(1, 0, 0, true)!
    const open = solid()
    open[idx(0, 9, 9)] = 0
    w.setBlocks(n2.key, open, open.slice())
    n2.version = nv
    const d = chunkAssay(w, again)!
    expect(d).not.toBe(c)
  })
})

describe('what you mined', () => {
  it('is each cell of the base ground your own blocks hold as open space or another block, by the ground\'s kind', () => {
    const ground = solid()
    ground[idx(3, 3, 3)] = GLOWCORE
    ground[idx(0, 31, 0)] = 0
    const own = ground.slice()
    own[idx(3, 3, 3)] = 0 // the Glowcore mined
    own[idx(1, 1, 1)] = 0 // a Gridstone mined
    own[idx(2, 2, 2)] = RIMEGLASS // a Gridstone mined and Rimeglass put in its place
    const m = minedBlocks(own, ground)
    expect(m[GLOWCORE]).toBe(1)
    expect(m[GRIDSTONE]).toBe(2)
    expect(m[RIMEGLASS]).toBe(0)
    expect(m.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('a block placed in open space and mined again counts nothing; placed and left counts nothing either', () => {
    const ground = solid()
    for (let o = 31 * 1024; o < CELLS; o++) ground[o] = 0
    const own = ground.slice()
    own[idx(4, 31, 4)] = GLOWCORE // placed in the air
    own[idx(4, 31, 4)] = 0 // and mined again
    own[idx(5, 31, 5)] = CINDERROCK // placed and left
    expect(minedBlocks(own, ground).reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('someone else\'s removals are not yours: only your own blocks are read, never what stands', () => {
    const w = new TerrainWorld(BASE, { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } })
    const slot = w.slotAt(0, 0, 0, true)!
    const ground = solid()
    const merged = ground.slice()
    merged[idx(6, 6, 6)] = 0 // another builder's layer mined this
    merged[idx(7, 7, 7)] = 0 // and this
    w.setBlocks(slot.key, ground, merged)
    slot.own = ground.slice()
    slot.own[idx(8, 8, 8)] = 0 // yours
    slot.revision = 2
    expect(chunkAssay(w, slot)!.counts[0]).toBe(2)
    const m = chunkMined(slot, ground, 2)!
    expect(m[GRIDSTONE]).toBe(1)
  })

  it('a blast\'s cells count, every kind it took', () => {
    const ground = solid()
    ground[idx(10, 10, 10)] = GLOWCORE
    ground[idx(11, 10, 10)] = FERROVEIN
    const own = ground.slice()
    let taken = 0
    for (let y = 7; y <= 13; y++) for (let z = 7; z <= 13; z++) for (let x = 7; x <= 13; x++) { own[idx(x, y, z)] = 0; taken++ }
    const m = minedBlocks(own, ground)
    expect(m[GLOWCORE]).toBe(1)
    expect(m[FERROVEIN]).toBe(1)
    expect(m[GRIDSTONE]).toBe(taken - 2)
  })

  it('at the revision shown: blocks built over another revision\'s ground count only the cells you changed, as the shown base\'s kind', () => {
    const mine = solid() // the ground your blocks were built over (your own revision)
    const shown = solid()
    shown[idx(1, 1, 1)] = PRISMITE // the shown revision differs here, a cell you never touched
    shown[idx(2, 2, 2)] = COBALTINE // and here, a cell you mined
    shown[idx(3, 3, 3)] = 0 // open space at the shown revision where yours had rock you mined
    const own = mine.slice()
    own[idx(2, 2, 2)] = 0
    own[idx(3, 3, 3)] = 0
    own[idx(4, 4, 4)] = 0
    const m = minedBlocks(own, shown, mine)
    // What you carried from (2,2,2) was the Cobaltine you were shown; (1,1,1) you never touched; (3,3,3) was open space shown.
    expect(m[COBALTINE]).toBe(1)
    expect(m[PRISMITE]).toBe(0)
    expect(m[GRIDSTONE]).toBe(1)
    // A cell you mined where your own ground was already open (only the shown revision had rock): counted by its explicit change.
    const own2 = mine.slice()
    const open = mine.slice()
    open[idx(5, 5, 5)] = 0
    own2[idx(5, 5, 5)] = 0
    expect(minedBlocks(own2, shown, open)[GRIDSTONE]).toBe(0)
    expect(minedBlocks(own2, shown, open, new Set([idx(5, 5, 5)]))[GRIDSTONE]).toBe(1)
  })

  it('kept per version: the same counts until a block changes; none where you hold no blocks of your own', () => {
    const w = new TerrainWorld(BASE, { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } })
    const slot = w.slotAt(0, 0, 0, true)!
    const ground = solid()
    w.setBlocks(slot.key, ground, ground.slice())
    expect(chunkMined(slot, ground, 2)).toBeNull()
    slot.own = ground.slice()
    const a = chunkMined(slot, ground, 2)!
    expect(chunkMined(slot, ground, 2)).toBe(a)
    w.setCs(1, 1, 1, 0)
    slot.own[idx(1, 1, 1)] = 0
    const b = chunkMined(slot, ground, 2)!
    expect(b).not.toBe(a)
    expect(b[GRIDSTONE]).toBe(1)
  })

  it('on the card: MINED and LEFT per kind and in all; a kind mined out is listed at 0, and a kept kind stays at 0', () => {
    const ground = solid()
    ground[idx(3, 3, 3)] = GLOWCORE
    const own = ground.slice()
    own[idx(3, 3, 3)] = 0
    own[idx(1, 1, 1)] = 0
    const card = surveyCard(assayBlocks(own), facts, { mined: minedBlocks(own, ground) })
    expect(card.finds).toEqual([expect.objectContaining({ id: GLOWCORE, count: 0, mined: 1, visible: false })])
    expect(card.common).toEqual([expect.objectContaining({ id: GRIDSTONE, count: CELLS - 2, mined: 1 })])
    expect(card.total).toBe(CELLS - 2)
    expect(card.minedTotal).toBe(2)
    // Nothing left of it and no recipe line for it.
    expect(card.notes).toEqual([])
    // Not mined and none left: gone from a fresh card, but kept on one already showing it.
    expect(surveyCard(assayBlocks(solid()), facts).finds).toEqual([])
    expect(surveyCard(assayBlocks(solid()), facts, { keep: [CINDERROCK] }).finds).toEqual([expect.objectContaining({ id: CINDERROCK, count: 0, mined: 0 })])
  })
})
