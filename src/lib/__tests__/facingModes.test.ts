/**
 * facingModes.test.ts - FACING (DECK-0003 §1.18): PATH tilts along a move,
 * UPRIGHT turns about the view's up alone, keeps its heading on a move
 * straight up or down, and stays upright to the viewer however the 3D
 * compass has turned the world. Unknown values turn along the path.
 */
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { avatarTurn, crossesUp, faceOf, facingTurn, headingPair, uprightTurn } from '../facing'
import { canonicalQuaternion, renderDirection, rotateView, viewAxes, type Position, type RotateDirection, type ViewAxes } from '../space'

const at = (x: bigint, y: bigint, z: bigint): Position => ({ x, y, z })
const O = at(100n, 100n, 100n)
const by = (d: [number, number, number], from: Position = O): Position => at(from.x + BigInt(d[0]), from.y + BigInt(d[1]), from.z + BigInt(d[2]))
const CANON = viewAxes(canonicalQuaternion())
const NOSE = new Vector3(0, 0, -1) // model nose (payload -Z) as the scene draws it
const TOP = new Vector3(0, 1, 0)
const r3 = (v: Vector3): number[] => v.toArray().map((n) => +n.toFixed(3) + 0)
const apply = (q: Quaternion, v: Vector3): number[] => r3(v.clone().applyQuaternion(q))
const link = (position: Position): { position: Position } => ({ position })

/** Every view the compass reaches: the canonical one turned by up to five quarter turns, every way. */
function allViews(): ViewAxes[] {
  const seen = new Map<string, ViewAxes>()
  const dirs: RotateDirection[] = ['up', 'down', 'left', 'right']
  let frontier = [canonicalQuaternion()]
  for (let depth = 0; depth < 6; depth++) {
    const next: Quaternion[] = []
    for (const q of frontier) {
      const a = viewAxes(q)
      const key = JSON.stringify(a)
      if (seen.has(key)) continue
      seen.set(key, a)
      for (const d of dirs) next.push(rotateView(q.clone(), d))
    }
    frontier = next
  }
  return [...seen.values()]
}

describe('PATH and UPRIGHT on a move up and to the right', () => {
  const move: [Position, Position] = [O, by([1, 1, 0])]
  it('PATH points its nose along the move and tilts its top back with it', () => {
    const q = facingTurn(CANON, move, 'path')
    expect(apply(q, NOSE)).toEqual([0.707, 0.707, 0])
    expect(apply(q, TOP)).toEqual([-0.707, 0.707, 0])
  })
  it('UPRIGHT turns to face right and keeps its top up: no tilt', () => {
    const q = facingTurn(CANON, move, 'upright')
    expect(apply(q, NOSE)).toEqual([1, 0, 0])
    expect(apply(q, TOP)).toEqual([0, 1, 0])
  })
  it('on a level move the two agree', () => {
    const level: [Position, Position] = [O, by([3, 0, -2])]
    const a = facingTurn(CANON, level, 'path'), b = facingTurn(CANON, level, 'upright')
    expect(apply(a, NOSE)).toEqual(apply(b, NOSE))
    expect(apply(a, TOP)).toEqual(apply(b, TOP))
  })
})

describe('UPRIGHT keeps its heading on a move straight up or down', () => {
  const A = O, B = by([1, 0, 0], A), C = by([0, 5, 0], B), D = by([0, -2, 0], C)
  const chain = [A, B, C, D].map(link)
  it('looks back to the last move that went across the view\'s up', () => {
    expect(headingPair(chain, null, 'upright', CANON)!.map((l) => l.position)).toEqual([A, B])
    expect(headingPair(chain, 2, 'upright', CANON)!.map((l) => l.position)).toEqual([A, B])
    // PATH takes the move itself.
    expect(headingPair(chain, null, 'path', CANON)!.map((l) => l.position)).toEqual([C, D])
  })
  it('so after climbing it still faces right, upright', () => {
    const pair = headingPair(chain, null, 'upright', CANON)!
    const q = facingTurn(CANON, [pair[0].position, pair[1].position], 'upright')
    expect(apply(q, NOSE)).toEqual([1, 0, 0])
    expect(apply(q, TOP)).toEqual([0, 1, 0])
  })
  it('with nothing before, takes the first level move after, as the spawn faces the first move out', () => {
    const up = [A, by([0, 3, 0], A), by([0, 3, 2], A)].map(link)
    expect(headingPair(up, 1, 'upright', CANON)!.map((l) => l.position)).toEqual([up[1].position, up[2].position])
  })
  it('with no level move at all, stands at rest, turned about up alone', () => {
    const climb = [A, by([0, 1, 0], A), by([0, 4, 0], A)].map(link)
    expect(headingPair(climb, null, 'upright', CANON)).toBeNull()
    const q = uprightTurn(CANON, null)
    expect(apply(q, TOP)).toEqual([0, 1, 0])
    // Its rest front, cyberspace +Z, toward the black sun: render -Z in the canonical view.
    expect(apply(q, NOSE)).toEqual(apply(avatarTurn(CANON, null), NOSE))
  })
  it('a hair sideways on a long climb is straight up: the turn has no heading in it to read', () => {
    expect(crossesUp(A, at(A.x + 1n, A.y + (1n << 40n), A.z), CANON)).toBe(false)
    expect(crossesUp(A, by([1, 1, 0]), CANON)).toBe(true)
  })
})

describe('UPRIGHT under a world turned with the 3D compass', () => {
  const views = allViews()
  it('reaches all 24 views', () => { expect(views.length).toBe(24) })

  it('is upright to the viewer in every view, whatever the move', () => {
    const moves: Array<[number, number, number] | null> = [null, [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 2, 3], [5, -1, 0], [0, -7, 2]]
    for (const axes of views) {
      for (const d of moves) {
        const q = facingTurn(axes, d ? [O, by(d)] : null, 'upright')
        expect(apply(q, TOP), JSON.stringify({ axes, d })).toEqual([0, 1, 0])
      }
    }
  })

  it('a quarter turn putting cyberspace +X up: the avatar stands along +X, and a move along +X keeps the heading', () => {
    const xUp = views.find((a) => a.up.axis === 'x' && a.up.dir === 1)!
    expect(renderDirection(xUp, 'x')).toEqual([0, 1, 0])
    // PATH turns with the world: its top is cyberspace +Y, which now lies across the screen.
    expect(apply(facingTurn(xUp, null, 'path'), TOP)).not.toEqual([0, 1, 0])
    // UPRIGHT stands on the viewer's up.
    expect(apply(facingTurn(xUp, null, 'upright'), TOP)).toEqual([0, 1, 0])
    const A = O, B = by([0, 0, 2], A), C = by([3, 0, 0], B)
    const chain = [A, B, C].map(link)
    expect(crossesUp(B, C, xUp)).toBe(false)
    const pair = headingPair(chain, null, 'upright', xUp)!
    expect(pair.map((l) => l.position)).toEqual([A, B])
    const q = facingTurn(xUp, [pair[0].position, pair[1].position], 'upright')
    const z = renderDirection(xUp, 'z')
    expect(apply(q, NOSE)).toEqual(z.map((n) => n + 0))
    expect(apply(q, TOP)).toEqual([0, 1, 0])
  })

  it('with cyberspace +Z up and no move, it faces cyberspace -Y; with -Z up, +Y (the smallest turn upright)', () => {
    const zUp = views.find((a) => a.up.axis === 'z' && a.up.dir === 1)!
    const zDown = views.find((a) => a.up.axis === 'z' && a.up.dir === -1)!
    expect(apply(uprightTurn(zUp, null), NOSE)).toEqual(renderDirection(zUp, 'y').map((n) => -n + 0))
    expect(apply(uprightTurn(zDown, null), NOSE)).toEqual(renderDirection(zDown, 'y').map((n) => n + 0))
  })
})

describe('faceOf: unknown values turn along the path', () => {
  it('reads upright, and everything else as path', () => {
    expect(faceOf({ extra: { face: 'upright' } })).toBe('upright')
    for (const bad of [undefined, null, 'Upright', 'UPRIGHT', '', 'level', 1, true, ['upright'], { face: 'upright' }]) {
      expect(faceOf({ extra: { face: bad } }), JSON.stringify(bad)).toBe('path')
    }
    expect(faceOf({})).toBe('path')
    expect(faceOf(null)).toBe('path')
  })
  it('a path avatar turns exactly as before', () => {
    const move: [Position, Position] = [O, by([2, 1, -1])]
    expect(facingTurn(CANON, move, faceOf({ extra: { face: 'sideways' } })).equals(avatarTurn(CANON, move))).toBe(true)
  })
})
