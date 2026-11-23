/**
 * anim.test.ts: reading `anim` as DECK-0003 §1.14 says (first four entries;
 * malformed, unknown, out of range or faster than two cycles a second
 * ignored; never a throw), every one of the spec's 19 vectors at their Unix
 * times (in the §2 frame, ticks), and the canonical writer (c/b in lowest terms, path weights
 * with no common factor, nothing a reader would ignore).
 */
import { describe, expect, it } from 'vitest'
import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { Matrix4, Vector3 } from 'three'
import { animOf, composeRender, hasAnim, MOTIONS, motionPose, newPose, phaseAt, REACH, readAnim, readMotion, withAnim, writeMotion, type Motion } from '../anim'

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

const T0 = 1_795_132_800
const SHUTTLE = ['path', 1, 60, 0, [0, 0, 0, 2], [1920, 0, 0, 2], [1920, 0, 0, 1], [0, 0, 0, 2]]

describe('the motion table', () => {
  it('holds every motion the spec names, in one place', () => {
    expect(Object.keys(MOTIONS).sort()).toEqual(['lift', 'orbit', 'path', 'slide', 'swing', 'turn'])
  })
})

describe('DECK-0003 §1.14\'s vectors (as merged, cyberspace ce3f9482), every row: poses at Unix times', () => {
  const rows: Array<[unknown[], number, [number, number, number], [number, number, number]]> = [
    [[['turn', 'y', 1, 6, 0]], T0 + 1.5, [120, 0, 0], [0, 0, -120]],
    [[['turn', 'y', -1, 6, 0]], T0 + 1.5, [120, 0, 0], [0, 0, 120]],
    [[['turn', 'y', 2, 1, 0]], T0 + 0.125, [120, 0, 0], [0, 0, -120]],
    [[['turn', 'y', 1, 31536000, 0]], T0, [120, 0, 0], [106.328475, 0, 55.626033]],
    [[['turn', 'y', 7, 90, 30]], 1795171234.567, [120, 0, 0], [-111.164515, 0, -45.19348]],
    [[['swing', 'x', 60, 1, 2, 0]], T0 + 0.5, [0, 120, 0], [0, 60, 103.923048]],
    [[['slide', 'y', 240, 1, 4, 90]], T0 + 0.5, [0, 0, 0], [0, 169.705627, 0]],
    [[['orbit', 'y', 480, 1, 8, 0]], T0 + 2, [120, 0, 0], [600, 0, 0]],
    [[['orbit', 'z', 480, 1, 8, 0]], T0 + 1, [0, 0, 0], [339.411255, 339.411255, 0]],
    [[['lift', 'y', 1440, 25, 1, 20, 0]], T0 + 2, [0, 0, 0], [0, 0, 0]],
    [[['lift', 'y', 1440, 25, 1, 20, 0]], T0 + 7.5, [0, 0, 0], [0, 720, 0]],
    [[['lift', 'y', 1440, 25, 1, 20, 0]], T0 + 12, [0, 0, 0], [0, 1440, 0]],
    [[['lift', 'y', 1440, 25, 1, 20, 0]], T0 + 16, [0, 0, 0], [0, 1290.24, 0]],
    [[['lift', 'y', -480, 0, 1, 8, 0]], T0 + 1, [0, 0, 0], [0, -75, 0]],
    [[SHUTTLE], T0 + 6, [0, 0, 0], [0, 0, 0]],
    [[SHUTTLE], T0 + 30, [0, 0, 0], [1440, 0, 0]],
    [[SHUTTLE], T0 + 54, [0, 0, 0], [672, 0, 0]],
    [[['turn', 'z', 1, 8, 0], ['slide', 'x', 120, 1, 2, 0]], T0 + 2.5, [120, 0, 0], [74.077988, 110.865544, 0]],
    [[['slide', 'x', 120, 1, 2, 0], ['turn', 'z', 1, 8, 0]], T0 + 2.5, [120, 0, 0], [-91.844024, 221.731088, 0]],
  ]
  it('has all 19 rows', () => expect(rows).toHaveLength(19))
  rows.forEach(([anim, t, p, want], i) => {
    it(`row ${i + 1}: ${JSON.stringify(anim).slice(0, 60)} at t ${t}`, () => {
      expect(readAnim(anim)).toHaveLength(anim.length)
      const got = drawn(anim, t, p)
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(want[k], 4)
    })
  })
  it('the year-long turn\'s phase is 337/365 at T0, and the odd moment\'s 39469/90000', () => {
    expect(phaseAt({ c: 1, b: 31_536_000, phi: 0 }, T0)).toBeCloseTo(337 / 365, 9)
    expect(phaseAt({ c: 7, b: 90, phi: 30 }, 1795171234.567)).toBeCloseTo(39469 / 90000, 6)
  })
})

describe('reading', () => {
  it('ignores malformed entries, unknown words, out-of-range integers and too-fast rates; keeps the rest; never throws', () => {
    const bad = [
      ['turn', 'w', 1, 1, 0], ['turn', 'y', 1.5, 1, 0], ['turn', 'y', 1, 0, 0], ['turn', 'y', 1, 1, 360], ['turn', 'y', 1, 1],
      ['turn', 'y', 0, 1, 0], ['turn', 'y', 3, 1, 0], ['turn', 'y', 1201, 600, 0], ['turn', 'y', 1, 31_536_001, 0], ['turn', 'Y', 1, 1, 0],
      ['swing', 'x', 0, 1, 1, 0], ['swing', 'x', 181, 1, 1, 0], ['slide', 'x', 0, 1, 1, 0], ['slide', 'x', REACH + 1, 1, 1, 0],
      ['orbit', 'y', 0, 1, 1, 0], ['lift', 'y', 0, 10, 1, 1, 0], ['lift', 'y', 10, 50, 1, 1, 0], ['lift', 'y', -REACH - 1, 0, 1, 1, 0],
      ['path', 1, 1, 0, [0, 0, 0, 1]], ['path', 1, 1, 0, [0, 0, 0, 0], [1, 1, 1, 1]], ['path', 1, 1, 0, [0, 0, 0, 1001], [1, 1, 1, 1]],
      ['path', 1, 1, 0, [REACH + 1, 0, 0, 1], [1, 1, 1, 1]], ['spin', 'y', 1, 1, 0], 'turn', 7, null, {}, [],
    ]
    for (const b of bad) expect(readMotion(b)).toBeNull()
    expect(readAnim([...bad.slice(0, 4), ['turn', 'y', 1, 3, 0]])).toHaveLength(0) // past the fourth entry
    expect(readAnim([bad[0], ['turn', 'y', 1, 3, 0]]).map((x) => x.b)).toEqual([3])
    for (const raw of [undefined, null, 'x', 3, {}, [[]], [[null]]]) expect(readAnim(raw)).toEqual([])
  })

  it('reads the boundary values (at most two cycles a second, b up to a year)', () => {
    for (const ok of [['turn', 'y', 2, 1, 359], ['turn', 'y', -63_072_000, 31_536_000, 0], ['turn', 'y', 1200, 600, 0], ['turn', 'y', 1, 31_536_000, 0], ['slide', 'z', REACH, 1, 1, 0], ['slide', 'z', 7681, 1, 1, 0], ['lift', 'x', -7680, 49, 1, 1, 0],
      ['path', 1, 1, 0, [-REACH, REACH, 0, 1000], [0, 0, 0, 1]]]) expect(readMotion(ok)).not.toBeNull()
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
  it('keeps its precision when b divides the time, negative c runs backward, φ offsets', () => {
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
    // A swing or a slide is written with a positive c: a negative c is the same motion at phase (180 − φ) mod 360.
    expect(writeMotion(m(['swing', 'x', 30, -2, 6, 30]))).toEqual(['swing', 'x', 30, 1, 3, 150])
    expect(writeMotion(m(['slide', 'y', 99, -1, 4, 270]))).toEqual(['slide', 'y', 99, 1, 4, 270])
    expect(writeMotion(m(['lift', 'y', 99, 10, -1, 4, 0]))).toEqual(['lift', 'y', 99, 10, -1, 4, 0])
    expect(writeMotion(m(['path', 2, 4, 0, [0, 0, 0, 2], [10, 0, 0, 4]]))).toEqual(['path', 1, 2, 0, [0, 0, 0, 1], [10, 0, 0, 2]])
    const s = newShard('w')
    const { shard, kept } = withAnim(s, [['turn', 'y', 2, 40, 0], ['bogus', 1], ['turn', 'y', 3, 1, 0], ['slide', 'z', 6, 1, 4, 0]])
    expect(kept).toHaveLength(2)
    expect(shard.extra?.anim).toEqual([['turn', 'y', 1, 20, 0], ['slide', 'z', 6, 1, 4, 0]])
    expect((toPayload(shard) as unknown as Record<string, unknown>).anim).toEqual([['turn', 'y', 1, 20, 0], ['slide', 'z', 6, 1, 4, 0]])
    expect(withAnim(shard, shard.extra?.anim).shard).toBe(shard)
    expect(withAnim(shard, []).shard.extra?.anim).toBeUndefined()
  })
})
