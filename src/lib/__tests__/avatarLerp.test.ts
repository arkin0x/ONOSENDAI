/**
 * avatarLerp.test.ts: every avatar glides from where it was to where it is,
 * over one duration, and is never drawn at its destination before it gets
 * there (arkinox, 2026-10-12).
 */
import { describe, expect, it } from 'vitest'
import { AVATAR_LERP_MS, AVATAR_SNAP_CELLS, AvatarLerp, lerpRemaining, type Vec3 } from '../avatarLerp'

/** Where the avatar is drawn: its true place plus the glide's offset. */
const drawnAt = (lerp: AvatarLerp, at: Vec3, now: number): Vec3 => {
  const o = lerp.offset(now)
  return [at[0] + o[0], at[1] + o[1], at[2] + o[2]]
}

describe('AVATAR_LERP_MS', () => {
  it('is one constant, slower than the old short hops (265 to 445 ms) and within the old cap', () => {
    expect(AVATAR_LERP_MS).toBe(600)
  })
})

describe('lerpRemaining', () => {
  it('runs from all of the way to none of it, eased out, and only down', () => {
    expect(lerpRemaining(0)).toBe(1)
    expect(lerpRemaining(1)).toBe(0)
    expect(lerpRemaining(-1)).toBe(1)
    expect(lerpRemaining(2)).toBe(0)
    let last = 1
    for (let t = 0.05; t < 1; t += 0.05) {
      const k = lerpRemaining(t)
      expect(k).toBeLessThan(last)
      last = k
    }
    // Eased out: more than half the way is covered in the first quarter.
    expect(lerpRemaining(0.25)).toBeLessThan(0.5)
  })
})

describe('AvatarLerp: one avatar, one position over time', () => {
  const old: Vec3 = [0, 0, 0]
  const next: Vec3 = [4, 0, -2]
  const was: Vec3 = [old[0] - next[0], old[1] - next[1], old[2] - next[2]]

  it('is drawn where it was on the frame the move lands, not at the destination', () => {
    const lerp = new AvatarLerp()
    lerp.move(was, 1000)
    expect(drawnAt(lerp, next, 1000)).toEqual(old)
    expect(lerp.moving(1000)).toBe(true)
  })

  it('travels one path from the old place to the new one, always between the two, nearer each frame', () => {
    const lerp = new AvatarLerp()
    lerp.move(was, 0)
    const total = Math.hypot(...was)
    let lastLeft = total
    for (let t = 16; t < AVATAR_LERP_MS; t += 16) {
      const p = drawnAt(lerp, next, t)
      const left = Math.hypot(p[0] - next[0], p[1] - next[1], p[2] - next[2])
      const gone = Math.hypot(p[0] - old[0], p[1] - old[1], p[2] - old[2])
      // On the segment: distance from the start plus distance to the end is the whole.
      expect(left + gone).toBeCloseTo(total, 9)
      expect(left).toBeLessThan(lastLeft)
      // Not at the destination until the glide is over.
      expect(left).toBeGreaterThan(0)
      lastLeft = left
    }
  })

  it('arrives at AVATAR_LERP_MS and stays there', () => {
    const lerp = new AvatarLerp()
    lerp.move(was, 0)
    expect(drawnAt(lerp, next, AVATAR_LERP_MS)).toEqual(next)
    expect(lerp.moving(AVATAR_LERP_MS)).toBe(false)
    expect(drawnAt(lerp, next, AVATAR_LERP_MS * 5)).toEqual(next)
  })

  it('a move that lands mid-glide starts from where the avatar is drawn, with no jump', () => {
    const lerp = new AvatarLerp()
    lerp.move(was, 0)
    const mid = drawnAt(lerp, next, AVATAR_LERP_MS / 3)
    const third: Vec3 = [4, 6, -2]
    lerp.move([next[0] - third[0], next[1] - third[1], next[2] - third[2]], AVATAR_LERP_MS / 3)
    const after = drawnAt(lerp, third, AVATAR_LERP_MS / 3)
    for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(mid[i], 9)
    expect(drawnAt(lerp, third, AVATAR_LERP_MS / 3 + AVATAR_LERP_MS)).toEqual(third)
  })

  it('a move too long to see is a cut, and clear stops a glide where it is', () => {
    const lerp = new AvatarLerp()
    lerp.move([AVATAR_SNAP_CELLS + 1, 0, 0], 0)
    expect(lerp.offset(0)).toEqual([0, 0, 0])
    lerp.move(was, 0)
    lerp.clear()
    expect(lerp.offset(1)).toEqual([0, 0, 0])
  })

  it('writes into the vector it is given, so a frame allocates nothing', () => {
    const lerp = new AvatarLerp()
    const out: Vec3 = [9, 9, 9]
    expect(lerp.offset(0, out)).toBe(out)
    expect(out).toEqual([0, 0, 0])
  })
})
