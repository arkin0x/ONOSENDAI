/**
 * anim.test.ts: reading `anim` as DECK-0003 §1.14 says (first four entries;
 * malformed, unknown, out of range or faster than one cycle a second
 * ignored; never a throw), every row of the spec's pose vectors at their
 * phases (in the §2 frame, ticks), poses at Unix times (c cycles every b
 * seconds), and the canonical writer (c/b in lowest terms, path weights
 * with no common factor, nothing a reader would ignore).
 */
import { describe, expect, it } from 'vitest'
import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { Matrix4, Vector3 } from 'three'
import { animOf, composeRender, hasAnim, MOTIONS, motionPose, newPose, phaseAt, readAnim, readMotion, withAnim, writeMotion, type Motion } from '../anim'

const m = (raw: unknown): Motion => {
  const r = readMotion(raw)
  if (!r) throw new Error(`unread: ${JSON.stringify(raw)}`)
  return r
}

/** A point (ticks, §2 frame) moved by `anim` at phases `u` (one per motion), through the same matrix the scene uses. */
function drawnAt(anim: unknown[], u: number[], p: [number, number, number]): number[] {
  const motions = readAnim(anim)
  const poses = motions.map((x, i) => motionPose(x, u[i], newPose()))
  const out = new Array<number>(16)
  composeRender(poses, poses.length, out)
  const v = new Vector3(p[0] / 120, p[1] / 120, p[2] / 120).applyMatrix4(new Matrix4().fromArray(out))
  return [v.x * 120, v.y * 120, v.z * 120]
}
/** The same at Unix time t: each motion's phase from t. */
const drawn = (anim: unknown[], t: number, p: [number, number, number]): number[] => drawnAt(anim, readAnim(anim).map((x) => phaseAt(x, t)), p)

const SHUTTLE = ['path', 1, 10, 0, [0, 0, 0, 1], [0, 0, 0, 1], [1920, 0, 0, 2], [1920, 0, 0, 1], [0, 0, 0, 2]]

describe('the motion table', () => {
  it('holds every motion the spec names, in one place', () => {
    expect(Object.keys(MOTIONS).sort()).toEqual(['lift', 'orbit', 'path', 'slide', 'swing', 'turn'])
  })
})

describe('poses at a phase: DECK-0003 §1.14\'s pose vectors (their phases), every row', () => {
  const rows: Array<[unknown[], number[], [number, number, number], [number, number, number]]> = [
    [[['turn', 'y', 1, 1, 0]], [1 / 4], [120, 0, 0], [0, 0, -120]],
    [[['turn', 'y', -1, 1, 0]], [3 / 4], [120, 0, 0], [0, 0, 120]],
    [[['swing', 'x', 60, 1, 25, 0]], [1 / 4], [0, 120, 0], [0, 60, 103.923048]],
    [[['slide', 'y', 240, 1, 4, 90]], [3 / 8], [0, 0, 0], [0, 169.705627, 0]],
    [[['orbit', 'y', 480, 1, 2, 0]], [1 / 4], [120, 0, 0], [600, 0, 0]],
    [[['orbit', 'z', 480, 1, 1, 0]], [1 / 8], [0, 0, 0], [339.411255, 339.411255, 0]],
    [[['lift', 'y', 1440, 25, 1, 1, 0]], [1 / 10], [0, 0, 0], [0, 0, 0]],
    [[['lift', 'y', 1440, 25, 1, 1, 0]], [3 / 8], [0, 0, 0], [0, 720, 0]],
    [[['lift', 'y', 1440, 25, 1, 1, 0]], [3 / 5], [0, 0, 0], [0, 1440, 0]],
    [[['lift', 'y', 1440, 25, 1, 1, 0]], [4 / 5], [0, 0, 0], [0, 1290.24, 0]],
    [[['lift', 'y', -480, 0, 1, 1, 0]], [1 / 8], [0, 0, 0], [0, -75, 0]],
    [[SHUTTLE], [1 / 10], [0, 0, 0], [0, 0, 0]],
    [[SHUTTLE], [1 / 2], [0, 0, 0], [1440, 0, 0]],
    [[SHUTTLE], [9 / 10], [0, 0, 0], [672, 0, 0]],
    [[['turn', 'z', 1, 4, 0], ['slide', 'x', 120, 1, 1, 0]], [5 / 16, 1 / 4], [120, 0, 0], [74.077988, 110.865544, 0]],
    [[['slide', 'x', 120, 1, 1, 0], ['turn', 'z', 1, 4, 0]], [1 / 4, 5 / 16], [120, 0, 0], [-91.844024, 221.731088, 0]],
  ]
  rows.forEach(([anim, u, p, want], i) => {
    it(`row ${i + 1}: ${JSON.stringify(anim).slice(0, 60)} at u ${u.map((x) => x.toFixed(4)).join(', ')}`, () => {
      const got = drawnAt(anim, u, p)
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(want[k], 5)
    })
  })
})

describe('poses at a Unix time: c cycles every b seconds', () => {
  // 2026-11-20 00:00:00 UTC: 1795132800 is a whole number of 20-second cycles.
  const T = 1_795_132_800
  it('a spin of 1 every 20 s: a quarter turn 5 s after a whole cycle', () => {
    expect(T % 20).toBe(0)
    const at = (t: number) => drawn([['turn', 'y', 1, 20, 0]], t, [120, 0, 0])
    const p0 = at(T), p5 = at(T + 5)
    expect(p0[0]).toBeCloseTo(120, 6)
    expect(p5[0]).toBeCloseTo(0, 6)
    expect(p5[2]).toBeCloseTo(-120, 6)
  })
  it('the phase offset and direction', () => {
    expect(phaseAt({ c: 1, b: 20, phi: 90 }, T)).toBeCloseTo(0.25, 9)
    expect(phaseAt({ c: -1, b: 20, phi: 0 }, T + 5)).toBeCloseTo(0.75, 9)
  })
  it('keeps its precision at today\'s Unix time: a millionth of a cycle (a double holds today\'s time to about 0.2 µs)', () => {
    expect(phaseAt({ c: 1, b: 1, phi: 0 }, T + 0.001)).toBeCloseTo(0.001, 6)
    expect(phaseAt({ c: 7, b: 999_983, phi: 0 }, T)).toBeCloseTo((7 * (T % 999_983) % 999_983) / 999_983, 9)
  })
})

describe('reading', () => {
  it('ignores malformed entries, unknown words, out-of-range integers and too-fast rates; keeps the rest; never throws', () => {
    const bad = [
      ['turn', 'w', 1, 1, 0], ['turn', 'y', 1.5, 1, 0], ['turn', 'y', 1, 0, 0], ['turn', 'y', 1, 1, 360], ['turn', 'y', 1, 1],
      ['turn', 'y', 0, 1, 0], ['turn', 'y', 2, 1, 0], ['turn', 'y', 601, 600, 0], ['turn', 'y', 1, 1_000_001, 0], ['turn', 'Y', 1, 1, 0],
      ['swing', 'x', 0, 1, 1, 0], ['swing', 'x', 181, 1, 1, 0], ['slide', 'x', 0, 1, 1, 0], ['slide', 'x', 7681, 1, 1, 0],
      ['orbit', 'y', 0, 1, 1, 0], ['lift', 'y', 0, 10, 1, 1, 0], ['lift', 'y', 10, 50, 1, 1, 0], ['lift', 'y', -7681, 0, 1, 1, 0],
      ['path', 1, 1, 0, [0, 0, 0, 1]], ['path', 1, 1, 0, [0, 0, 0, 0], [1, 1, 1, 1]], ['path', 1, 1, 0, [0, 0, 0, 1001], [1, 1, 1, 1]],
      ['path', 1, 1, 0, [7681, 0, 0, 1], [1, 1, 1, 1]], ['spin', 'y', 1, 1, 0], 'turn', 7, null, {}, [],
    ]
    for (const b of bad) expect(readMotion(b)).toBeNull()
    expect(readAnim([...bad.slice(0, 4), ['turn', 'y', 1, 3, 0]])).toHaveLength(0) // past the fourth entry
    expect(readAnim([bad[0], ['turn', 'y', 1, 3, 0]]).map((x) => x.b)).toEqual([3])
    for (const raw of [undefined, null, 'x', 3, {}, [[]], [[null]]]) expect(readAnim(raw)).toEqual([])
  })

  it('reads the boundary values (at most one cycle a second)', () => {
    for (const ok of [['turn', 'y', 1, 1, 359], ['turn', 'y', -1_000_000, 1_000_000, 0], ['turn', 'y', 600, 600, 0], ['slide', 'z', 7680, 1, 1, 0], ['lift', 'x', -7680, 49, 1, 1, 0],
      ['path', 1, 1, 0, [-7680, 7680, 0, 1000], [0, 0, 0, 1]]]) expect(readMotion(ok)).not.toBeNull()
  })

  it('reads at most the first four entries', () => {
    const five = Array.from({ length: 5 }, (_, i) => ['turn', 'y', 1, i + 1, 0])
    expect(readAnim(five).map((x) => x.b)).toEqual([1, 2, 3, 4])
  })

  it('reads the field from extra (as sno-core carries it), top level first, once per model', () => {
    const s = { ...newShard('t'), extra: { anim: [['turn', 'y', 1, 20, 0]] } } as ShardModel
    expect(hasAnim(s)).toBe(true)
    expect(animOf(s)).toBe(animOf(s))
    expect(hasAnim(newShard('still'))).toBe(false)
    expect(hasAnim({ ...newShard('bad'), extra: { anim: 'spin please' } } as ShardModel)).toBe(false)
  })
})

describe('the phase', () => {
  it('keeps its precision when b divides the height, negative c runs backward, φ offsets', () => {
    const r = m(['turn', 'y', 1, 144, 90])
    expect(phaseAt(r, 144 * 6800)).toBeCloseTo(0.25, 12)
    expect(phaseAt(r, 144 * 6800 + 36)).toBeCloseTo(0.5, 12)
    expect(phaseAt(m(['turn', 'y', -1, 4, 0]), 1)).toBeCloseTo(0.75, 12)
  })
  it('the rest pose (phase 0) of turn, swing, slide and lift is the object as written', () => {
    const list = readAnim([['turn', 'y', 1, 3, 0], ['swing', 'x', 30, 1, 1, 0], ['slide', 'z', 99, 1, 1, 0], ['lift', 'y', 600, 10, 1, 1, 0]])
    const poses = list.map((x) => motionPose(x, 0, newPose()))
    const out = new Array<number>(16)
    composeRender(poses, poses.length, out)
    expect(new Matrix4().fromArray(out).equals(new Matrix4())).toBe(true)
  })
})

describe('writing', () => {
  it('writes canonically: c/b in lowest terms, path weights with no common factor, nothing a reader would ignore', () => {
    expect(writeMotion(m(['turn', 'y', 3, 60, 0]))).toEqual(['turn', 'y', 1, 20, 0])
    expect(writeMotion(m(['turn', 'y', -6, 9, 10]))).toEqual(['turn', 'y', -2, 3, 10])
    expect(writeMotion(m(['path', 2, 4, 0, [0, 0, 0, 2], [10, 0, 0, 4]]))).toEqual(['path', 1, 2, 0, [0, 0, 0, 1], [10, 0, 0, 2]])
    const s = newShard('w')
    const { shard, kept } = withAnim(s, [['turn', 'y', 2, 40, 0], ['bogus', 1], ['turn', 'y', 2, 1, 0], ['slide', 'z', 6, 1, 4, 0]])
    expect(kept).toHaveLength(2)
    expect(shard.extra?.anim).toEqual([['turn', 'y', 1, 20, 0], ['slide', 'z', 6, 1, 4, 0]])
    expect((toPayload(shard) as unknown as Record<string, unknown>).anim).toEqual([['turn', 'y', 1, 20, 0], ['slide', 'z', 6, 1, 4, 0]])
    expect(withAnim(shard, shard.extra?.anim).shard).toBe(shard)
    expect(withAnim(shard, []).shard.extra?.anim).toBeUndefined()
  })
})
