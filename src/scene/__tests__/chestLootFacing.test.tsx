/**
 * chestLootFacing.test.tsx - what floats out of an opened chest lines up
 * across the chest's front and faces it, at every TURN (arkinox, 2026-11-09:
 * "the chest is opened from the front so the items should be in a line facing
 * the front of the chest, not aligned facing one side of the chest").
 *
 * The front is read from the drawn model itself, not from lookFacing: the
 * open TREASURE's lid leans back, so its bounds reach farther behind the
 * chest than in front of it, and the front is the other way. The loot is read
 * from what ChestLoot mounts: the turn of its row and where each object hovers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const frames: Array<(state: unknown, delta: number) => void> = []
vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: (cb: (state: unknown, delta: number) => void) => { frames.push(cb) },
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {}, invalidate: () => undefined }),
}))
vi.mock('../ShardMesh', async () => {
  const { createElement } = await import('react')
  return { CUBE_EDGES: 'outline', ShardMesh: (props: object) => createElement('shardmesh', props) }
})

import { createElement } from 'react'
import { Euler, Vector3 } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { mount, type Host } from '../../test/elementRoot'
import { builtInLook, builtInLookTags, lookFacing, lookOf, type Look } from '../../lib/looks'
import type { LootObject } from '../../lib/lootObjects'
import { ChestLoot, LOOT_ROUND, LOOT_UP } from '../ChestLoot'
import { lookBounds } from '../LookMark'

afterEach(() => { frames.length = 0 })

function cube(name: string): ShardModel {
  return { ...newShard(name), unit: 0, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
}

/** The built-in TREASURE as the hide bar sends it out at a TURN of `quarters` quarter turns about Y, read back as a chest wearing it. */
function treasureAt(quarters: number): Look {
  const tags = builtInLookTags('treasure', { unit: 0, turn: [0, quarters, 0], constrain: 'all' })
  const look = lookOf({ type: 'chest', event: { tags } })
  if (!look?.open) throw new Error('no open look')
  return look
}

/** The open chest's front, from its own points: away from where its lid leans. */
function frontOfModel(open: ShardModel): Vector3 {
  const b = lookBounds(open)
  const lean = new Vector3((b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2)
  expect(lean.length()).toBeGreaterThan(0.1)
  return lean.negate().normalize()
}

const all = (h: Host): Host[] => [h, ...h.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))]

/** Where each loot object hovers in the chest's frame, and which way its front (+Z at rest) points, as ChestLoot mounts them. */
async function mountedRow(n: number, facing: number): Promise<{ at: Vector3[]; faces: Vector3[] }> {
  const loot = Array.from({ length: n }, (_, i) => ({ key: `l${i}`, kind: 'shard', shard: cube(`loot${i}`) })) as unknown as LootObject[]
  const m = await mount(createElement(ChestLoot, { loot, still: true, facing }))
  const root = m.all().find((h: Host) => h.type === 'group') as Host
  const turn = new Euler(...(root.props.rotation as [number, number, number]))
  const homes = (root.children as Host[]).filter((h) => h.type === 'group' && Array.isArray(h.props.position))
  expect(homes.length).toBe(n)
  // Each object's own turn at rest (still): none, so its front is the row's.
  for (const h of homes) expect(all(h).filter((g) => g.props.rotation !== undefined).length).toBe(0)
  const at = homes.map((h) => new Vector3(...(h.props.position as [number, number, number])).applyEuler(turn))
  const faces = homes.map(() => new Vector3(0, 0, 1).applyEuler(turn))
  await m.unmount()
  return { at, faces }
}

describe('the loot row and the chest’s front', () => {
  for (const quarters of [0, 1, 2, 3]) {
    it(`TURN ${quarters * 90}: the row runs across the front, each object faces it, and none touches the open lid`, async () => {
      const look = treasureAt(quarters)
      const front = frontOfModel(look.open!)
      // The TURN reached the drawn model: a quarter of it each step, +Z, -X, -Z, +X (the stored Z is the render frame's negated, so TURN reads the other way round here).
      expect(front.x).toBeCloseTo(-Math.sin((quarters * Math.PI) / 2), 6)
      expect(front.z).toBeCloseTo(Math.cos((quarters * Math.PI) / 2), 6)
      const facing = lookFacing(look)
      for (const n of [3, 4]) {
        const { at, faces } = await mountedRow(n, facing)
        const row = at[n - 1].clone().sub(at[0])
        // Level and across the front: perpendicular to it, and as long as the row.
        expect(Math.abs(row.dot(front))).toBeLessThan(1e-9)
        expect(Math.abs(row.y)).toBeLessThan(1e-9)
        expect(row.length()).toBeGreaterThan(0.5)
        // Forward of the chest's middle, toward the front, never behind it with the lid.
        for (const p of at) expect(p.dot(front)).toBeGreaterThan(0)
        for (const f of faces) {
          expect(f.dot(front)).toBeCloseTo(1, 9)
        }
      }
      // Clear of the open chest as it is drawn at this TURN, in a row of any length (review of the ceremony, #542).
      const b = lookBounds(look.open!)
      for (let n = 1; n <= 9; n++) {
        const { at } = await mountedRow(n, facing)
        at.forEach((p, i) => {
          const dx = Math.max(b.min[0] - p.x, 0, p.x - b.max[0])
          const dz = Math.max(b.min[2] - p.z, 0, p.z - b.max[2])
          const beside = Math.hypot(dx, dz) >= LOOT_ROUND
          const above = p.y - LOOT_UP > b.max[1]
          expect(beside || above, `object ${i} of ${n}`).toBe(true)
        })
      }
    })
  }
})

describe('which way a look faces (lookFacing)', () => {
  it('the built-in TREASURE faces +Z, its lock plate’s side', () => {
    const look = builtInLook('treasure')
    expect(lookFacing(look)).toBe(0)
    expect(frontOfModel(look.open!).z).toBeCloseTo(1, 9)
  })

  it('a look with no notion of a front (an inline model) faces +Z, as TREASURE does', () => {
    expect(lookFacing({ closed: cube('mine'), open: null })).toBe(0)
  })

  it('a TURN that tips the front straight up faces +Z too', () => {
    const tags = builtInLookTags('treasure', { unit: 0, turn: [1, 0, 0], constrain: 'all' })
    expect(lookFacing(lookOf({ type: 'chest', event: { tags } })!)).toBe(0)
  })

  it('a chest on its side faces where its TURN sent its front', () => {
    // X, then Y, then Z: half a turn about Y sends the front to -Z, and a quarter about Z leaves it there, the chest on its side.
    const tags = builtInLookTags('treasure', { unit: 0, turn: [0, 2, 1], constrain: 'all' })
    const look = lookOf({ type: 'chest', event: { tags } })!
    // On its side its height lies along X, so only Z says where the lid leans: to +Z, the front the other way.
    const b = lookBounds(look.open!)
    expect((b.min[2] + b.max[2]) / 2).toBeGreaterThan(0.1)
    expect(Math.cos(lookFacing(look))).toBeCloseTo(-1, 9)
  })
})
