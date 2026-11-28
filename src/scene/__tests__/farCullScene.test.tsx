/**
 * farCullScene.test.tsx: the size cull in the real scene graph (owner,
 * 2026-11-28: HOP at 2^14 near the Block 101 town crawled).
 *
 * 200 world shards mounted as WorldShards mounts them (PlacedShard, the real
 * ShardMesh, its tap target and wall hint), with FarShardDots running the cull
 * in R3F's own frame loop (test/r3fRoot.ts, no WebGL). A draw call is counted
 * for every mesh, line and points object a renderer would reach: its whole
 * chain visible, its material visible, something in its draw range.
 *
 * - At 2^14 from HOP's farthest orbit the town is a few pixels: under 20 draw
 *   calls with the cull (one: the dots), against 400 without it.
 * - At 2^0 nothing changes: the same draw calls with the cull as without, and
 *   no dots.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

import { createElement } from 'react'
import type { BufferGeometry, Material, Object3D, PerspectiveCamera } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { canonicalQuaternion, viewAxes, type Position } from '../../lib/space'
import { PlacedShard, drawableShards } from '../WorldShards'
import { FarShardDots } from '../FarShardDots'
import { farCull } from '../farCull'

const axes = viewAxes(canonicalQuaternion())
const anchor: Position = { x: 1n << 60n, y: 1n << 60n, z: 1n << 60n }

/** A solid box `extent` units each way, in one colour. */
function box(name: string, extent: number, c: [number, number, number]): ShardModel {
  const vertices: ShardModel['vertices'] = []
  for (const x of [-extent, extent]) for (const y of [-extent, extent]) for (const z of [-extent, extent]) vertices.push({ p: [x, y, z], c })
  const faces: [number, number, number][] = [[0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3], [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6]]
  return { ...newShard(name), unit: 0, extent, mode: i(name) % 3 === 0 ? 'lines' : 'solid', vertices, faces }
}
const i = (name: string): number => Number(name.slice(1))

/** 200 shards over a town 4,096 gibsons across, about a Block 101 hub. */
const town = Array.from({ length: 200 }, (_, n) => {
  const off = (k: number) => BigInt(Math.round(((Math.sin(n * 12.9898 + k * 78.233) * 43758.5453) % 1) * 2048))
  const shard = box(`s${n}`, 2 + (n % 15), [((n * 37) % 255) / 255, ((n * 91) % 255) / 255, 0.5])
  return { key: `k${n}`, type: 'shard' as const, at: { x: anchor.x + off(1), y: anchor.y + off(2), z: anchor.z + off(3) }, height: 8, plane: 0 as const, shard }
})

/** Draw calls a renderer would issue for `root`. */
function drawCalls(root: Object3D): number {
  let n = 0
  root.traverseVisible((o) => {
    const drawable = (o as { isMesh?: boolean }).isMesh || (o as { isPoints?: boolean }).isPoints || (o as { isLine?: boolean }).isLine
    if (!drawable) return
    const mat = (o as { material?: Material | Material[] }).material
    if (mat && !Array.isArray(mat) && mat.visible === false) return
    const geo = (o as { geometry?: BufferGeometry }).geometry
    if (geo && geo.drawRange.count === 0) return
    n++
  })
  return n
}

let r: R3fRoot | null = null
afterEach(async () => { await r?.unmount(); r = null })

/** The town at `scaleExp` with the camera `d` out on +z looking at the render origin, on a 1,080 px tall view; draw calls after a few frames. */
async function hub(scaleExp: number, d: number, cull: boolean): Promise<{ draws: number; shards: number; dots: number }> {
  // HOP's reach at its farthest orbit (buildZoom.ts).
  const placed = drawableShards(town, anchor, 0, scaleExp, axes, 768)
  r = await r3fRoot({ width: 1920, height: 1080 })
  await r.render(createElement('group', null,
    ...placed.map((w) => createElement(PlacedShard, { key: w.key, w, birth: undefined, occludes: true, cull })),
    createElement(FarShardDots)))
  const cam = r.state().camera as PerspectiveCamera
  cam.fov = 55
  cam.position.set(0, 0, d)
  cam.lookAt(0, 0, 0)
  cam.updateProjectionMatrix()
  for (let f = 0; f < 5; f++) await r.frame()
  const out = { draws: drawCalls(r.state().scene), shards: placed.length, dots: farCull.dotCount }
  await r.unmount()
  r = null
  return out
}

describe('a 200-shard hub', () => {
  it('at 2^14 from HOP\'s farthest orbit: under 20 draw calls, against 400 without it', async () => {
    const without = await hub(14, 96, false)
    const withCull = await hub(14, 96, true)
    expect(withCull.shards).toBe(200)
    expect(without.draws).toBeGreaterThanOrEqual(400)
    expect(withCull.draws).toBeLessThan(20)
    expect(withCull.dots).toBeGreaterThan(180)
  })

  it('at 2^0, up close, nothing changes: the same draw calls, and no dots', async () => {
    for (const d of [2, 30, 96]) {
      const without = await hub(0, d, false)
      const withCull = await hub(0, d, true)
      expect(withCull.shards).toBeGreaterThan(0)
      expect(withCull.dots).toBe(0)
      expect(withCull.draws).toBe(without.draws)
    }
  })

  it('its dots go when the scene does, and every shard is shown again', async () => {
    await hub(14, 96, true)
    expect(farCull.entries.length).toBe(0)
    expect(farCull.dotCount).toBe(0)
  })
})
