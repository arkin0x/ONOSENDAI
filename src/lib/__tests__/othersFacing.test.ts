/**
 * othersFacing.test.ts - someone else's avatar faces the way their own last
 * move went (arkinox, 2026-11-26: "other people's avatars always face the
 * black sun regardless of their movements"), and turns to a new heading over
 * TURN_MS along the shorter way round (lib/turnEase.ts).
 */
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { NO_MOVES, SEEN_KEPT, facingTurn, keepSeen, seeMove, seenOf, seenTurn, type SeenMoves } from '../facing'
import { TURN_MS, TurnEase } from '../turnEase'
import { canonicalQuaternion, rotateView, viewAxes, type Position } from '../space'

const at = (x: bigint, y: bigint, z: bigint): Position => ({ x, y, z })
const O = at(100n, 100n, 100n)
const by = (d: [number, number, number], from: Position = O): Position => at(from.x + BigInt(d[0]), from.y + BigInt(d[1]), from.z + BigInt(d[2]))
const CANON = viewAxes(canonicalQuaternion())
const NOSE = new Vector3(0, 0, -1) // model nose (payload -Z) as the scene draws it
const TOP = new Vector3(0, 1, 0)
const r3 = (v: Vector3): number[] => v.toArray().map((n) => +n.toFixed(3) + 0)
const apply = (q: Quaternion, v: Vector3): number[] => r3(v.clone().applyQuaternion(q))
const yaw = (deg: number): Quaternion => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180)
const yawOf = (q: Quaternion): number => {
  const f = NOSE.clone().applyQuaternion(q)
  return (Math.atan2(-f.x, -f.z) * 180) / Math.PI
}
/** The moves seen along a walk through `steps`, in `axes`. */
const walk = (steps: Position[], axes = CANON, seen: SeenMoves = NO_MOVES): SeenMoves =>
  steps.slice(1).reduce((s, p, i) => seeMove(s, steps[i], p, axes), seen)

describe('heading from a step', () => {
  it('a step to cyberspace +X faces right, top up', () => {
    const seen = walk([O, by([1, 0, 0])])
    for (const face of ['path', 'upright'] as const) {
      const q = seenTurn(seen, CANON, face)
      expect(apply(q, NOSE)).toEqual([1, 0, 0])
      expect(apply(q, TOP)).toEqual([0, 1, 0])
    }
  })
  it('a step away from the black sun (cyberspace -Z) faces out of the screen, no longer at the sun', () => {
    const q = seenTurn(walk([O, by([0, 0, -1])]), CANON, 'path')
    expect(apply(q, NOSE)).toEqual([0, 0, 1])
  })
  it('is the same turn your own avatar takes for that move', () => {
    const move: [Position, Position] = [O, by([2, 1, -3])]
    for (const face of ['path', 'upright'] as const) {
      expect(seenTurn(walk(move), CANON, face).toArray()).toEqual(facingTurn(CANON, move, face).toArray())
    }
  })
  it('a long hop faces its travel direction, however far', () => {
    const far = at(O.x + (1n << 60n), O.y, O.z)
    expect(apply(seenTurn(walk([O, far]), CANON, 'upright'), NOSE)).toEqual([1, 0, 0])
  })
  it('the newest move wins', () => {
    const seen = walk([O, by([1, 0, 0]), by([1, 0, 1])])
    expect(apply(seenTurn(seen, CANON, 'upright'), NOSE)).toEqual([0, 0, -1])
  })
})

describe('before any move, and standing still', () => {
  it('with no move seen, the avatar stands at rest, as before', () => {
    expect(seenTurn(NO_MOVES, CANON, 'path').toArray()).toEqual(facingTurn(CANON, null, 'path').toArray())
  })
  it('a move to where it already stands is not a move: the last heading is kept', () => {
    const seen = walk([O, by([1, 0, 0])])
    const still = seeMove(seen, by([1, 0, 0]), by([1, 0, 0]), CANON)
    expect(still).toBe(seen)
    expect(apply(seenTurn(still, CANON, 'path'), NOSE)).toEqual([1, 0, 0])
  })
})

describe('a vertical-only move keeps the yaw (UPRIGHT)', () => {
  it('a climb straight up after a step right still faces right', () => {
    const seen = walk([O, by([1, 0, 0]), by([1, 5, 0])])
    const q = seenTurn(seen, CANON, 'upright')
    expect(apply(q, NOSE)).toEqual([1, 0, 0])
    expect(apply(q, TOP)).toEqual([0, 1, 0])
  })
  it('a first move straight down keeps the rest yaw', () => {
    const q = seenTurn(walk([O, by([0, -3, 0])]), CANON, 'upright')
    expect(q.toArray().map((n) => +n.toFixed(6) + 0)).toEqual(facingTurn(CANON, null, 'upright').toArray().map((n) => +n.toFixed(6) + 0))
  })
  it('PATH points along a climb, as DECK-0003 §1.18 has it for every avatar', () => {
    const q = seenTurn(walk([O, by([1, 0, 0]), by([1, 5, 0])]), CANON, 'path')
    expect(apply(q, NOSE)).toEqual([0, 1, 0])
  })
})

describe('different gravity frames', () => {
  // The compass turned a quarter so cyberspace X is the view's up: WALK's
  // gravity is then along X (lib/walkDown.ts), and a move along X is a climb.
  const xUp = viewAxes(rotateView(rotateView(canonicalQuaternion(), 'left'), 'up'))
  it('the turned view really has X as its up', () => {
    expect(xUp.up.axis).toBe('x')
  })
  it('UPRIGHT stands on the view up there and yaws about it alone', () => {
    const seen = walk([O, by([0, 0, 1])], xUp)
    const q = seenTurn(seen, xUp, 'upright')
    expect(apply(q, TOP)).toEqual([0, 1, 0])
    expect(Math.abs(apply(q, NOSE)[1])).toBe(0)
  })
  it('a move along X is a climb there and keeps the yaw', () => {
    const before = seenTurn(walk([O, by([0, 0, 1])], xUp), xUp, 'upright')
    const after = seenTurn(walk([O, by([0, 0, 1]), by([4, 0, 1])], xUp), xUp, 'upright')
    expect(apply(after, NOSE)).toEqual(apply(before, NOSE))
  })
  it('a climb seen in one view faces its way once a compass turn makes it level', () => {
    // A step along X, then a climb along Y; turned so X is up, the climb is the level move.
    const seen = walk([O, by([1, 0, 0]), by([1, 3, 0])])
    expect(seenTurn(seen, xUp, 'upright').toArray()).toEqual(facingTurn(xUp, [by([1, 0, 0]), by([1, 3, 0])], 'upright').toArray())
  })
  it('a heading kept in one view is let go when a compass turn makes it a climb', () => {
    const seen = walk([O, by([1, 0, 0])])
    expect(apply(seenTurn(seen, xUp, 'upright'), TOP)).toEqual([0, 1, 0])
    expect(seenTurn(seen, xUp, 'upright').toArray()).toEqual(facingTurn(xUp, null, 'upright').toArray())
  })
})

describe('turning to a new heading (TurnEase)', () => {
  it('snaps the first heading', () => {
    const e = new TurnEase()
    e.snap(yaw(30))
    expect(yawOf(e.at(0, new Quaternion()))).toBeCloseTo(30)
  })
  it('turns over TURN_MS, eased, and lands exactly', () => {
    const e = new TurnEase()
    e.snap(yaw(0))
    e.aim(yaw(90), 1000)
    const out = new Quaternion()
    expect(yawOf(e.at(1000, out))).toBeCloseTo(0)
    expect(yawOf(e.at(1000 + TURN_MS / 2, out))).toBeCloseTo(45)
    expect(yawOf(e.at(1000 + TURN_MS / 4, out))).toBeLessThan(22.5)
    expect(e.turning(1000 + TURN_MS / 2)).toBe(true)
    expect(yawOf(e.at(1000 + TURN_MS, out))).toBeCloseTo(90)
    expect(e.turning(1000 + TURN_MS)).toBe(false)
  })
  it('takes the shorter way round: 170 to -170 swings through behind, not the long way', () => {
    const e = new TurnEase()
    e.snap(yaw(170))
    e.aim(yaw(-170), 0)
    const mid = Math.abs(yawOf(e.at(TURN_MS / 2, new Quaternion())))
    expect(mid).toBeCloseTo(180, 3)
  })
  it('a new heading mid-turn turns on from where it stands, without a jump', () => {
    const e = new TurnEase()
    e.snap(yaw(0))
    e.aim(yaw(90), 0)
    const out = new Quaternion()
    const now = yawOf(e.at(TURN_MS / 2, out))
    e.aim(yaw(-90), TURN_MS / 2)
    expect(yawOf(e.at(TURN_MS / 2, out))).toBeCloseTo(now)
    expect(yawOf(e.at(TURN_MS * 1.5, out))).toBeCloseTo(-90)
  })
  it('aiming at the heading it already has starts nothing', () => {
    const e = new TurnEase()
    e.snap(yaw(40))
    e.aim(yaw(40), 0)
    expect(e.turning(1)).toBe(false)
  })
})

describe('kept by pubkey across being drawn and not', () => {
  it('a person drawn again keeps the moves seen before', () => {
    const seen = walk([O, by([1, 0, 0])])
    keepSeen('alice', seen)
    expect(seenOf('alice')).toBe(seen)
    expect(seenOf('nobody')).toBe(NO_MOVES)
  })
  it('a respawn forgets them: a chain of one faces nothing', () => {
    keepSeen('bob', walk([O, by([0, 0, 1])]))
    keepSeen('bob', NO_MOVES)
    expect(seenOf('bob')).toBe(NO_MOVES)
  })
  it('keeps only the most recently seen', () => {
    const seen = walk([O, by([1, 0, 0])])
    keepSeen('first', seen)
    for (let i = 0; i < SEEN_KEPT; i++) keepSeen(`p${i}`, seen)
    expect(seenOf('first')).toBe(NO_MOVES)
    expect(seenOf(`p${SEEN_KEPT - 1}`)).toBe(seen)
  })
})
