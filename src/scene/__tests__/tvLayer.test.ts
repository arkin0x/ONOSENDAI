/**
 * tvLayer.test.ts: a spawning avatar grows from a point to its size, and the
 * camera lands on the new place after a cut.
 */
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { carryAcross, followStep, framingDirection, grownAt, TV_CARRY_MAX_CELLS, TV_FOLLOW_TAU, type TvFollow, type TvFollowFrame } from '../TvLayer'
import { AvatarLerp, type Vec3 } from '../../lib/avatarLerp'
import { FIT_CELLS, MOVE_FIT_CELLS } from '../../lib/tv/zoom'
import { MIN_STEP_S } from '../../lib/tv/director'
import { originShift, type Position, type ViewAxes } from '../../lib/space'
import { alignedOrigin } from '../../store/useCyberspace'

describe('grownAt', () => {
  it('is whole for an avatar that did not spawn on screen', () => {
    expect(grownAt(undefined, 5)).toBe(1)
  })
  it('is nothing before the spawn, grows, and is whole after', () => {
    expect(grownAt(Infinity, 1000)).toBe(0)
    expect(grownAt(1000, 1000)).toBe(0)
    const half = grownAt(1000, 1450)
    expect(half).toBeGreaterThan(0.5)
    expect(half).toBeLessThan(1)
    expect(grownAt(1000, 5000)).toBe(1)
  })
})

describe('framingDirection', () => {
  const sun = new Vector3(0.3, 0.2, 0.93).normalize()
  const base = { from: 13, to: 10, polar: 0.7, name: 'medium' as const, view: 'above' as const, spin: 1 as const }

  it('stands a sun shot on the far side of the subject from the sun, at any point of its sway', () => {
    for (const theta of [0, 0.4, 1.3, 2.9]) {
      const d = framingDirection({ ...base, sun: true }, theta, sun, new Vector3())
      // The camera looks along -d: toward the sun.
      expect(d.clone().negate().dot(sun)).toBeGreaterThan(0.7)
    }
  })

  it('circles an ordinary shot at its angle from overhead', () => {
    const d = framingDirection({ ...base, sun: false }, 1, sun, new Vector3())
    expect(d.y).toBeCloseTo(Math.cos(0.7))
    expect(d.length()).toBeCloseTo(1)
  })

  it('looks up at the sun from below on a below shot', () => {
    const d = framingDirection({ ...base, view: 'below', sun: true }, 0, sun, new Vector3())
    expect(d.y).toBeLessThan(0)
  })
})

describe('the TV camera across a cut', () => {
  const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: -1 }, out: { axis: 'z', dir: 1 } }
  const A: Position = { x: 1000n, y: 2000n, z: 3000n }
  // Where the new shot's point is, against the new anchor: the store's cursorOffset.
  const live: [number, number, number] = [0.4338, 0.1526, 0.4331]
  const K = 0.05

  /** A camera settled on a shot at A, cut 1. */
  function settled(): TvFollow {
    return { smooth: new Vector3(3, 1, 2), was: { origin: alignedOrigin(A, 0), scaleExp: 0, cutAt: 1 } }
  }
  const frame = (anchor: Position, drawn: Position, extra: Partial<TvFollowFrame> = {}): TvFollowFrame =>
    ({ anchor, drawn, scaleExp: 0, cutAt: 2, live, subject: null, ...extra })

  // A cut as it plays: frames drawn before React commits the new anchor (the
  // store at B, the scene still at A), then the commit.
  function cutTo(B: Position, lagged: number): { f: TvFollow; steps: string[]; farthest: number } {
    const f = settled()
    const at = new Vector3()
    const steps: string[] = []
    let farthest = 0
    const run = (fr: TvFollowFrame): void => {
      steps.push(followStep(f, fr, AXES, K, at))
      farthest = Math.max(farthest, f.smooth!.length())
    }
    for (let i = 0; i < lagged; i++) run(frame(B, A))
    run(frame(B, B))
    return { f, steps, farthest }
  }

  it('holds through the frames drawn before a cut across the universe commits, then cuts onto the new place', () => {
    const far = 1n << 80n
    const { f, steps, farthest } = cutTo({ x: A.x + far, y: A.y - far, z: A.z + far }, 2)
    expect(steps).toEqual(['hold', 'hold', 'cut'])
    expect(f.smooth!.toArray()).toEqual(live)
    // Never out where the eye and what it looks at round to one point.
    expect(farthest).toBeLessThan(TV_CARRY_MAX_CELLS)
  })

  it('takes a short cut drawn before its commit in the drawn frame, and carries it to the new place', () => {
    const { f, steps } = cutTo({ x: A.x + 50n, y: A.y - 20n, z: A.z + 7n }, 1)
    expect(steps).toEqual(['cut', 'follow'])
    expect(f.smooth!.distanceTo(new Vector3(...live))).toBeLessThan(1e-9)
  })

  it('carries a re-anchor inside a shot whole, the camera kept where it was against the world', () => {
    const f = settled()
    const B: Position = { x: A.x + 120n, y: A.y, z: A.z - 40n }
    const shift = originShift(alignedOrigin(A, 0), alignedOrigin(B, 0), 0, AXES)
    // The avatar it follows, drawn in the new frame.
    const subject = new Vector3(-117, 0.5, 41)
    const step = followStep(f, frame(B, B, { cutAt: 1, subject }), AXES, 0, new Vector3())
    expect(step).toBe('follow')
    expect(f.smooth!.toArray()).toEqual([3 + shift[0], 1 + shift[1], 2 + shift[2]])
  })

  it('cuts onto what it looks at when the frame moves too far to carry, cut or not', () => {
    const f = settled()
    const far = 1n << 70n
    const B: Position = { x: A.x - far, y: A.y, z: A.z + far }
    const step = followStep(f, frame(B, B, { cutAt: 1 }), AXES, 0, new Vector3())
    expect(step).toBe('follow')
    expect(f.smooth!.toArray()).toEqual(live)
  })

  it('carries a shift short of the bound and cuts from it', () => {
    const smooth = new Vector3(5, 0, -2)
    carryAcross(smooth, [-(TV_CARRY_MAX_CELLS - 1), 0, 3], new Vector3(9, 9, 9))
    expect(smooth.toArray()).toEqual([5 - (TV_CARRY_MAX_CELLS - 1), 0, 1])
    carryAcross(smooth, [0, TV_CARRY_MAX_CELLS, 0], new Vector3(1, 2, 3))
    expect(smooth.toArray()).toEqual([1, 2, 3])
  })
})

describe('the TV camera across a zoom step', () => {
  const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: -1 }, out: { axis: 'z', dir: 1 } }
  const A: Position = { x: 1000n, y: 2000n, z: 3000n }
  const frame = (scaleExp: number, subject: Vector3, cutAt = 1): TvFollowFrame =>
    ({ anchor: A, drawn: A, scaleExp, cutAt, live: [0, 0, 0], subject })

  it('keeps its lag behind the avatar, rescaled, rather than cutting onto it', () => {
    const f: TvFollow = { smooth: null, was: null }
    const at = new Vector3()
    expect(followStep(f, frame(4, new Vector3(0, 0, 0)), AXES, 0, at)).toBe('cut')
    // The avatar moves on 8 cells; the eased point has not followed (k = 0).
    expect(followStep(f, frame(4, new Vector3(8, 0, 0)), AXES, 0, at)).toBe('follow')
    // Out two powers of two, re-anchored on the avatar: it is drawn at 0 now.
    const step = followStep(f, frame(6, new Vector3(0, 0, 0)), AXES, 0, at)
    expect(step).toBe('zoom')
    // 8 cells behind at 2^4 is 2 cells behind at 2^6.
    expect(f.smooth!.toArray()).toEqual([-2, 0, 0])
  })

  it('keeps its lag as it was on screen when zooming in, never grown (review of #470)', () => {
    const f: TvFollow = { smooth: null, was: null }
    const at = new Vector3()
    followStep(f, frame(16, new Vector3(0, 0, 0)), AXES, 0, at)
    followStep(f, frame(16, new Vector3(3, 0, 0)), AXES, 0, at)
    // In six powers of two in a row: the eased point stays 3 cells behind, not 3 * 2^6.
    for (let z = 15; z >= 10; z--) expect(followStep(f, frame(z, new Vector3(0, 0, 0)), AXES, 0, at)).toBe('zoom')
    expect(f.smooth!.toArray()).toEqual([-3, 0, 0])
  })

  it('still cuts when a new shot changes the zoom', () => {
    const f: TvFollow = { smooth: null, was: null }
    followStep(f, frame(4, new Vector3(5, 0, 0)), AXES, 0, new Vector3())
    expect(followStep(f, frame(9, new Vector3(1, 0, 0), 2), AXES, 0, new Vector3())).toBe('cut')
    expect(f.smooth!.toArray()).toEqual([1, 0, 0])
  })
})

describe('the TV camera behind a run of moves', () => {
  const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: -1 }, out: { axis: 'z', dir: 1 } }
  const A: Position = { x: 1000n, y: 2000n, z: 3000n }
  /** About how many cells a close shot shows either side of its middle (review of #470). */
  const CLOSE_HALF_CELLS = 5.5

  /** The farthest the eased point falls behind the avatar, cells, over ten back-to-back moves of `cells` at 60 fps. */
  function worstLag(cells: number): number {
    const f: TvFollow = { smooth: null, was: null }
    const lerp = new AvatarLerp()
    const at = new Vector3()
    const out: Vec3 = [0, 0, 0]
    const dt = 1 / 60
    let x = 0
    let worst = 0
    for (let move = 0; move < 10; move++) {
      x += cells
      const t0 = move * MIN_STEP_S * 1000
      lerp.move([-cells, 0, 0], t0)
      for (let t = t0; t < t0 + MIN_STEP_S * 1000; t += dt * 1000) {
        lerp.offset(t, out)
        const subject = new Vector3(x + out[0], 0, 0)
        followStep(f, { anchor: A, drawn: A, scaleExp: 0, cutAt: 1, live: [0, 0, 0], subject }, AXES, 1 - Math.exp(-dt / TV_FOLLOW_TAU), at)
        worst = Math.max(worst, subject.x - f.smooth!.x)
      }
    }
    return worst
  }

  it('keeps a run of moves fitted to MOVE_FIT_CELLS within a close shot, where FIT_CELLS left it at the edge (review of #470)', () => {
    expect(worstLag(MOVE_FIT_CELLS)).toBeLessThan(CLOSE_HALF_CELLS * 0.75)
    expect(worstLag(FIT_CELLS)).toBeGreaterThan(CLOSE_HALF_CELLS)
  })
})
