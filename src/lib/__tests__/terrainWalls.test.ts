/**
 * terrainWalls.test.ts - the blocks as WALK's walls (lib/terrain/walls.ts):
 * mining one block makes again only the cubes whose faces it touches, so
 * WALK rebuilds a few walls, not the whole chunk's (review of #916); and the
 * faces follow the change.
 */

import { describe, expect, it } from 'vitest'
import { TerrainWorld } from '../terrain/world'
import { chunkWallItems } from '../terrain/walls'
import { generate } from '../terrain/generate'
import { chunkOf } from '../terrain/coords'
import { EMPTY, solid } from '../terrain/blocks'

const AXES = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as const

describe('the walls of a chunk', () => {
  it('mining one block remakes only the cubes round it, and the rest keep their shards', () => {
    const origin = chunkOf(0x1234560n, 0x2345670n, 0x3456780n, 0)
    const world = new TerrainWorld(origin, AXES as never)
    const slot = world.slotAt(0, 0, 0, true)!
    const g = generate(origin)
    world.setBlocks(slot.key, g.blocks, g.blocks.slice())
    const before = chunkWallItems(world, slot)
    expect(before.length).toBeGreaterThan(8)
    // A solid cell in the middle of a cube (12, 12, 12 is inside cube 1, 1, 1), mined.
    let at: [number, number, number] | null = null
    for (let y = 9; y < 15 && !at; y++) for (let z = 9; z < 15 && !at; z++) for (let x = 9; x < 15 && !at; x++) if (solid(world.blockCs(x, y, z))) at = [x, y, z]
    expect(at).not.toBeNull()
    world.setCs(at![0], at![1], at![2], EMPTY)
    const after = chunkWallItems(world, slot)
    const kept = new Set(before.map((i) => i.shard))
    const remade = after.filter((i) => !kept.has(i.shard))
    // Only the cube holding the cell can change: every other cube keeps its very shard.
    expect(remade.length).toBeLessThanOrEqual(1)
    expect(remade.every((i) => i.key.endsWith(':111'))).toBe(true)
    expect(after.length).toBeGreaterThanOrEqual(before.length - 1)
  })
})
