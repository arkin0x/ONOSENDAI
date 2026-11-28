/**
 * walkTerrainFly.test.ts - TERRAIN's blocks under WALK's movement
 * (lib/terrain/walls.ts, store/walkStep.ts), with GRAVITY off and on
 * (arkinox, 2026-11-28: "When I have gravity off, when I am flying near
 * blocks underneath me, I seem to stick to them and I fall into holes, even
 * though gravity is off"):
 *
 * - gravity off, a gibson over a floor of blocks, a level step keeps its
 *   height: over a hole 1 or 2 deep it does not go down, and a block in the
 *   way holds it at its face instead of lifting it on top;
 * - gravity off, a step down stops on the blocks, never in them;
 * - under gravity the same hole is stepped down into and the block climbed,
 *   as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

import { TerrainWorld, CHUNK_CELLS } from '../../lib/terrain/world'
import { terrainWallItems } from '../../lib/terrain/walls'
import { chunkOf } from '../../lib/terrain/coords'
import type { Position } from '../../lib/space'
import { clearWalls, type WallItem } from '../walkWalls'
import { standing, walkStep } from '../walkStep'

const AXES = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as const
const STONE = 1

/** The floor's blocks are at cs y FLOOR_Y; the walker stands a gibson over them. */
const FLOOR_Y = 10
const STAND_Y = FLOOR_Y + 1

let origin: { x: bigint; y: bigint; z: bigint }

/**
 * One chunk: a floor of blocks along +z at cs y 10, x 4 to 12, with a hole 1
 * deep at z 8 (a block at y 9 under it) and a hole 2 deep at z 11 to 12 (blocks
 * at y 8), and a block standing on the floor at z 15 (y 11).
 */
function field(): WallItem[] {
  const base = chunkOf(0x1234560n, 0x2345670n, 0x3456780n, 0)
  origin = base
  const world = new TerrainWorld(base, AXES as never)
  const slot = world.slotAt(0, 0, 0, true)!
  world.setBlocks(slot.key, new Uint8Array(CHUNK_CELLS), new Uint8Array(CHUNK_CELLS))
  for (let x = 4; x <= 12; x++) {
    for (let z = 2; z <= 20; z++) {
      if (z === 8) world.setCs(x, FLOOR_Y - 1, z, STONE)
      else if (z === 11 || z === 12) world.setCs(x, FLOOR_Y - 2, z, STONE)
      else world.setCs(x, FLOOR_Y, z, STONE)
    }
    world.setCs(x, FLOOR_Y + 1, 15, STONE)
  }
  return terrainWallItems(world)
}

const cs = (x: number, y: number, z: number): Position => ({ x: origin.x + BigInt(x), y: origin.y + BigInt(y), z: origin.z + BigInt(z) })
const csY = (p: Position): number => Number(p.y - origin.y)
const csZ = (p: Position): number => Number(p.z - origin.z)

beforeEach(() => clearWalls())

describe('TERRAIN, gravity off: you fly over the blocks at your height', () => {
  it('a gibson over the floor, you stand there', () => {
    const items = field()
    expect(standing(cs(8, STAND_Y, 4), items)).toBe(true)
  })

  it('over holes 1 and 2 deep, one press at a time or a long press: no descent', () => {
    const items = field()
    let at = cs(8, STAND_Y, 4)
    for (let k = 0; k < 10; k++) {
      const s = walkStep(at, 'z', 1, 1n, items, false)
      expect(csY(s.to)).toBe(STAND_Y)
      at = s.to
    }
    expect(csZ(at)).toBe(14)
    const long = walkStep(cs(8, STAND_Y, 4), 'z', 1, 8n, items, false)
    expect(long.to).toEqual(cs(8, STAND_Y, 12))
  })

  it('a block in the way holds you at its face; Up takes you over it', () => {
    const items = field()
    const s = walkStep(cs(8, STAND_Y, 14), 'z', 1, 1n, items, false)
    expect(s.to).toEqual(cs(8, STAND_Y, 14))
    expect(s.by?.terrain).toBe(true)
    const up = walkStep(cs(8, STAND_Y, 14), 'y', 1, 1n, items, false)
    expect(walkStep(up.to, 'z', 1, 1n, items, false).to).toEqual(cs(8, STAND_Y + 1, 15))
  })

  it('a press down stops on the blocks, never in them', () => {
    const items = field()
    const s = walkStep(cs(8, STAND_Y + 5, 4), 'y', -1, 16n, items, false)
    expect(s.to).toEqual(cs(8, STAND_Y, 4))
    expect(s.by?.terrain).toBe(true)
  })
})

describe('TERRAIN under gravity: the step-up and step-down are as they were', () => {
  it('the hole 1 deep is stepped down into and climbed out of, and the block is climbed', () => {
    const items = field()
    const into = walkStep(cs(8, STAND_Y, 7), 'z', 1, 1n, items, true)
    expect(into.to).toEqual(cs(8, STAND_Y - 1, 8))
    const out = walkStep(into.to, 'z', 1, 1n, items, true)
    expect(out.to).toEqual(cs(8, STAND_Y, 9))
    const onto = walkStep(cs(8, STAND_Y, 14), 'z', 1, 1n, items, true)
    expect(onto.to).toEqual(cs(8, STAND_Y + 1, 15))
  })
})
