/**
 * shardMeshDim.test.tsx: ShardMesh's `dim` (a held item's half, arkinox
 * 2026-11-06) reaches the materials themselves, the shard's and its placed
 * parts' alike, on the see-through world path. Mounted for real: only the
 * canvas is stood in for.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: () => undefined,
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {}, invalidate: () => undefined }),
}))

import { createElement } from 'react'
import { newShard, type ShardModel } from 'sno-core/shards'
import type { Placed } from 'sno-core/parts'
import { mount, type Host } from '../../test/elementRoot'
import { ShardMesh } from '../ShardMesh'
import { SEE_THROUGH_BLEND, TAG_BLEND, TRANSLUCENT_ORDER } from '../shardFaces'

function triangle(name: string): ShardModel {
  return { ...newShard(name), unit: 0, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
}

/** A shard that places one part, the part already resolved (`nested`), so nothing is fetched. */
function withPart(): { shard: ShardModel; nested: Placed[] } {
  const part = { ref: 0, at: [0, 0, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 }
  const ref: ['a', string] = ['a', `33331:${'ab'.repeat(32)}:part`]
  const shard: ShardModel = { ...triangle('Holder'), refs: [ref], parts: [part] }
  return { shard, nested: [{ part, ref, model: triangle('Part'), children: [] } as unknown as Placed] }
}

const faces = (all: Host[]): Host[] => all.filter((h) => h.type === 'meshBasicMaterial')
const lines = (all: Host[]): Host[] => all.filter((h) => h.type === 'lineBasicMaterial')

describe('ShardMesh dim', () => {
  it('draws the shard and its placed part at that share of their own opacity, see-through, after the opaque faces', async () => {
    const { shard, nested } = withPart()
    const m = await mount(createElement(ShardMesh, { shard, nested, world: true, dim: 0.5 }))
    const f = faces(m.all())
    // The holder's faces and the part's.
    expect(f.length).toBeGreaterThanOrEqual(2)
    for (const h of f) {
      expect(h.props.opacity).toBe(0.5)
      expect(h.props.depthWrite).toBe(false)
      expect(h.props).toMatchObject(SEE_THROUGH_BLEND)
    }
    for (const h of lines(m.all())) expect(h.props.opacity).toBeCloseTo(0.5, 9)
    const meshes = m.all().filter((h) => h.type === 'mesh')
    expect(meshes.length).toBeGreaterThanOrEqual(2)
    for (const h of meshes) expect(h.props.renderOrder).toBe(TRANSLUCENT_ORDER)
    await m.unmount()
  })

  it('without it, the very same shard is opaque and tagged, as ever', async () => {
    const { shard, nested } = withPart()
    const m = await mount(createElement(ShardMesh, { shard, nested, world: true }))
    const f = faces(m.all())
    expect(f.length).toBeGreaterThanOrEqual(2)
    for (const h of f) {
      expect(h.props.opacity).toBe(1)
      expect(h.props).toMatchObject(TAG_BLEND)
    }
    await m.unmount()
  })
})
