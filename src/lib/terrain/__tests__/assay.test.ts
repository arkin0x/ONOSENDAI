/**
 * assay.test.ts - the survey card's numbers (lib/terrain/assay.ts): one pass
 * over a chunk counts every kind exactly as a direct scan does, and of each
 * kind counts a block visible only when one of its faces is drawn (open
 * space, or a see-through or walk-through block of another kind) onto open
 * space you can reach from outside without digging, across the chunk and its
 * 26 neighbours, and buried otherwise (owner, 2026-11-28: "what if the air
 * adjacent to the block is cut off from the outside"; "it has to account for
 * any adjacent chunks"), finds
 * each layer's kind for the core, sorts the card rarest first, says the
 * recipe lines gently, and is worked out once per version, never again
 * until the chunk or a neighbour changes. What you mined (owner, 2026-11-28)
 * is your own blocks against the base ground at the revision shown: others'
 * removals and blocks you placed and mined again never count; a blast does.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { generate } from '../generate'
import { CELLS, idx, type ChunkBase } from '../coords'
import { KINDS, clearTable } from '../blocks'
import { aroundIndex } from '../light'
import { TerrainWorld } from '../world'
import { encodeLayer, applyLayer } from '../layer'
import {
  AVERAGE_HARDNESS, COMMON, RARITY, hardnessLine, STRATA_MIN, assayBlocks, hoodBlocks, hoodIndex, reachOpen, assayRuns, chunkAssay, chunkMined, forgetAssays, minedBlocks, recipeNotes, surveyCard, type GroundFacts,
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

/** 26 neighbours (light.ts aroundIndex order), each made by `make` from its chunk offset; the middle is unused. */
const hood = (make: (dx: number, dy: number, dz: number) => Uint8Array | null): Array<Uint8Array | null> => {
  const out: Array<Uint8Array | null> = new Array(27).fill(null)
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) out[aroundIndex(dx, dy, dz)] = make(dx, dy, dz)
  return out
}
const allSolid = (): Array<Uint8Array | null> => hood(() => solid())

/**
 * The direct scan the pass is held to, written another, plainer way: cells
 * named by their place in the chunk's frame, -32 to 63 on each axis, read
 * from whichever chunk holds them; a flood (a stack, y slowest last) from
 * every open cell on the outside of the 3 by 3 by 3; then each block's six
 * faces by the mesher's rule. Per kind: visible and buried.
 */
function directScan(b: Uint8Array, around: ReadonlyArray<Uint8Array | null> = []): { visible: Map<number, number>; buried: Map<number, number> } {
  const ct = clearTable()
  const chunkOf = (v: number): number => (v < 0 ? -1 : v > 31 ? 1 : 0)
  const at = (x: number, y: number, z: number): number => {
    const cx = chunkOf(x), cy = chunkOf(y), cz = chunkOf(z)
    const src = cx === 0 && cy === 0 && cz === 0 ? b : around[aroundIndex(cx, cy, cz)]
    return src ? src[(x - 32 * cx) + 32 * (z - 32 * cz) + 1024 * (y - 32 * cy)] : 0
  }
  const isOpen = (id: number): boolean => id === 0 || ct[id] === 1
  const key = (x: number, y: number, z: number): number => (x + 32) + 96 * ((y + 32) + 96 * (z + 32))
  const reached = new Uint8Array(96 ** 3)
  const stack: number[] = []
  const visit = (x: number, y: number, z: number): void => {
    if (x < -32 || x > 63 || y < -32 || y > 63 || z < -32 || z > 63) return
    const k = key(x, y, z)
    if (reached[k] || !isOpen(at(x, y, z))) return
    reached[k] = 1
    stack.push(x, y, z)
  }
  for (let p = -32; p <= 63; p++) for (let q = -32; q <= 63; q++) {
    visit(-32, p, q); visit(63, p, q); visit(p, -32, q); visit(p, 63, q); visit(p, q, -32); visit(p, q, 63)
  }
  while (stack.length) {
    const z = stack.pop()!, y = stack.pop()!, x = stack.pop()!
    visit(x - 1, y, z); visit(x + 1, y, z); visit(x, y - 1, z); visit(x, y + 1, z); visit(x, y, z - 1); visit(x, y, z + 1)
  }
  const visible = new Map<number, number>(), buried = new Map<number, number>()
  const bump = (m: Map<number, number>, id: number): void => { m.set(id, (m.get(id) ?? 0) + 1) }
  for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
    const id = at(x, y, z)
    if (id === 0) continue
    const seen = ([[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]] as const).some(([dx, dy, dz]) => {
      const n = at(x + dx, y + dy, z + dz)
      return reached[key(x + dx, y + dy, z + dz)] === 1 && (n === 0 || (ct[n] === 1 && n !== id))
    })
    bump(seen ? visible : buried, id)
  }
  return { visible, buried }
}

/** The pass's counts against the direct scan, every kind. */
function matchesScan(b: Uint8Array, around: ReadonlyArray<Uint8Array | null> = []): void {
  const a = assayBlocks(b, around)
  const d = directScan(b, around)
  for (let id = 1; id < 256; id++) {
    expect(a.shown[id]).toBe(d.visible.get(id) ?? 0)
    expect(a.counts[id] - a.shown[id]).toBe(d.buried.get(id) ?? 0)
  }
}

/** The chunk next to BASE at chunk offset (dx, dy, dz), generated. */
const nextDoor = (dx: number, dy: number, dz: number): Uint8Array => generate({ ...BASE, x: BASE.x + 32n * BigInt(dx), y: BASE.y + 32n * BigInt(dy), z: BASE.z + 32n * BigInt(dz) }).blocks

describe('visible or buried, block by block', () => {
  it('the chunk and its 26 neighbours make one 96 by 96 by 96 block, each in its place', () => {
    const b = solid()
    const n = hood((dx, dy, dz) => (dx === 1 && dy === -1 && dz === 0 ? solid(PRISMITE) : null))
    const h = hoodBlocks(b, n)
    expect(h[hoodIndex(0, 0, 0, 5, 6, 7)]).toBe(GRIDSTONE)
    expect(h[hoodIndex(1, -1, 0, 31, 0, 2)]).toBe(PRISMITE)
    expect(h[hoodIndex(-1, 0, 0, 31, 6, 7)]).toBe(0)
  })

  it('per kind, the visible and buried counts match a direct scan of a real generated chunk, alone and with its real neighbours', () => {
    const g = generate(BASE)
    matchesScan(g.blocks)
    matchesScan(g.blocks, hood((dx, dy, dz) => (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1 ? nextDoor(dx, dy, dz) : null)))
    const card = surveyCard(assayBlocks(g.blocks), null)
    for (const r of [...card.finds, ...card.common]) expect(r.visible + r.buried).toBe(r.count)
  })

  it('and with Tidewater, glass, a sealed pocket, and a cave in a neighbour', () => {
    const g = generate(BASE).blocks.slice()
    for (let y = 2; y < 30; y++) g[idx(7, y, 7)] = TIDEWATER
    for (let z = 4; z < 20; z++) g[idx(20, 9, z)] = RIMEGLASS
    for (let y = 12; y <= 14; y++) for (let z = 12; z <= 14; z++) for (let x = 12; x <= 14; x++) g[idx(x, y, z)] = 0
    g[idx(15, 13, 13)] = GLOWCORE
    const n = allSolid()
    const west = n[aroundIndex(-1, 0, 0)]!
    for (let x = 0; x < 32; x++) west[idx(x, 20, 20)] = 0 // a tunnel right through the -x neighbour
    n[aroundIndex(0, 1, 0)] = null // nobody surveyed the chunk above
    matchesScan(g, n)
  })

  it('a block with open space beside it is visible; one walled in on all six sides is buried', () => {
    const b = solid()
    b[idx(10, 10, 10)] = GLOWCORE // buried deep
    b[idx(20, 31, 20)] = PRISMITE // on the top face of the chunk: nobody surveyed the chunk above, so it is open space
    const a = assayBlocks(b)
    expect(a.shown[GLOWCORE]).toBe(0)
    expect(a.shown[PRISMITE]).toBe(1)
    // With every neighbour open space, each Gridstone on the chunk's six faces is seen; the rest are buried.
    expect(a.shown[GRIDSTONE]).toBe(CELLS - 30 * 30 * 30 - 1)
  })

  it('counts each block, not each kind: two of a kind visible and five buried', () => {
    const b = solid()
    for (const x of [3, 6, 9, 12, 15]) b[idx(x, 10, 10)] = GLOWCORE // five deep inside
    b[idx(4, 31, 4)] = GLOWCORE // two on the top face
    b[idx(8, 31, 8)] = GLOWCORE
    const a = assayBlocks(b)
    expect(a.counts[GLOWCORE]).toBe(7)
    expect(a.shown[GLOWCORE]).toBe(2)
    expect(surveyCard(a, facts).finds.find((r) => r.id === GLOWCORE)).toMatchObject({ count: 7, visible: 2, buried: 5 })
  })

  it('a sealed pocket of air is buried; a tunnel from the outside to it makes its walls visible', () => {
    const b = solid()
    for (let y = 9; y <= 11; y++) for (let z = 9; z <= 11; z++) for (let x = 9; x <= 11; x++) b[idx(x, y, z)] = 0
    b[idx(12, 10, 10)] = GLOWCORE // in the pocket's wall
    b[idx(10, 12, 10)] = CINDERROCK // and in its roof
    const a = assayBlocks(b)
    expect(a.shown[GLOWCORE]).toBe(0)
    expect(a.shown[CINDERROCK]).toBe(0)
    expect(surveyCard(a, facts).finds.find((r) => r.id === GLOWCORE)).toMatchObject({ visible: 0, buried: 1 })
    // Dig from the pocket out to the chunk's -x face, where nobody surveyed the next chunk.
    for (let x = 0; x < 9; x++) b[idx(x, 10, 10)] = 0
    const open = assayBlocks(b)
    expect(open.shown[GLOWCORE]).toBe(1)
    expect(open.shown[CINDERROCK]).toBe(1)
  })

  it('a block on the edge is buried against a solid neighbour, and visible where the next chunk is open space', () => {
    const b = solid()
    b[idx(0, 12, 12)] = GLOWCORE
    expect(assayBlocks(b).shown[GLOWCORE]).toBe(1)
    const n = allSolid()
    const a = assayBlocks(b, n)
    expect(a.shown[GLOWCORE]).toBe(0)
    expect(a.shown[GRIDSTONE]).toBe(0)
    // The +x neighbour's facing cell for (31, y, z) is its (0, y, z).
    const c = solid()
    c[idx(31, 2, 3)] = VOIDPEARL
    expect(assayBlocks(c, n).shown[VOIDPEARL]).toBe(0)
    // Open air at the edge with the next chunk solid behind it: a sealed pocket, buried.
    const d = solid()
    d[idx(0, 12, 12)] = 0
    d[idx(1, 12, 12)] = GLOWCORE
    expect(reachOpen(hoodBlocks(d, n))[hoodIndex(0, 0, 0, 0, 12, 12)]).toBe(0)
    expect(assayBlocks(d, n).shown[GLOWCORE]).toBe(0)
  })

  it('a block on the edge beside a cave in the next chunk is visible when the cave reaches the outside, buried when it is closed', () => {
    const b = solid()
    b[idx(0, 12, 12)] = GLOWCORE
    const n = allSolid()
    const west = n[aroundIndex(-1, 0, 0)]!
    west[idx(31, 12, 12)] = 0 // the cell the Glowcore faces
    expect(assayBlocks(b, n).shown[GLOWCORE]).toBe(0)
    // The cave runs on to the -x neighbour's far side, the outside of the 3 by 3 by 3.
    for (let x = 0; x < 31; x++) west[idx(x, 12, 12)] = 0
    expect(assayBlocks(b, n).shown[GLOWCORE]).toBe(1)
    // Or bends up into the chunk above that one, where nobody surveyed.
    for (let x = 0; x < 31; x++) west[idx(x, 12, 12)] = 1
    for (let y = 12; y < 32; y++) west[idx(31, y, 12)] = 0
    n[aroundIndex(-1, 1, 0)] = null
    expect(assayBlocks(b, n).shown[GLOWCORE]).toBe(1)
  })

  it('seen through glass or water that reaches the outside counts as visible; glass beside glass does not', () => {
    const b = solid()
    b[idx(8, 8, 8)] = COBALTINE
    for (let y = 9; y < 32; y++) b[idx(8, y, 8)] = RIMEGLASS // a glass column up to the chunk's top
    b[idx(16, 16, 16)] = FERROVEIN
    for (let z = 17; z < 32; z++) b[idx(16, 16, z)] = TIDEWATER // a run of Tidewater out to the +z face
    b[idx(3, 3, 3)] = RIMEGLASS
    b[idx(3, 3, 4)] = RIMEGLASS
    const a = assayBlocks(b)
    expect(a.shown[COBALTINE]).toBe(1)
    expect(a.shown[FERROVEIN]).toBe(1)
    // Glass beside glass draws no face: only the column's top block shows (open air above it); the rest of the column and the pair at (3, 3, 3), each touching only rock or Rimeglass, are buried.
    expect(a.shown[RIMEGLASS]).toBe(1)
    expect(a.counts[RIMEGLASS] - a.shown[RIMEGLASS]).toBe(22 + 2)
    // Glass closed in by rock: what is behind it is buried.
    const c = solid()
    c[idx(8, 8, 8)] = COBALTINE
    c[idx(8, 9, 8)] = RIMEGLASS
    expect(assayBlocks(c).shown[COBALTINE]).toBe(0)
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
    expect(a.shown[GRIDSTONE]).toBeGreaterThan(0)
    for (const [x, y, z] of [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]] as const) {
      const n = w.slotAt(x, y, z, true)!
      w.setBlocks(n.key, solid(), solid())
    }
    const b = chunkAssay(w, s)!
    expect(b).not.toBe(a)
    expect(b.shown[GRIDSTONE]).toBe(0)
  })

  it('a neighbour across a corner counts again too, and a block mined there changes it', () => {
    const w = field()
    const s = w.slotAt(0, 0, 0)!
    // The six face neighbours solid; a Glowcore on the chunk's edge, seen only through a tunnel in the -x neighbour.
    for (const [x, y, z] of [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]] as const) {
      const n = w.slotAt(x, y, z, true)!
      w.setBlocks(n.key, solid(), solid())
    }
    w.setCs(0, 12, 0, GLOWCORE) // on the chunk's -x and -z edges
    const west = w.slotAt(-1, 0, 0)!
    west.blocks![idx(31, 12, 0)] = 0 // the cell the Glowcore faces
    for (let x = 0; x < 31; x++) west.blocks![idx(x, 12, 0)] = 0 // a tunnel to the -x neighbour's far side
    west.version++
    expect(chunkAssay(w, s)!.shown[GLOWCORE]).toBe(1)
    // Close the tunnel's far end: it still runs along the -z side of that chunk, beside the corner chunk (-1, 0, -1), open space while nobody surveyed it.
    west.blocks![idx(0, 12, 0)] = 1
    west.version++
    expect(chunkAssay(w, s)!.shown[GLOWCORE]).toBe(1)
    const corner = w.slotAt(-1, 0, -1, true)!
    w.setBlocks(corner.key, solid(), solid())
    const walled = chunkAssay(w, s)!
    expect(walled.shown[GLOWCORE]).toBe(0)
    corner.blocks![idx(10, 12, 31)] = 0 // a hole at the corner chunk's +z face, under the tunnel's (10, 12, 0)
    for (let z = 0; z < 31; z++) corner.blocks![idx(10, 12, z)] = 0 // and on out to its -z side
    corner.version++
    const again = chunkAssay(w, s)!
    expect(again).not.toBe(walled)
    expect(again.shown[GLOWCORE]).toBe(1)
  })

  it('a neighbour surveyed but not loaded walls the edge in by the ground it is given', () => {
    const w = field()
    const s = w.slotAt(0, 0, 0)!
    w.setCs(0, 12, 12, GLOWCORE)
    expect(chunkAssay(w, s)!.shown[GLOWCORE]).toBe(1)
    const ground = hood((dx, dy, dz) => (dx === -1 && dy === 0 && dz === 0 ? solid() : null))
    expect(chunkAssay(w, s, ground)!.shown[GLOWCORE]).toBe(0)
    // The same ground again: the kept pass.
    const before = assayRuns()
    chunkAssay(w, s, ground)
    expect(assayRuns()).toBe(before)
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

  it('someone else\'s removals are not yours: only your own blocks are read, never what is there now', () => {
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
    expect(card.finds).toEqual([expect.objectContaining({ id: GLOWCORE, count: 0, mined: 1, visible: 0, buried: 0 })])
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
