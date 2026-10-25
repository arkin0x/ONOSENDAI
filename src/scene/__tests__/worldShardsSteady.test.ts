/**
 * A move keeps every shard's cut (arkinox, 2026-10-23: "I'm getting some
 * freezes intermittently while just navigating through onosendai").
 *
 * Each WALK step, landed HOP or spectated jump moves the anchor, and the
 * world placed its shards again. placeShard made a new clip box and a new
 * pose for every shard, equal in value to the last ones, and ShardMesh keys
 * its cut and every GPU buffer on those objects: every shard in reach was cut
 * and uploaded again on every step (about 110 buffers a step among Maze Kit
 * rooms, 150 to 450 ms of main thread). These pin that the box and the pose
 * do not depend on the anchor, and that steadied hands back the very objects
 * from last time while they are the same in value.
 */
import { describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { canonicalQuaternion, rotateView, viewAxes, type Position, type RotateDirection } from '../../lib/space'
import { placeShard, samePose, sameBox, steadied, type PlacedShardDraw } from '../WorldShards'

const at: Position = { x: 1000n, y: 2000n, z: 3000n }
const shard: ShardModel = { ...newShard('room'), unit: 0 }
const axes = viewAxes(canonicalQuaternion())
const TURN: RotateDirection = 'left'
const item = { key: 'k', at, height: 6, plane: 0 as const, shard }

function placedFrom(anchor: Position): PlacedShardDraw {
  return placeShard(item, anchor, 0, axes)
}

describe('placing a shard again after a move', () => {
  it('gives a box and a pose equal in value, but new objects', () => {
    const a = placedFrom({ x: 990n, y: 2000n, z: 3000n })
    const b = placedFrom({ x: 991n, y: 2000n, z: 3000n })
    expect(b.centre).not.toEqual(a.centre)
    expect(sameBox(a.clip, b.clip)).toBe(true)
    expect(samePose(a.pose, b.pose)).toBe(true)
    expect(b.clip).not.toBe(a.clip)
  })
})

describe('steadied', () => {
  it('keeps the very box and pose objects across a move, so ShardMesh cuts nothing again', () => {
    const first = steadied(new Map(), [placedFrom({ x: 990n, y: 2000n, z: 3000n })])
    let kept = new Map(first.map((w) => [w.key, w]))
    // A hundred steps along x.
    for (let i = 1; i <= 100; i++) {
      const now = steadied(kept, [placedFrom({ x: 990n + BigInt(i), y: 2000n, z: 3000n })])
      expect(now[0].clip).toBe(first[0].clip)
      expect(now[0].pose).toBe(first[0].pose)
      expect(now[0].centre[0]).toBeCloseTo(first[0].centre[0] - i)
      kept = new Map(now.map((w) => [w.key, w]))
    }
  })

  it('takes the new box and pose when they really change: the view turns, or the shard is another', () => {
    const before = steadied(new Map(), [placedFrom(at)])
    const kept = new Map(before.map((w) => [w.key, w]))
    const turned = placeShard(item, at, 0, viewAxes(rotateView(canonicalQuaternion(), TURN)))
    // A quarter turn of the view turns the box and the pose with it.
    expect(sameBox(turned.clip, before[0].clip)).toBe(false)
    expect(samePose(turned.pose, before[0].pose)).toBe(false)
    const after = steadied(kept, [turned])
    expect(after[0].clip).toBe(turned.clip)
    expect(after[0].pose).toBe(turned.pose)
    const other = { ...shard }
    const swapped = steadied(kept, [placeShard({ ...item, shard: other }, at, 0, axes)])
    expect(swapped[0].clip).not.toBe(before[0].clip)
  })
})
