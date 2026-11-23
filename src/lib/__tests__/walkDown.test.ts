/**
 * walkDown.test.ts - which way is down for GRAVITY in WALK (lib/walkDown.ts;
 * arkinox, 2026-11-10: gravity follows the view). Down is the axis nearest
 * the screen's down, from the view's up; a tie keeps the down gravity has,
 * else Y, then X, then Z; the default view, and any view turned only left or
 * right, is -Y as it always was; every view the compass can reach has one of
 * the six, and the WALK keys stay level across it.
 */
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { canonicalQuaternion, levelScreenAxes, rotateView, topDownQuaternion, viewAxes, type AxisDirection, type RotateDirection } from '../space'
import { WORLD_DOWN, atHeight, downFromUp, heightOf, raised, sameDir, upOf, viewDown } from '../walkDown'

const D = (axis: 'x' | 'y' | 'z', dir: 1 | -1): AxisDirection => ({ axis, dir })
const SIX: AxisDirection[] = [D('x', 1), D('x', -1), D('y', 1), D('y', -1), D('z', 1), D('z', -1)]
const TURNS: RotateDirection[] = ['left', 'right', 'up', 'down']

/** A view the compass's controls reach whose down is `g`: the shortest run of turns from the default view. */
function viewFor(g: AxisDirection): Quaternion {
  let frontier: Quaternion[] = [canonicalQuaternion()]
  for (let depth = 0; depth < 4; depth++) {
    for (const q of frontier) if (sameDir(viewDown(q), g)) return q
    frontier = frontier.flatMap((q) => TURNS.map((t) => rotateView(q, t)))
  }
  throw new Error(`no view for ${g.dir}${g.axis}`)
}

describe('down from the screen\'s up', () => {
  it('is the opposite of the axis nearest up', () => {
    expect(downFromUp({ x: 0, y: 1, z: 0 })).toEqual(D('y', -1))
    expect(downFromUp({ x: 0, y: -1, z: 0 })).toEqual(D('y', 1))
    expect(downFromUp({ x: 1, y: 0, z: 0 })).toEqual(D('x', -1))
    expect(downFromUp({ x: -1, y: 0, z: 0 })).toEqual(D('x', 1))
    expect(downFromUp({ x: 0, y: 0, z: 1 })).toEqual(D('z', -1))
    expect(downFromUp({ x: 0, y: 0, z: -1 })).toEqual(D('z', 1))
    // Never a diagonal: tilted up to 45 degrees, still the nearest axis.
    expect(downFromUp({ x: 0.7, y: 0.71, z: 0 })).toEqual(D('y', -1))
    expect(downFromUp({ x: 0.71, y: 0.7, z: 0 })).toEqual(D('x', -1))
    expect(downFromUp({ x: 0.2, y: -0.3, z: -0.9 })).toEqual(D('z', 1))
  })

  it('a tie keeps the down gravity has, when it is one of the tied', () => {
    const h = Math.SQRT1_2
    expect(downFromUp({ x: h, y: h, z: 0 }, D('x', -1))).toEqual(D('x', -1))
    expect(downFromUp({ x: h, y: h, z: 0 }, D('y', -1))).toEqual(D('y', -1))
    expect(downFromUp({ x: 0, y: h, z: -h }, D('z', 1))).toEqual(D('z', 1))
    // Exactly between all three: whichever of them it had.
    const t = 1 / Math.sqrt(3)
    for (const g of [D('x', -1), D('y', -1), D('z', -1)]) expect(downFromUp({ x: t, y: t, z: t }, g)).toEqual(g)
  })

  it('a tie with nothing to keep goes to Y, then X, then Z, signed by up', () => {
    const h = Math.SQRT1_2
    // What it had is not one of the tied (or is the wrong way along one).
    expect(downFromUp({ x: h, y: h, z: 0 }, D('z', 1))).toEqual(D('y', -1))
    expect(downFromUp({ x: h, y: h, z: 0 }, D('x', 1))).toEqual(D('y', -1))
    expect(downFromUp({ x: -h, y: -h, z: 0 })).toEqual(D('y', 1))
    expect(downFromUp({ x: h, y: 0, z: h })).toEqual(D('x', -1))
    expect(downFromUp({ x: -h, y: 0, z: h })).toEqual(D('x', 1))
    const t = 1 / Math.sqrt(3)
    expect(downFromUp({ x: t, y: t, z: t })).toEqual(D('y', -1))
    // A hair off a tie is no tie.
    expect(downFromUp({ x: h + 1e-6, y: h, z: 0 }, D('y', -1))).toEqual(D('x', -1))
  })

  it('with no direction at all, keeps what it had', () => {
    expect(downFromUp({ x: 0, y: 0, z: 0 })).toEqual(WORLD_DOWN)
    expect(downFromUp({ x: 0, y: 0, z: 0 }, D('z', 1))).toEqual(D('z', 1))
    expect(downFromUp({ x: NaN, y: NaN, z: NaN }, D('x', 1))).toEqual(D('x', 1))
  })
})

describe('down in a view', () => {
  it('the default view, and every view turned only left or right, is -Y as always', () => {
    let q = canonicalQuaternion()
    for (let k = 0; k < 8; k++) {
      expect(viewDown(q)).toEqual(D('y', -1))
      q = rotateView(q, k % 2 ? 'left' : 'right')
      q = rotateView(q, 'left')
    }
  })

  it('is the opposite of the view\'s up, the up the compass shows, for every view the controls reach', () => {
    let frontier = [canonicalQuaternion()]
    const seen: AxisDirection[] = []
    for (let depth = 0; depth < 4; depth++) {
      for (const q of frontier) {
        const g = viewDown(q)
        expect(g).toEqual(upOf(viewAxes(q).up))
        if (!seen.some((s) => sameDir(s, g))) seen.push(g)
      }
      frontier = frontier.flatMap((q) => TURNS.map((t) => rotateView(q, t)))
    }
    // All six are reachable, and nothing else ever is.
    expect(seen).toHaveLength(6)
    for (const g of SIX) expect(sameDir(viewDown(viewFor(g)), g)).toBe(true)
  })

  it('a quarter turn up or down tips gravity onto Z; the map view falls along -Z (its screen up is +Z)', () => {
    expect(viewDown(rotateView(canonicalQuaternion(), 'up'))).toEqual(D('z', 1))
    expect(viewDown(rotateView(canonicalQuaternion(), 'down'))).toEqual(D('z', -1))
    expect(viewDown(rotateView(rotateView(canonicalQuaternion(), 'up'), 'up'))).toEqual(D('y', 1))
    expect(viewDown(topDownQuaternion())).toEqual(D('z', -1))
  })

  it('a view caught mid-turn, exactly at 45 degrees, keeps the down it had', () => {
    const q = canonicalQuaternion().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4))
    expect(viewDown(q, D('y', -1))).toEqual(D('y', -1))
    expect(viewDown(q, D('x', 1))).toEqual(D('x', 1))
  })
})

describe('heights along gravity', () => {
  const p = { x: 10n, y: 20n, z: 30n }
  it('measure up, against gravity, on every axis', () => {
    for (const g of SIX) {
      const up = upOf(g)
      expect(heightOf(raised(p, g, 3n), g) - heightOf(p, g)).toBe(3n)
      expect(raised(p, g, 3n)[up.axis] - p[up.axis]).toBe(BigInt(up.dir) * 3n)
      expect(atHeight(p, g, heightOf(p, g))).toEqual(p)
      expect(heightOf(atHeight(p, g, 7n), g)).toBe(7n)
      // The other two axes never move.
      for (const a of ['x', 'y', 'z'] as const) if (a !== g.axis) expect(raised(p, g, 5n)[a]).toBe(p[a])
    }
    expect(heightOf(p, WORLD_DOWN)).toBe(20n)
    expect(raised(p, WORLD_DOWN, 2n)).toEqual({ x: 10n, y: 22n, z: 30n })
  })
})

describe('the WALK keys under rotated gravity', () => {
  it('stay level across gravity however far you look up or down: up is against gravity, W is forward on the floor', () => {
    for (const g of SIX) {
      const local = viewAxes(viewFor(g))
      // The camera turns about the scene's local Y, the view's up: pitched and yawed, no roll.
      for (const pitch of [0, 0.5, 1.0, 1.4, 1.55, -1.2]) {
        for (const yaw of [0, 0.3, 1.2, 2.5, -2.0]) {
          const forward = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
          const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
          const up = new Vector3().crossVectors(right, forward).normalize()
          const keys = levelScreenAxes(right, up, forward.clone().negate(), local, g)
          expect(keys.up).toEqual(upOf(g))
          expect(keys.out.axis).not.toBe(g.axis)
          expect(keys.right.axis).not.toBe(g.axis)
        }
      }
    }
  })

  it('without a down given, are level for -Y as before', () => {
    const local = viewAxes(canonicalQuaternion())
    const keys = levelScreenAxes(new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), local)
    expect(keys.up).toEqual({ axis: 'y', dir: 1 })
  })
})
