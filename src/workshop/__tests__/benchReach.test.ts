import { describe, expect, it } from 'vitest'
import { newShard, TICKS_PER_UNIT, type ShardModel, type Ref } from 'sno-core/shards'
import { refKey } from 'sno-core/parts'
import type { Resolved } from '../../lib/parts'
import { BASE_FAR, BASE_NEAR, MIN_REACH, clipPlanes, fitDistance, nextMaxDistance, reachFor, reachRadius, shardSphere } from '../benchReach'

/** The bench's lens (Bench.tsx Canvas). */
const FOV = 50
/** A desktop window and a phone held upright. */
const DESKTOP = 1280 / 800
const PHONE = 390 / 844

/** A shard with a vertex at each of the given whole-unit points. */
function shardAt(points: Array<[number, number, number]>): ShardModel {
  return { ...newShard('t'), vertices: points.map((p) => ({ p, c: [255, 255, 255] as [number, number, number] })) }
}

/** The half-angle a sphere of `radius` subtends from `distance`, against the narrower half field of view. */
function fits(radius: number, distance: number, fovDeg: number, aspect: number): boolean {
  const v = (fovDeg * Math.PI) / 360
  const half = Math.min(v, Math.atan(Math.tan(v) * aspect))
  return Math.asin(radius / distance) <= half + 1e-12
}

describe('fitDistance (the whole sphere in view)', () => {
  it('fits a sphere top to bottom on a wide screen, by the vertical field of view', () => {
    const d = fitDistance(10, FOV, DESKTOP)
    // A sphere just fits when its radius over the distance is the sine of the half angle; then the margin.
    expect(d).toBeCloseTo((10 / Math.sin((25 * Math.PI) / 180)) * 1.15, 9)
    expect(fits(10, d, FOV, DESKTOP)).toBe(true)
    // With room to spare, not snug: a hair nearer than the margin still fits.
    expect(fits(10, d / 1.1, FOV, DESKTOP)).toBe(true)
  })
  it('fits it across on a phone held upright, where the width is the narrow side', () => {
    const portrait = fitDistance(10, FOV, PHONE)
    const hHalf = Math.atan(Math.tan((25 * Math.PI) / 180) * PHONE)
    expect(portrait).toBeCloseTo((10 / Math.sin(hHalf)) * 1.15, 9)
    expect(portrait).toBeGreaterThan(fitDistance(10, FOV, DESKTOP) * 1.8)
    expect(fits(10, portrait, FOV, PHONE)).toBe(true)
    // At the desktop's distance the phone would cut the sides off.
    expect(fits(10, fitDistance(10, FOV, DESKTOP), FOV, PHONE)).toBe(false)
  })
  it('scales with the radius and is zero for nothing', () => {
    expect(fitDistance(40, FOV, PHONE)).toBeCloseTo(4 * fitDistance(10, FOV, PHONE), 9)
    expect(fitDistance(0, FOV, DESKTOP)).toBe(0)
    expect(fitDistance(-3, FOV, DESKTOP)).toBe(0)
  })
})

describe('reachFor (how far the orbit may pull back)', () => {
  it('keeps the 60 it always was for a small shard, on any screen', () => {
    expect(MIN_REACH).toBe(60)
    expect(reachFor(0, FOV, DESKTOP)).toBe(60)
    expect(reachFor(3, FOV, PHONE)).toBe(60)
    expect(reachFor(8 * Math.sqrt(3), FOV, DESKTOP)).toBe(60)
  })
  it('gives a Maze Kit court room to be seen whole, phone portrait included', () => {
    // basilica-garden-court: 48 units across on two axes and ~11 tall, so about 34 round.
    const radius = Math.hypot(24, 24, 5.5)
    for (const aspect of [DESKTOP, PHONE]) {
      const reach = reachFor(radius, FOV, aspect)
      expect(reach).toBeGreaterThan(60)
      expect(fits(radius, reach, FOV, aspect)).toBe(true)
      expect(reach).toBeGreaterThanOrEqual(fitDistance(radius, FOV, aspect))
    }
    // About 280 on a phone held upright: more than four times the old cap.
    expect(reachFor(radius, FOV, PHONE)).toBeGreaterThan(4 * 60)
    // The widest a shard can be (a 64-unit extent, corner to corner) still fits.
    const widest = 64 * Math.sqrt(3)
    expect(fits(widest, reachFor(widest, FOV, PHONE), FOV, PHONE)).toBe(true)
  })
})

describe('nextMaxDistance (never yanks the camera)', () => {
  it('is the fit while the camera is within it', () => {
    expect(nextMaxDistance(300, 18)).toBe(300)
    expect(nextMaxDistance(60, 60)).toBe(60)
  })
  it('holds at the camera when the shard shrinks under it, and follows it in', () => {
    expect(nextMaxDistance(60, 250)).toBe(250)
    expect(nextMaxDistance(60, 120)).toBe(120)
    expect(nextMaxDistance(60, 40)).toBe(60)
  })
})

describe('clipPlanes (depth for the distance)', () => {
  it('keeps the bench\'s planes for a small shard close up', () => {
    expect(clipPlanes(18, 14)).toEqual({ near: BASE_NEAR, far: BASE_FAR })
    expect(clipPlanes(0.6, 0)).toEqual({ near: BASE_NEAR, far: BASE_FAR })
  })
  it('sees past the far side of a large shard from far off, the near plane out with it', () => {
    const d = 500, r = 40
    const { near, far } = clipPlanes(d, r)
    expect(far).toBeGreaterThan(d + r)
    expect(near).toBeGreaterThan(BASE_NEAR)
    expect(near).toBeLessThan(d - r)
    // Depth precision: the ratio stays near the bench's own 4000, not 100,000.
    expect(far / near).toBeLessThan(4000)
  })
})

describe('shardSphere and reachRadius (what the bench draws, round)', () => {
  const none = new Map<string, Resolved>()
  it('is null for a shard that draws nothing, and a reach of zero', () => {
    expect(shardSphere(newShard('empty'), none)).toBeNull()
    expect(reachRadius(null, { x: 5, y: 5, z: 5 })).toBe(0)
  })
  it('wraps the vertices, Z drawn mirrored', () => {
    // Model Z runs -24..10, so its middle is -7 in the model and +7 as drawn (render Z is model -Z).
    const s = shardSphere(shardAt([[-24, 0, -24], [24, 10, 10]]), none)!
    expect(s.center[0]).toBeCloseTo(0, 9)
    expect(s.center[1]).toBeCloseTo(5, 9)
    expect(s.center[2]).toBeCloseTo(7, 9)
    expect(s.radius).toBeCloseTo(Math.hypot(24, 5, 17), 9)
    // From a target at its centre the reach is its radius; off centre it grows by the offset.
    expect(reachRadius(s, { x: 0, y: 5, z: 7 })).toBeCloseTo(s.radius, 9)
    expect(reachRadius(s, { x: 3, y: 5, z: 11 })).toBeCloseTo(s.radius + 5, 9)
    // But by no more than its own radius, however far off the target is.
    expect(reachRadius(s, { x: 1e6, y: 5, z: 7 })).toBeCloseTo(2 * s.radius, 9)
  })
  it('repeated pans at the limit never push the reach past twice the shard (review of #636)', () => {
    // A phone pinch dollies and pans at once, and a pan moves the target by a
    // share of the camera's distance: at the limit, a long way. Unclamped,
    // the limit grew about 1.34x a pinch without end.
    const s = shardSphere(shardAt([[-24, -5, -24], [24, 6, 24]]), none)!
    const bound = reachFor(2 * s.radius, FOV, PHONE)
    for (const share of [0.1, 0.3, 1]) {
      const target = { x: s.center[0], y: s.center[1], z: s.center[2] }
      let max = reachFor(reachRadius(s, target), FOV, PHONE)
      for (let i = 0; i < 50; i++) {
        // Zoomed all the way out, then a pan of a share of that distance, away from the shard.
        const distance = max
        target.x += distance * share
        max = nextMaxDistance(reachFor(reachRadius(s, target), FOV, PHONE), distance)
        expect(max).toBeLessThanOrEqual(bound + 1e-9)
      }
      expect(max).toBeCloseTo(bound, 6)
    }
  })
  it('takes in a placed object where its placement puts it, scaled as drawn', () => {
    const ref: Ref = ['a', '30001:abc:pillar']
    const pillar: ShardModel = shardAt([[0, 0, 0], [1, 1, 1]])
    const host: ShardModel = {
      ...shardAt([[0, 0, 0], [1, 1, 1]]),
      refs: [ref],
      // Placed 40 units out along X, two steps up (four times the size).
      parts: [{ ref: 0, at: [40 * TICKS_PER_UNIT, 0, 0], turn: [0, 0, 0], step: 2 }],
    }
    const byRef = new Map<string, Resolved>([[refKey(ref), { model: pillar, children: [] }]])
    const s = shardSphere(host, byRef)!
    // The placed pillar runs 40..44 along X: the box is 0..44 on X, 0..4 on Y.
    expect(s.center[0]).toBeCloseTo(22, 9)
    expect(s.radius).toBeGreaterThan(22)
    // Still being fetched it counts as the unit placeholder at its spot, at
    // the placement's scale too: four units, 38..42 along X.
    const waiting = shardSphere(host, none)!
    expect(waiting.center[0]).toBeCloseTo(21, 9)
    expect(waiting.radius).toBeLessThan(s.radius)
  })
  it('a large shard gets a large reach and a small one keeps 60', () => {
    const big = shardSphere(shardAt([[-24, -5, -24], [24, 6, 24]]), none)!
    const small = shardSphere(shardAt([[0, 0, 0], [2, 2, 2]]), none)!
    const at = (s: { center: number[] }): { x: number; y: number; z: number } => ({ x: s.center[0], y: s.center[1], z: s.center[2] })
    expect(reachFor(reachRadius(big, at(big)), FOV, DESKTOP)).toBeGreaterThan(120)
    expect(reachFor(reachRadius(small, at(small)), FOV, DESKTOP)).toBe(60)
    expect(reachFor(reachRadius(small, at(small)), FOV, PHONE)).toBe(60)
  })
})
