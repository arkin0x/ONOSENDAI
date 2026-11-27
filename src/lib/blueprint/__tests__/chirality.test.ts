/**
 * chirality.test.ts - every flat blueprint picture is a view a player could
 * really see (axis audit, 2026-11-27; CYBERSPACE_V2 §11.1: facing +Z with +Y
 * up, +X is on the right). An L-shaped build, cells (0,0,0), (1,0,0) and
 * (0,0,1), is projected by the game's own frame as the oracle: cyberspace to
 * render through sno-core toRender (Z negated) and a three.js camera placed
 * as the game places it (lib/space.ts topDownQuaternion for the view from
 * above). Each drawing must put every pair of cells on the same sides as the
 * camera does.
 */

import { describe, expect, it } from 'vitest'
import { OrthographicCamera, Vector3 } from 'three'
import { toRender } from 'sno-core/shards'
import { topDownQuaternion } from '../../space'
import { axisGrid, isoLayout, isoPoint, type AxisView } from '../draw'
import { projectPrizePoint } from '../prizeViews'
import { cellIndex, type FinderView } from '../format'

const L_CELLS: Array<[number, number, number]> = [[0, 0, 0], [1, 0, 0], [0, 0, 1]]
const size: [number, number, number] = [2, 1, 2]
const view: FinderView = {
  size,
  occupied: Array.from({ length: 4 }, (_, i) => [0, 1, 2].includes(i)),
  revealed: new Map([[0, 1], [1, 1], [2, 1]]),
}
const centre = (c: readonly number[]): [number, number, number] => [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5]

/** The game's camera for a view, looking at the build's middle. */
function camera(v: AxisView | 'iso'): OrthographicCamera {
  const cam = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  const mid = new Vector3(...toRender([1, 0.5, 1]))
  const at = (cs: [number, number, number]): void => { cam.position.set(...toRender(cs)); cam.up.set(0, 1, 0); cam.lookAt(mid) }
  if (v === 'z') at([1, 0.5, -20]) // facing the sun, from the -Z side
  else if (v === 'x') at([21, 0.5, 1]) // from +X, looking along -X
  else if (v === 'iso') at([21, 20.5, -19]) // from the (+X, +Y, -Z) corner
  else { cam.position.set(...toRender([1, 21, 1])); cam.quaternion.copy(topDownQuaternion()) } // from above
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

/** A cyberspace point on the camera's screen: [right, down]. */
function oracle(cam: OrthographicCamera, p: readonly [number, number, number]): [number, number] {
  const v = new Vector3(...toRender([p[0], p[1], p[2]])).project(cam)
  return [v.x, -v.y]
}

/** Whether two pictures agree on which side of each other every pair lies (right/left and above/below), where they differ. */
function sameSides(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a.length; j++) {
    for (const k of [0, 1]) {
      const da = a[i][k] - a[j][k], db = b[i][k] - b[j][k]
      if (Math.abs(da) > 1e-6 && Math.abs(db) > 1e-6 && Math.sign(da) !== Math.sign(db)) return false
    }
  }
  return true
}

describe('chirality: the pictures match the game camera', () => {
  for (const v of ['x', 'y', 'z'] as const) {
    it(`the sheet's view ${v} matches the camera`, () => {
      const cam = camera(v)
      const g = axisGrid(view, v)
      const shown = g.cells.filter((c): c is NonNullable<typeof c> => !!c)
      const drawn = shown.map((c) => [c.col, c.row] as [number, number])
      const seen = shown.map((c) => oracle(cam, centre(L_CELLS[[cellIndex(size, 0, 0, 0), cellIndex(size, 1, 0, 0), cellIndex(size, 0, 0, 1)].indexOf(c.index)])))
      expect(shown.length).toBeGreaterThanOrEqual(2)
      expect(sameSides(drawn, seen)).toBe(true)
    })
  }

  it('the sheet\'s isometric matches the camera from the (+X, +Y, -Z) corner', () => {
    const cam = camera('iso')
    const L = isoLayout(size, { x: 0, y: 0, size: 200 })
    const drawn = L_CELLS.map((c) => isoPoint(L, ...centre(c)))
    const seen = L_CELLS.map((c) => oracle(cam, centre(c)))
    expect(sameSides(drawn, seen)).toBe(true)
  })

  for (const v of ['x', 'y', 'z', 'iso'] as const) {
    it(`the prize picture ${v} matches the camera`, () => {
      const cam = camera(v)
      const drawn = L_CELLS.map((c) => { const p = projectPrizePoint(centre(c), v); return [p[0], p[1]] as [number, number] })
      const seen = L_CELLS.map((c) => oracle(cam, centre(c)))
      expect(sameSides(drawn, seen)).toBe(true)
    })
  }

  it('a mirrored drawing would fail: the test can tell a mirror image', () => {
    const cam = camera('z')
    const mirrored = L_CELLS.map((c) => [-c[0], -c[1]] as [number, number])
    const seen = L_CELLS.map((c) => oracle(cam, centre(c)))
    expect(sameSides(mirrored, seen)).toBe(false)
  })
})
