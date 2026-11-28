/**
 * heldLight.bench.ts - what a glowing block in hand costs each time your eye
 * moves into another cell (scene/heldLight.ts HeldLightDriver), with no
 * browser: `npx vitest bench --run src/lib/__tests__/heldLight.bench.ts`.
 *
 * Each case moves the eye back and forth between two cells, so every call is
 * a relight: read the chunks the cube round the eye overlaps, one flood from
 * the eye, the bytes for the texture. The upload itself (HELD_SIDE cubed
 * texels, 4 bytes each) is the GPU's and is not in it. For comparison, one
 * chunk's own light (light.ts computeLight), which a relight never redoes,
 * and a frame where nothing changed, which is what standing still costs.
 *
 * The ground is revision 3 (DECK-0009 #128, the chunk that grows Glowcore),
 * the same chunk on every side.
 */

import { bench, describe } from 'vitest'
import { CELLS, idx, type ChunkBase } from '../terrain/coords'
import { computeLight, lightTables } from '../terrain/light'
import { B, generate } from '../terrain/generate'
import { heldGlow } from '../terrain/heldLight'
import { HeldLightDriver, type HeldFrame } from '../../scene/heldLight'
import M from './fixtures/deck0009-blocks-vectors.json'

const c = M.revision_3.chunks.find((v) => v.name === 'vent-glowcore-k9')!
const base: ChunkBase = { x: BigInt(c.X), y: BigInt(c.Y), z: BigInt(c.Z), plane: c.plane }
const ground = generate(base, null, 3).blocks
const tables = lightTables()

/** The ground with a mined-out room round the chunk's middle, 9 by 4 by 9, and a tunnel off it, as a player in a cave would have it. */
const cave = ground.slice()
for (let y = 14; y < 18; y++) for (let z = 12; z < 21; z++) for (let x = 12; x < 21; x++) cave[idx(x, y, z)] = 0
for (let x = 21; x < 31; x++) cave[idx(x, 14, 16)] = cave[idx(x, 15, 16)] = 0
const open = new Uint8Array(CELLS)

const world = (b: Uint8Array): HeldFrame['world'] => {
  const slot = { blocks: b, version: 1 }
  return { slotAt: () => slot } as unknown as HeldFrame['world']
}

/** A driver and a frame that flips the eye between two cells each call: every call is a relight. */
function mover(b: Uint8Array, a: readonly [number, number, number], z: readonly [number, number, number]): () => void {
  const d = new HeldLightDriver({ setHeld: () => {} })
  const f: HeldFrame = { world: world(b), version: 1, glow: heldGlow(B.GLOWCORE), shading: true, eye: [a[0], a[1], a[2]] }
  const eye = f.eye as [number, number, number]
  let flip = false
  return () => {
    const at = flip ? z : a
    flip = !flip
    eye[0] = at[0]; eye[1] = at[1]; eye[2] = at[2]
    if (!d.frame(f)) throw new Error('no relight')
  }
}

describe('held light: one cell change', () => {
  bench('in a cave, deep in a chunk (1 chunk read)', mover(cave, [16, 15, 16], [17, 15, 16]))
  bench('in the same ground, at a chunk\'s corner (8 chunks read)', mover(cave, [31, 15, 31], [32, 15, 31]))
  bench('in revision-3 ground as generated (8 chunks read)', mover(ground, [0, 16, 0], [1, 16, 0]))
  bench('in open air, the light\'s full reach (8 chunks read; worst case)', mover(open, [0, 16, 0], [1, 16, 0]))
})

describe('for comparison', () => {
  const around = Array.from({ length: 27 }, () => cave)
  bench('one chunk\'s own light (never redone for the held light)', () => { computeLight(around, null, tables) })
  const d = new HeldLightDriver({ setHeld: () => {} })
  const f: HeldFrame = { world: world(cave), version: 1, glow: heldGlow(B.GLOWCORE), shading: true, eye: [16, 15, 16] }
  d.frame(f)
  bench('a frame with nothing changed (standing still)', () => { if (d.frame(f)) throw new Error('relit') })
})
