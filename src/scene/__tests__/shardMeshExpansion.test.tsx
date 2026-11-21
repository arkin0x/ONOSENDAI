/**
 * shardMeshExpansion.test.tsx: a drawn shard with face colours does not keep
 * its expanded copy (scene/ShardMesh.tsx).
 *
 * Face colours give every face three corners of its own (sno-core
 * expandFaceColors), as a whole second model of JS objects. ShardMesh kept that
 * copy in a memo for as long as the shard was drawn, about 130 bytes for every
 * corner of every face: in a seeded copy of arkinox's spot it was 496,578 of
 * the heap's 711,990 vertex objects, more than the stores' own models (the
 * world's, the workshop's) put together (2026-11-18). Now it is made, turned
 * into the GPU buffers, and let go; what is drawn is the same.
 */
import { describe, expect, it, vi } from 'vitest'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: () => undefined,
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {}, invalidate: () => undefined }),
}))

// Every expansion made, held weakly, so a test can tell whether anything still holds it.
const made = vi.hoisted(() => [] as Array<WeakRef<object>>)
vi.mock('sno-core/shards', async (real) => {
  const m = await real<typeof import('sno-core/shards')>()
  return {
    ...m,
    expandFaceColors: (s: Parameters<typeof m.expandFaceColors>[0]) => {
      const out = m.expandFaceColors(s)
      if (out !== s) made.push(new WeakRef(out))
      return out
    },
  }
})

import { createElement, useState } from 'react'
import { newShard, type ShardModel } from 'sno-core/shards'
import { mount, settled, type Host } from '../../test/elementRoot'
import { ShardMesh } from '../ShardMesh'

setFlagsFromString('--expose_gc')
const gc = runInNewContext('gc') as () => void

/** Two triangles sharing an edge, each face its own colour: four vertices written, six drawn. */
function painted(name: string): ShardModel {
  return {
    ...newShard(name), unit: 0, mode: 'solid',
    vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }, { p: [1, 1, 0], c: [1, 1, 1] }],
    faces: [[0, 1, 2], [1, 3, 2]],
    facecolors: [[1, 0, 0], [0, 0, 1]],
  }
}

/** The vertex count of the drawn face mesh's position buffer. */
function drawnCorners(all: Host[]): number {
  const mesh = all.find((h) => h.type === 'mesh' && h.props.name === 'shard-faces')
  const g = mesh?.props.geometry as { getAttribute: (n: string) => { count: number } } | undefined
  return g?.getAttribute('position').count ?? -1
}

async function settleGc(): Promise<void> {
  for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 0)); gc() }
}

describe('a shard with face colours, drawn', () => {
  for (const [name, props] of [['in the world', { world: true }], ['as a placed object sharing its buffers', { world: true, placed: true }]] as const) {
    it(`${name}: draws every face with corners of its own, and holds no expanded copy`, async () => {
      made.length = 0
      const shard = painted('Painted')
      const m = await mount(createElement(ShardMesh, { shard, ...props }))
      expect(drawnCorners(m.all())).toBe(6)
      expect(made.length).toBeGreaterThan(0)
      await settleGc()
      // Still on screen, and still drawn from the same six corners.
      expect(drawnCorners(m.all())).toBe(6)
      expect(made.filter((w) => w.deref() !== undefined)).toHaveLength(0)
      await m.unmount()
    })
  }

  it('a fresh copy of the same shard does not build it again; a new paint does', async () => {
    made.length = 0
    const shard = painted('Painted')
    let swap: (next: ShardModel) => void = () => undefined
    function Swapped(): JSX.Element {
      const [s, set] = useState(shard)
      swap = set
      return createElement(ShardMesh, { shard: s, world: true })
    }
    const m = await mount(createElement(Swapped))
    const first = made.length
    const geometry = (): unknown => m.all().find((h) => h.props.name === 'shard-faces')!.props.geometry
    const before = geometry()
    // The same arrays in a new model, as a parent that copies hands it over.
    swap({ ...shard })
    await settled()
    expect(made.length).toBe(first)
    expect(geometry()).toBe(before)
    // A face painted: built again.
    swap({ ...shard, facecolors: [[0, 1, 0], [0, 0, 1]] })
    await settled()
    expect(made.length).toBeGreaterThan(first)
    await m.unmount()
  })
})
