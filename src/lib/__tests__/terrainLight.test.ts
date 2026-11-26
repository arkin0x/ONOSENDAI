/**
 * terrainLight.test.ts - Block shading's light (lib/terrain/light.ts): the
 * corners and creases its texels darken (ambient occlusion), how open light
 * and block light spread and fall off, which chunks an edit relights, and
 * that the same blocks give the same bytes every time.
 */

import { describe, expect, it } from 'vitest'
import { CELLS, idx } from '../terrain/coords'
import { aroundIndex, computeLight, cornerLight, cornerOpen, EMIT, FOOT, lightAt, lightReaches, lightTables, LIGHT_BYTES, shadedColumns, type Around } from '../terrain/light'
import { generate } from '../terrain/generate'
import { handleBlocks } from '../terrain/blocksJob'
import { TerrainWorld } from '../terrain/world'
import { meshChunk, FLOATS_PER_VERTEX } from '../terrain/mesh'
import { tileTable } from '../terrain/blocks'

const STONE = 1
const GLOWCORE = 42
const tables = lightTables()

/** Only the middle chunk surveyed; the rest open space. */
const alone = (blocks: Uint8Array): Around => Array.from({ length: 27 }, (_, i) => (i === aroundIndex(0, 0, 0) ? blocks : null))
const solidChunk = (): Uint8Array => new Uint8Array(CELLS).fill(STONE)

describe('ambient occlusion at a face corner', () => {
  // A stone floor at y = 10 under open space: the +y face of the floor cell (10, 10, 10).
  const floor = (): Uint8Array => { const b = new Uint8Array(CELLS); for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) b[idx(x, 10, z)] = STONE; return b }
  const TOP = 3
  const corner = (b: Uint8Array): number => cornerOpen(computeLight(alone(b), null, tables), [10, 10, 10], TOP, [1, 1])

  it('reads fully open on an open floor', () => {
    expect(corner(floor())).toBe(1)
  })

  it('darkens a quarter for each solid cell round the corner: one side, two sides, two sides and the corner between', () => {
    const one = floor(); one[idx(11, 11, 10)] = STONE
    const two = floor(); two[idx(11, 11, 10)] = STONE; two[idx(10, 11, 11)] = STONE
    const three = floor(); three[idx(11, 11, 10)] = STONE; three[idx(10, 11, 11)] = STONE; three[idx(11, 11, 11)] = STONE
    const diagonal = floor(); diagonal[idx(11, 11, 11)] = STONE
    expect(corner(one)).toBe(0.75)
    expect(corner(two)).toBe(0.5)
    expect(corner(three)).toBe(0.25)
    // The diagonal alone darkens as one side does: open > one side or the diagonal > two sides > a closed corner.
    expect(corner(diagonal)).toBe(0.75)
  })

  it('leaves the corners away from the wall untouched', () => {
    const one = floor(); one[idx(11, 11, 10)] = STONE
    const light = computeLight(alone(one), null, tables)
    expect(cornerOpen(light, [10, 10, 10], TOP, [0, 0])).toBe(1)
    expect(cornerOpen(light, [10, 10, 10], TOP, [0, 1])).toBe(1)
    expect(cornerOpen(light, [10, 10, 10], TOP, [1, 0])).toBe(0.75)
  })

  it('keeps a solid cell at 0, so its light is the open cells\' alone', () => {
    const one = floor(); one[idx(11, 11, 10)] = STONE
    const light = computeLight(alone(one), null, tables)
    expect(lightAt(light, 11, 11, 10)).toEqual([0, 0, 0])
    // The corner by the wall reads the open cells' full light, darkened only by the share of open cells (AO).
    expect(cornerLight(light, [10, 10, 10], TOP, [1, 1])).toEqual([15, 15, 15])
  })

  it('lets no light through a one-block wall: a dark cave beside a lit shaft stays dark at the wall\'s foot', () => {
    // Solid rock; a shaft open to the top at x = 10; a sealed cave at x = 12..20 on the far side of a 1 block wall (x = 11).
    const b = solidChunk()
    for (let y = 5; y < 32; y++) b[idx(10, y, 16)] = 0
    for (let y = 6; y <= 8; y++) for (let z = 14; z <= 18; z++) for (let x = 12; x <= 20; x++) b[idx(x, y, z)] = 0
    const light = computeLight(alone(b), null, tables)
    expect(lightAt(light, 10, 6, 16)[0]).toBe(15)
    expect(lightAt(light, 12, 6, 16)[0]).toBe(0)
    // The cave floor's corner against the wall: the wall cell sits between the shaft and the cave, and must not bring the shaft's light in.
    expect(cornerLight(light, [12, 5, 16], TOP, [0, 0])).toEqual([0, 0, 0])
  })
})

describe('open light', () => {
  it('lights open space outside the ground, and every column open to the top', () => {
    const b = new Uint8Array(CELLS)
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) b[idx(x, 0, z)] = STONE
    const light = computeLight(alone(b), null, tables)
    expect(lightAt(light, 16, 1, 16)).toEqual([15, 15, 15])
    expect(lightAt(light, 16, 31, 16)).toEqual([15, 15, 15])
    expect(lightAt(light, -1, 5, 5)).toEqual([15, 15, 15])
  })

  it('falls by one a block down a sealed tunnel from its mouth, to dark', () => {
    // Solid rock with a 1 by 1 tunnel along +x from the chunk's -x face (open space beyond).
    const b = solidChunk()
    for (let x = 0; x <= 24; x++) b[idx(x, 16, 16)] = 0
    const light = computeLight(alone(b), null, tables)
    for (let x = 0; x <= 24; x++) expect(lightAt(light, x, 16, 16)[0]).toBe(Math.max(0, 14 - x))
  })

  it('stays full down a shaft open to the top, however deep', () => {
    const b = solidChunk()
    for (let y = 2; y < 32; y++) b[idx(16, y, 16)] = 0
    const light = computeLight(alone(b), null, tables)
    expect(lightAt(light, 16, 2, 16)[0]).toBe(15)
  })

  it('is shaded by a block in a chunk higher up (skyTop), and spreads from the side instead', () => {
    const b = solidChunk()
    for (let y = 2; y < 32; y++) b[idx(16, y, 16)] = 0
    const skyTop = new Uint8Array(FOOT * FOOT).fill(1)
    skyTop[(32 + 16) + FOOT * (32 + 16)] = 0
    const light = computeLight(alone(b), skyTop, tables)
    // The shaft's top opens on open space above the chunk (lit, not shaded at its own column's sides): 14 at the top cell, one less a block down.
    expect(lightAt(light, 16, 31, 16)[0]).toBe(14)
    expect(lightAt(light, 16, 25, 16)[0]).toBe(8)
    expect(lightAt(light, 16, 2, 16)[0]).toBe(0)
  })
})

describe('block light', () => {
  it('spreads from a glowing block in its colour, one level a block', () => {
    // A sealed chamber in solid rock (no open light), Glowcore in its middle.
    const b = solidChunk()
    for (let y = 8; y <= 24; y++) for (let z = 8; z <= 24; z++) for (let x = 8; x <= 24; x++) b[idx(x, y, z)] = 0
    b[idx(16, 16, 16)] = GLOWCORE
    const light = computeLight(alone(b), null, tables)
    const e = EMIT.Glowcore
    expect(e.color).toBe('#00e5ff')
    // Cyan: no red; blue starts at the full level next to it, falling a level a block.
    for (let k = 1; k <= 8; k++) {
      const [r, g, bl] = lightAt(light, 16 + k, 16, 16)
      expect(r).toBe(0)
      expect(bl).toBe(e.level - k)
      expect(g).toBe(Math.max(0, Math.round((e.level * 0xe5) / 0xff) - k))
    }
    // Round a corner it is the path, not the straight line, that counts.
    expect(lightAt(light, 16 + 3, 16 + 3, 16)[2]).toBe(e.level - 6)
  })

  it('takes the brighter of open light and block light in each colour', () => {
    const b = new Uint8Array(CELLS)
    b[idx(16, 16, 16)] = GLOWCORE
    const light = computeLight(alone(b), null, tables)
    expect(lightAt(light, 17, 16, 16)).toEqual([15, 15, 15])
  })
})

describe('determinism', () => {
  const base = { x: 0x18245bab1fdb4289a1f6c0n, y: 0x10be168df55e6cda81ab40n, z: 0x16d50d3036622d54671e60n, plane: 0 }
  const around: Around = (() => {
    const a: Array<Uint8Array | null> = []
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      a[aroundIndex(dx, dy, dz)] = dx === 1 && dz === 1 ? null : generate({ x: base.x + BigInt(32 * dx), y: base.y + BigInt(32 * dy), z: base.z + BigInt(32 * dz), plane: 0 }).blocks
    }
    return a
  })()

  it('gives the same bytes for the same blocks, whatever was worked out before', () => {
    const first = computeLight(around, null, tables).slice()
    computeLight(alone(solidChunk()), null, tables)
    const again = computeLight(around, null, tables)
    expect(again.length).toBe(LIGHT_BYTES)
    expect(Buffer.from(again).equals(Buffer.from(first))).toBe(true)
  })

  it('gives the worker answer the page would work out', () => {
    const direct = computeLight(around, null, tables).slice()
    const { answer } = handleBlocks({ type: 'light', id: 1, around: around.map((b) => (b ? b.slice() : null)), skyTop: null })
    expect(answer.type).toBe('light')
    if (answer.type === 'light') expect(Buffer.from(answer.light).equals(Buffer.from(direct))).toBe(true)
  })
})

describe('a localized relight on edit', () => {
  const origin = { x: 0x249e0397002d8eb597a00n & ~31n, y: 0x1653481cb2996614f9e720n & ~31n, z: 0x16780c2d50019df765df00n & ~31n, plane: 0 }
  const AXES = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
  /** A 3 by 3 by 3 world of generated ground, every chunk's light worked out and marked clean. */
  function world(): TerrainWorld {
    const w = new TerrainWorld(origin, AXES as never)
    for (let cz = -1; cz <= 1; cz++) for (let cy = -1; cy <= 1; cy++) for (let cx = -1; cx <= 1; cx++) {
      const slot = w.slotAt(cx, cy, cz, true)!
      const g = generate(slot.base).blocks
      w.setBlocks(slot.key, g, g.slice())
    }
    return w
  }
  const shaded = (s: { blocks: Uint8Array | null }): Uint8Array => shadedColumns(s.blocks!, tables.pass)
  const lightOf = (w: TerrainWorld, s: ReturnType<TerrainWorld['slotAt']>): Uint8Array => { const { around, skyTop } = w.lightInputs(s!, shaded); return computeLight(around, skyTop, tables).slice() }

  it('marks only the chunks a change can reach: the column of a mid-chunk edit, not its neighbours', () => {
    const w = world()
    for (const s of w.slots) s.lightDirty = false
    // The middle of the middle chunk, cs offset (16, 16, 16).
    expect(w.setCs(16, 16, 16, w.blockCs(16, 16, 16) ? 0 : STONE)).not.toBeNull()
    const marked = w.slots.filter((s) => s.lightDirty).map((s) => s.off.join(',')).sort()
    // Itself and the chunk under it (light falls down the column); not the one above (17 blocks up), not beside it (16 across).
    expect(marked).toEqual(['0,-1,0', '0,0,0'])
  })

  it('relights every chunk whose light the edit changed, and the light it leaves alone is the same as a full relight', () => {
    const w = world()
    const before = new Map(w.slots.map((s) => [s.off.join(','), lightOf(w, s)]))
    for (const s of w.slots) s.lightDirty = false
    // Edits near a corner of the middle chunk, where they reach across: a room dug out, a Glowcore in it.
    for (let y = 26; y < 32; y++) for (let z = 26; z < 32; z++) for (let x = 26; x < 32; x++) w.setCs(x, y, z, 0)
    w.setCs(28, 28, 28, GLOWCORE)
    let changed = 0
    for (const s of w.slots) {
      const after = lightOf(w, s)
      const same = Buffer.from(after).equals(Buffer.from(before.get(s.off.join(','))!))
      if (!same) { changed++; expect(s.lightDirty, `chunk ${s.off.join(',')} changed but was not marked`).toBe(true) }
    }
    expect(changed).toBeGreaterThan(1)
    // Far chunks stay clean.
    expect(w.slotAt(-1, 0, -1)!.lightDirty).toBe(false)
  })

  it('says how far a change reaches: 15 blocks across and below, any distance above', () => {
    expect(lightReaches([0, 0, 0], 5, 5, 5)).toBe(true)
    expect(lightReaches([1, 0, 0], 16, 5, 5)).toBe(false)
    expect(lightReaches([1, 0, 0], 17, 5, 5)).toBe(true)
    expect(lightReaches([0, 1, 0], 5, 16, 5)).toBe(false)
    expect(lightReaches([0, 1, 0], 5, 17, 5)).toBe(true)
    expect(lightReaches([0, -3, 0], 5, 0, 5)).toBe(true)
  })

  it('reaches exactly 15 blocks: Magmaflow 14 or 15 off changes a chunk\'s light and marks it; 16 or 17 off changes nothing', () => {
    // A world of solid rock (no light anywhere), a tunnel through the middle chunk toward the target, Magmaflow (level 15) put in it.
    const MAGMA = 12
    for (const [d, axis] of [[[1, 0, 0], 0], [[0, 1, 0], 1]] as const) {
      const w = new TerrainWorld(origin, AXES as never)
      for (let cz = -1; cz <= 1; cz++) for (let cy = -1; cy <= 1; cy++) for (let cx = -1; cx <= 1; cx++) {
        const slot = w.slotAt(cx, cy, cz, true)!
        w.setBlocks(slot.key, solidChunk(), solidChunk())
      }
      for (let k = 0; k < 32; k++) { const c = [16, 16, 16]; c[axis] = k; w.setCs(c[0], c[1], c[2], 0) }
      const target = w.slotAt(d[0], d[1], d[2])!
      for (const v of [15, 16, 17, 18]) {
        const cell = [16, 16, 16]
        cell[axis] = v
        for (const sl of w.slots) sl.lightDirty = false
        const before = lightOf(w, target)
        w.setCs(cell[0], cell[1], cell[2], MAGMA)
        const after = lightOf(w, target)
        const changed = !Buffer.from(after).equals(Buffer.from(before))
        // v is 32 - v blocks from the target's wall: 17 and 18 within 15, 15 and 16 not.
        expect(changed, `Magmaflow at ${v} on axis ${axis}`).toBe(v >= 17)
        expect(target.lightDirty, `marked at ${v} on axis ${axis}`).toBe(v >= 17)
        w.setCs(cell[0], cell[1], cell[2], 0)
      }
    }
  })

  it('a chunk let go relights the neighbours that read it', () => {
    const w = world()
    for (const s of w.slots) s.lightDirty = false
    w.drop(w.slotAt(1, 0, 0)!)
    expect(w.slotAt(0, 0, 0)!.lightDirty).toBe(true)
    expect(w.slotAt(-1, 0, 0)!.lightDirty).toBe(false)
  })
})

describe('the mesh tells the material which way each face looks', () => {
  it('writes the face, 0 to 5, -x +x -y +y -z +z, in each vertex', () => {
    const b = new Uint8Array(CELLS)
    b[idx(5, 6, 7)] = STONE
    const m = meshChunk(b, [null, null, null, null, null, null], tileTable())
    const faces = new Set<number>()
    for (let v = 0; v < m.vertices.length / FLOATS_PER_VERTEX; v++) faces.add(m.vertices[v * FLOATS_PER_VERTEX + 4])
    expect([...faces].sort()).toEqual([0, 1, 2, 3, 4, 5])
  })
})
