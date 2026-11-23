/**
 * avatarLerp.test.ts: every avatar glides from where it was to where it is,
 * over one duration, and is never drawn at its destination before it gets
 * there (arkinox, 2026-10-12).
 */
import { describe, expect, it } from 'vitest'
import { AVATAR_LERP_MS, AVATAR_SNAP_CELLS, AvatarLerp, MAX_GLIDE_STEP_MS, lerpRemaining, type Vec3 } from '../avatarLerp'

/** Where the avatar is drawn: its true place plus the glide's offset. */
const drawnAt = (lerp: AvatarLerp, at: Vec3, now: number): Vec3 => {
  const o = lerp.offset(now)
  return [at[0] + o[0], at[1] + o[1], at[2] + o[2]]
}

/** Draw the glide at 60 frames a second from `from` up to `to` (ms), as the scene does. */
const frames = (lerp: AvatarLerp, from: number, to: number): void => {
  for (let t = from; t < to; t += 1000 / 60) lerp.offset(t)
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
    frames(lerp, 0, AVATAR_LERP_MS)
    expect(drawnAt(lerp, next, AVATAR_LERP_MS)).toEqual(next)
    expect(lerp.moving(AVATAR_LERP_MS)).toBe(false)
    expect(drawnAt(lerp, next, AVATAR_LERP_MS * 5)).toEqual(next)
  })

  it('a move that lands mid-glide starts from where the avatar is drawn, with no jump', () => {
    const lerp = new AvatarLerp()
    lerp.move(was, 0)
    frames(lerp, 0, AVATAR_LERP_MS / 3)
    const mid = drawnAt(lerp, next, AVATAR_LERP_MS / 3)
    const third: Vec3 = [4, 6, -2]
    lerp.move([next[0] - third[0], next[1] - third[1], next[2] - third[2]], AVATAR_LERP_MS / 3)
    const after = drawnAt(lerp, third, AVATAR_LERP_MS / 3)
    for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(mid[i], 9)
    frames(lerp, AVATAR_LERP_MS / 3, AVATAR_LERP_MS / 3 + AVATAR_LERP_MS)
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

describe('AvatarLerp.rescale', () => {
  it('keeps a glide the same journey when the zoom changes under it', () => {
    const lerp = new AvatarLerp()
    lerp.move([-64, 0, 0], 0)
    frames(lerp, 0, AVATAR_LERP_MS / 2)
    const half = lerp.offset(AVATAR_LERP_MS / 2)[0]
    // Out three powers of two: the same distance is an eighth of the cells.
    lerp.rescale(2 ** -3)
    expect(lerp.offset(AVATAR_LERP_MS / 2)[0]).toBeCloseTo(half / 8)
    expect(lerp.moving(AVATAR_LERP_MS / 2)).toBe(true)
    frames(lerp, AVATAR_LERP_MS / 2, AVATAR_LERP_MS)
    expect(lerp.offset(AVATAR_LERP_MS)).toEqual([0, 0, 0])
  })

  it('does nothing to an avatar standing still, or for a factor that is not one', () => {
    const lerp = new AvatarLerp()
    lerp.rescale(8)
    expect(lerp.offset(0)).toEqual([0, 0, 0])
    lerp.move([4, 0, 0], 0)
    lerp.rescale(Number.NaN)
    lerp.rescale(0)
    expect(lerp.offset(0)[0]).toBe(4)
  })
})

/**
 * Your own avatar's glide (catchUp, scene/Travel.tsx): a late frame never
 * spends it unseen (owner, 2026-11-12: "I never see the animation it seems to
 * just freeze for a second and then I appear at the next location"). The
 * glide runs on the clock, but no drawn frame covers more than
 * MAX_GLIDE_STEP_MS of it.
 */
describe('AvatarLerp: slow frames and a held start', () => {
  const was: Vec3 = [-10, 0, 0]

  it('takes AVATAR_LERP_MS at any steady frame rate: time, not frames', () => {
    for (const fps of [120, 60, 30, 15]) {
      const lerp = new AvatarLerp({ catchUp: true })
      lerp.move(was, 0)
      let t = 0
      while (lerp.moving(t)) { t += 1000 / fps; lerp.offset(t) }
      expect(t).toBeGreaterThanOrEqual(AVATAR_LERP_MS)
      expect(t).toBeLessThan(AVATAR_LERP_MS + 1000 / fps + 1e-6)
    }
  })

  it('a frame that comes a second late still finds the avatar near where it set off, and the rest of the glide is drawn', () => {
    const lerp = new AvatarLerp({ catchUp: true })
    lerp.move(was, 1000)
    // The landing frame stalls for a second (a shader compiling, bags opening).
    const first = lerp.offset(2000)[0]
    expect(first).toBeCloseTo(was[0] * lerpRemaining(MAX_GLIDE_STEP_MS / AVATAR_LERP_MS), 9)
    expect(first).toBeLessThan(0)
    expect(lerp.moving(2000)).toBe(true)
    // Then it carries on at 60 a second, and is drawn at least five more frames before it arrives.
    let drawn = 0
    let t = 2000
    while (lerp.moving(t)) { t += 1000 / 60; lerp.offset(t); drawn++ }
    expect(drawn).toBeGreaterThanOrEqual(5)
  })

  it('every stalled frame moves it at most a sixth of the way, so at least six frames show it', () => {
    const lerp = new AvatarLerp({ catchUp: true })
    lerp.move(was, 0)
    let shown = 0
    let t = 0
    while (lerp.moving(t)) { t += 400; lerp.offset(t); shown++ }
    expect(shown).toBeGreaterThanOrEqual(AVATAR_LERP_MS / MAX_GLIDE_STEP_MS)
  })

  it('held to start later, it stays where it was until then and only then sets off', () => {
    const lerp = new AvatarLerp({ catchUp: true })
    lerp.move(was, 0, 500)
    frames(lerp, 0, 500)
    expect(lerp.offset(499)[0]).toBe(was[0])
    expect(lerp.moving(499)).toBe(true)
    frames(lerp, 500, 500 + AVATAR_LERP_MS / 2)
    expect(lerp.offset(500 + AVATAR_LERP_MS / 2)[0]).toBeGreaterThan(was[0])
    frames(lerp, 500 + AVATAR_LERP_MS / 2, 500 + AVATAR_LERP_MS)
    expect(lerp.offset(500 + AVATAR_LERP_MS)).toEqual([0, 0, 0])
  })

  it('without catchUp (everyone else, TV) a glide is the clock alone: drawn rarely, it is still where the time says', () => {
    const lerp = new AvatarLerp()
    lerp.move(was, 0)
    expect(lerp.offset(AVATAR_LERP_MS / 2)[0]).toBeCloseTo(was[0] * lerpRemaining(0.5), 9)
    expect(lerp.offset(AVATAR_LERP_MS)).toEqual([0, 0, 0])
  })

  it('a hold already past holds nothing', () => {
    const lerp = new AvatarLerp({ catchUp: true })
    lerp.move(was, 1000, 400)
    expect(lerp.offset(1000 + 1000 / 60)[0]).toBeGreaterThan(was[0])
  })
})
