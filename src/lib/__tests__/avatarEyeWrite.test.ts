/**
 * avatarEyeWrite.test.ts - writing the avatar's eye from the workshop's SET
 * EYE (UI A, arkinox 2026-11-16): withEye removes the field for AUTO, writes
 * three integers for CHOSEN including [0, 0, 0], and never writes a malformed
 * value; the bench's frame is the payload's with Z negated; CENTER is the
 * middle of the shape's box; the eye prints in gibsons as "0, 1.33, 0".
 */
import { describe, expect, it } from 'vitest'
import { fromPayload, newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { benchEye, centerEye, eyeChosen, eyeLabel, eyeOf, flipEyeZ, gibsonsLabel, withEye } from '../avatarEye'

/** arkinox's Ship (avatarEye.test.ts): its automatic eye is 159 ticks up, 1.325 gibsons. */
const SHIP = {"v":2,"name":"Ship","unit":0,"extent":8,"mode":"solid","vertices":[[0,1,0],[-1,1,0],[0,1,-2],[0,1,1],[-1,1,0],[0,1,0],[0,1,0],[0,0,0],[-1,0,0],[1,0,0],[-1,1,0],[-1,1,1],[-1,1,0],[0,1,1],[0,1,0],[0,1,0],[0,1,1],[-1,1,1]],"ticks":[[48,0,0],[72,0,0],[0,0,96],-1,[72,24,72],[48,24,72],[0,48,0],[0,96,0],[0,96,72],[0,96,72],[48,0,96],[96,0,0],[72,24,96],[24,0,0],[72,0,96],[48,24,96],[48,0,24],[72,0,24]],"colors":[64,64,64,251,59,59,64,251,59,59,249,249,249,249,249,249,238,238],"faces":[[9,0,5],[4,1,8],[2,0,7],[1,2,7],[2,6,0],[1,6,2],[6,1,3],[3,0,6],[3,7,0],[3,1,7],[3,0,9],[3,8,1],[4,3,1],[5,0,3],[4,8,3],[5,3,9],[15,14,13],[11,10,12],[17,12,10],[12,17,11],[10,11,17],[15,13,16],[14,15,16],[14,16,13]],"opacity":95}

function ship(extra: Record<string, unknown> = {}): ShardModel {
  const m = fromPayload({ ...SHIP, ...extra }, 'avatar:test')
  if (!m) throw new Error('the Ship did not read')
  return m
}

describe('withEye', () => {
  it('writes three integers for CHOSEN, [0, 0, 0] included, and the payload carries them', () => {
    const s = withEye(ship(), [0, 200, -30])
    expect(s.extra?.eye).toEqual([0, 200, -30])
    expect(eyeChosen(s)).toBe(true)
    expect((toPayload(s) as unknown as Record<string, unknown>).eye).toEqual([0, 200, -30])
    const origin = withEye(ship(), [0, 0, 0])
    expect(origin.extra?.eye).toEqual([0, 0, 0])
    expect(eyeChosen(origin)).toBe(true)
    expect(eyeOf(origin)).toEqual([0, 0, 0])
  })

  it('removes the field for AUTO, and the whole extra when nothing else is in it', () => {
    const chosen = withEye(ship(), [0, 200, 0])
    const auto = withEye(chosen, undefined)
    expect(auto.extra).toBeUndefined()
    expect(eyeChosen(auto)).toBe(false)
    expect('eye' in (toPayload(auto) as unknown as Record<string, unknown>)).toBe(false)
  })

  it('keeps every other carried field', () => {
    const s = withEye({ ...ship(), extra: { pointsize: 30 } }, [1, 2, 3])
    expect(s.extra).toEqual({ pointsize: 30, eye: [1, 2, 3] })
    expect(withEye(s, undefined).extra).toEqual({ pointsize: 30 })
  })

  it('never writes a malformed value: a fraction or an eye out of reach removes the field', () => {
    const chosen = withEye(ship(), [0, 200, 0])
    expect(withEye(chosen, [0, 1.5, 0]).extra).toBeUndefined()
    expect(withEye(chosen, [0, 7681, 0]).extra).toBeUndefined()
    expect(withEye(chosen, [NaN, 0, 0]).extra).toBeUndefined()
  })
})

describe('the bench frame', () => {
  it('is the payload frame with Z negated, never -0', () => {
    expect(flipEyeZ([1, 2, 3])).toEqual([1, 2, -3])
    expect(Object.is(flipEyeZ([0, 0, 0])[2], 0)).toBe(true)
    expect(benchEye(withEye(ship(), [10, 20, 30]))).toEqual([10, 20, -30])
    expect(benchEye(ship())).toEqual([0, 159, 0])
  })
})

describe('CENTER', () => {
  it('is the middle of the shape\'s box, in whole ticks, in the payload frame', () => {
    // The Ship runs X -120..120, Y 96..168, Z -144..144 (model frame).
    expect(centerEye(ship())).toEqual([0, 132, 0])
    const box = { ...newShard('Box'), vertices: [{ p: [0, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }, { p: [1, 2, 3] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }
    // Model 0..360 on Z is the payload's 0..-360: the middle is -180 on the wire.
    expect(centerEye(box)).toEqual([60, 120, -180])
    expect(benchEye(withEye(box, centerEye(box)))).toEqual([60, 120, 180])
    expect(centerEye(newShard('Empty'))).toEqual([0, 0, 0])
  })
})

describe('the eye in gibsons', () => {
  it('prints the Ship\'s automatic eye as 0, 1.33, 0, from whole hundredths', () => {
    expect(gibsonsLabel(159, ship())).toBe('1.33')
    expect(eyeLabel(ship())).toBe('0, 1.33, 0')
    expect(eyeLabel(withEye(ship(), [0, 0, 0]))).toBe('0, 0, 0')
    expect(eyeLabel(withEye(ship(), [-60, 240, 30]))).toBe('-0.5, 2, -0.25')
  })

  it('scales with the unit, and never prints -0', () => {
    expect(gibsonsLabel(120, { ...ship(), unit: 1 })).toBe('2')
    expect(gibsonsLabel(-0.2, ship())).toBe('0')
  })
})
