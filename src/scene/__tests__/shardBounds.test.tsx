/**
 * shardBounds.test.tsx: a shard's geometry is measured while it holds its
 * final positions (ShardMesh settleBounds). A birth scrambles the shared
 * position buffer for SHARD_DECODE_MS, and three measures a geometry only the
 * first time it is asked: measured mid-scramble, a wall slab's sphere missed
 * part of the finished wall by up to a cell and a half, for good, both for
 * the build dim's ray test and a tap target's box (review of #618).
 */
import { describe, expect, it, vi } from 'vitest'

const frames: Array<(state: unknown) => void> = []
vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: (cb: (state: unknown) => void) => { frames.push(cb) },
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: { getPixelRatio: () => 1 }, invalidate: () => undefined }),
}))

import { createElement } from 'react'
import { Vector3, type BufferGeometry } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { mount, type Host } from '../../test/elementRoot'
import { ShardMesh } from '../ShardMesh'

/** A wall slab 4 wide, 3 tall, 0.2 thick: eight corners, twelve triangles. */
function slab(): ShardModel {
  const vertices: ShardModel['vertices'] = []
  for (const x of [-2, 2]) for (const y of [0, 3]) for (const z of [-0.1, 0.1]) vertices.push({ p: [x, y, z], c: [1, 1, 1] })
  const faces: [number, number, number][] = [[0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3], [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6]]
  return { ...newShard('Slab'), unit: 0, mode: 'solid', vertices, faces }
}

describe('a shard\'s bounds', () => {
  it('are its final shape, measured before a birth scrambles the buffer, and the faces carry those final positions', async () => {
    frames.length = 0
    const m = await mount(createElement(ShardMesh, { shard: slab(), world: true, birth: performance.now() }))
    const faces = m.all().find((h: Host) => h.type === 'mesh')!.props.geometry as BufferGeometry
    const rest = faces.userData.rest as Float32Array
    expect(rest).toBeInstanceOf(Float32Array)
    const finals: Vector3[] = []
    for (let i = 0; i < rest.length; i += 3) finals.push(new Vector3(rest[i], rest[i + 1], rest[i + 2]))
    // One frame of the decode: the live buffer is now scattered.
    for (const f of frames) f({ gl: { getPixelRatio: () => 1 }, size: { height: 800 } })
    const live = faces.attributes.position.array as Float32Array
    let moved = 0
    for (let i = 0; i < rest.length; i++) if (Math.abs(live[i] - rest[i]) > 1e-3) moved++
    expect(moved).toBeGreaterThan(0)
    // The sphere and box were measured at rest, and hold every final corner.
    const sphere = faces.boundingSphere!
    const box = faces.boundingBox!
    for (const v of finals) {
      expect(v.distanceTo(sphere.center)).toBeLessThanOrEqual(sphere.radius + 1e-6)
      expect(box.containsPoint(v)).toBe(true)
    }
    expect(box.min.toArray().map((x) => +x.toFixed(4))).toEqual([-2, 0, -0.1])
    expect(box.max.toArray().map((x) => +x.toFixed(4))).toEqual([2, 3, 0.1])
    await m.unmount()
  })
})
