/**
 * anim.test.ts: reading `anim` (malformed and unknown entries ignored, never
 * a throw), each motion's pose at given phases and at given β, the phase
 * formula against the design note's example, composition order, the render
 * frame, and the canonical writer.
 */
import { describe, expect, it } from 'vitest'
import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { Matrix4, Vector3 } from 'three'
import { animOf, composeRender, hasAnim, MOTIONS, motionPose, newPose, phaseAt, readAnim, readMotion, withAnim, type Motion, type MotionPose } from '../anim'
import { EPOCH_END_TIME, pacedHeight } from '../pacedClock'

const ENDS = [EPOCH_END_TIME, 1_793_300_370]
const NOTE_T = Date.UTC(2026, 10, 10, 4, 11, 2) / 1000

const m = (raw: unknown): Motion => {
  const r = readMotion(raw)
  if (!r) throw new Error(`unread: ${JSON.stringify(raw)}`)
  return r
}
const pose = (raw: unknown, u: number): MotionPose => motionPose(m(raw), u, newPose())

/** A model point (ticks) through composed motions, back in model ticks. */
function apply(motions: Motion[], u: number[], p: [number, number, number]): number[] {
  const poses = motions.map((x, i) => motionPose(x, u[i], newPose()))
  const out = new Array<number>(16)
  composeRender(poses, poses.length, out)
  // Into the render frame (toRender), through, and back.
  const v = new Vector3(p[0] / 120, p[1] / 120, -p[2] / 120).applyMatrix4(new Matrix4().fromArray(out))
  return [v.x * 120, v.y * 120, -v.z * 120].map((x) => Math.round(x * 1e6) / 1e6 + 0)
}

describe('the motion table', () => {
  it('holds every motion the note names, in one place', () => {
    expect(Object.keys(MOTIONS).sort()).toEqual(['lift', 'orbit', 'path', 'slide', 'swing', 'turn'])
  })
})

describe('reading', () => {
  it('reads each shape', () => {
    expect(readAnim([['turn', 'y', 100, 1, 0]])).toHaveLength(1)
    expect(readAnim([['swing', 'x', 60, 30, 1, 0], ['slide', 'z', 720, 4, 1, 90], ['orbit', 'y', 240, 1, 2, 0]])).toHaveLength(3)
    expect(readAnim([['lift', 'y', 1440, 25, 30, 1, 0]])).toHaveLength(1)
    expect(readAnim([['path', 10, 1, 0, [0, 0, 0, 1], [0, 0, 0, 1], [1920, 0, 0, 2], [1920, 0, 0, 1], [0, 0, 0, 2]]])).toHaveLength(1)
  })

  it('ignores malformed entries and unknown words, keeps the rest, never throws', () => {
    const bad = [
      ['turn', 'w', 1, 1, 0], ['turn', 'y', 1.5, 1, 0], ['turn', 'y', 1, 0, 0], ['turn', 'y', 1, 1, 360], ['turn', 'y', 1, 1],
      ['swing', 'x', 0, 1, 1, 0], ['swing', 'x', 181, 1, 1, 0], ['lift', 'y', 10, 50, 1, 1, 0], ['orbit', 'y', -1, 1, 1, 0],
      ['path', 1, 1, 0, [0, 0, 0, 1]], ['path', 1, 1, 0, [0, 0, 0, 0], [1, 1, 1, 1]], ['spin', 'y', 1, 1, 0], 'turn', 7, null, {},
    ]
    for (const b of bad) expect(readMotion(b)).toBeNull()
    expect(readAnim([...bad.slice(0, 4), ['turn', 'y', 3, 1, 0]])).toHaveLength(0) // past the fourth entry
    expect(readAnim([bad[0], ['turn', 'y', 3, 1, 0]]).map((x) => x.c)).toEqual([3])
    for (const raw of [undefined, null, 'x', 3, {}, [[]], [[null]]]) expect(readAnim(raw)).toEqual([])
  })

  it('reads at most the first four entries', () => {
    const five = Array.from({ length: 5 }, (_, i) => ['turn', 'y', i + 1, 1, 0])
    expect(readAnim(five).map((x) => x.c)).toEqual([1, 2, 3, 4])
  })

  it('a rate past 600 cycles per paced block is held at phase 0', () => {
    const fast = m(['turn', 'y', 601, 1, 0])
    expect(fast.tooFast).toBe(true)
    expect(motionPose(fast, 0.3, newPose()).angle).toBe(0)
    expect(m(['turn', 'y', 1200, 2, 0]).tooFast).toBe(false)
  })

  it('reads the field from extra (as sno-core carries it), top level first, once per model', () => {
    const s = { ...newShard('t'), extra: { anim: [['turn', 'y', 30, 1, 0]] } } as ShardModel
    expect(hasAnim(s)).toBe(true)
    expect(animOf(s)).toBe(animOf(s))
    expect(hasAnim(newShard('still'))).toBe(false)
    expect(hasAnim({ ...newShard('bad'), extra: { anim: 'spin please' } } as ShardModel)).toBe(false)
  })
})

describe('the phase', () => {
  it('u = frac(c β / b + φ / 360): the note\'s platform stands at 162.5 degrees', () => {
    const beta = pacedHeight(NOTE_T, ENDS)
    expect(phaseAt(m(['turn', 'y', 100, 1, 0]), beta) * 360).toBeCloseTo(162.4647, 2)
  })
  it('keeps its precision when b divides the height, negative c runs backward, φ offsets', () => {
    const r = m(['turn', 'y', 1, 144, 90])
    expect(phaseAt(r, 144 * 6800)).toBeCloseTo(0.25, 12)
    expect(phaseAt(r, 144 * 6800 + 36)).toBeCloseTo(0.5, 12)
    expect(phaseAt(m(['turn', 'y', -1, 4, 0]), 1)).toBeCloseTo(0.75, 12)
  })
})

describe('each motion\'s pose', () => {
  it('turn: 360 degrees a cycle', () => {
    expect(pose(['turn', 'y', 1, 1, 0], 0.25).angle).toBeCloseTo(Math.PI / 2)
    expect(apply([m(['turn', 'y', 1, 1, 0])], [0.25], [120, 0, 0])).toEqual([0, 0, -120]) // right-handed about +y: +x to -z
  })
  it('swing: reach × sin(2πu)', () => {
    expect(pose(['swing', 'x', 60, 1, 1, 0], 0.25).angle).toBeCloseTo(Math.PI / 3)
    expect(pose(['swing', 'x', 60, 1, 1, 0], 0.75).angle).toBeCloseTo(-Math.PI / 3)
    expect(pose(['swing', 'x', 60, 1, 1, 0], 0.5).angle).toBeCloseTo(0)
  })
  it('slide: reach × sin(2πu) along the axis', () => {
    expect(pose(['slide', 'z', 720, 1, 1, 0], 0.25).t).toEqual([0, 0, 720])
    expect(pose(['slide', 'z', 720, 1, 1, 0], 0.75).t[2]).toBeCloseTo(-720)
  })
  it('orbit: round the axis without turning, starting along the next axis', () => {
    const o = ['orbit', 'y', 240, 1, 1, 0]
    expect(pose(o, 0).t.map((x) => Math.round(x))).toEqual([0, 0, 240])
    expect(pose(o, 0.25).t.map((x) => Math.round(x))).toEqual([240, 0, 0])
    expect(pose(o, 0.25).axis).toBe(-1)
  })
  it('lift: rests, rises eased, rests, comes back (§4.2)', () => {
    const l = ['lift', 'y', 1440, 25, 30, 1, 0]
    expect(pose(l, 0.1).t[1]).toBe(0)
    expect(pose(l, 0.375).t[1]).toBeCloseTo(720)
    expect(pose(l, 0.6).t[1]).toBe(1440)
    expect(pose(l, 0.875).t[1]).toBeCloseTo(720)
    expect(pose(l, 0.999).t[1]).toBeCloseTo(0, 0)
  })
  it('path: linear legs weighted by w, starting at the last waypoint', () => {
    const p = ['path', 10, 1, 0, [0, 0, 0, 1], [0, 0, 0, 1], [1920, 0, 0, 2], [1920, 0, 0, 1], [0, 0, 0, 2]]
    expect(pose(p, 0).t).toEqual([0, 0, 0])
    // Weights 1, 1, 2, 1, 2 of 7: rest at 0 for two sevenths, out over two, rest at 1920 for one, back over two.
    expect(pose(p, 4 / 7).t[0]).toBeCloseTo(1920)
    expect(pose(p, 4.5 / 7).t[0]).toBeCloseTo(1920)
    expect(pose(p, 3 / 7).t[0]).toBeCloseTo(960)
    expect(pose(p, 6 / 7).t[0]).toBeCloseTo(960)
  })
  it('at a given β, through the phase', () => {
    const beta = pacedHeight(NOTE_T, ENDS)
    const turn = m(['turn', 'y', 100, 1, 0])
    expect(motionPose(turn, phaseAt(turn, beta), newPose()).angle * 180 / Math.PI).toBeCloseTo(162.4647, 2)
  })
})

describe('composition', () => {
  it('first innermost: a turn then a slide is not a slide then a turn', () => {
    const turn = m(['turn', 'y', 1, 1, 0]), slide = m(['slide', 'x', 120, 1, 1, 0])
    expect(apply([turn, slide], [0.25, 0.25], [0, 0, 0])).toEqual([120, 0, 0])
    expect(apply([slide, turn], [0.25, 0.25], [0, 0, 0])).toEqual([0, 0, -120])
  })
  it('nothing at phase 0 for the rest-pose shapes: the object as written', () => {
    const list = readAnim([['turn', 'y', 3, 1, 0], ['swing', 'x', 30, 1, 1, 0], ['slide', 'z', 99, 1, 1, 0], ['lift', 'y', 600, 10, 1, 1, 0]])
    expect(apply(list, [0, 0, 0, 0], [37, -5, 12])).toEqual([37, -5, 12])
  })
})

describe('writing', () => {
  it('writes canonically, drops what a reader would ignore, removes an empty list', () => {
    const s = newShard('w')
    const { shard, kept } = withAnim(s, [['turn', 'y', 30, 1, 0], ['bogus', 1], ['slide', 'z', 6, 4, 1, 0]])
    expect(kept).toHaveLength(2)
    expect(shard.extra?.anim).toEqual([['turn', 'y', 30, 1, 0], ['slide', 'z', 6, 4, 1, 0]])
    expect((toPayload(shard) as unknown as Record<string, unknown>).anim).toEqual([['turn', 'y', 30, 1, 0], ['slide', 'z', 6, 4, 1, 0]])
    expect(withAnim(shard, shard.extra?.anim).shard).toBe(shard)
    expect(withAnim(shard, []).shard.extra?.anim).toBeUndefined()
    const path = withAnim(s, [['path', 1, 2, 3, [1, 2, 3, 4], [5, 6, 7, 8]]]).shard
    expect(path.extra?.anim).toEqual([['path', 1, 2, 3, [1, 2, 3, 4], [5, 6, 7, 8]]])
  })
})
