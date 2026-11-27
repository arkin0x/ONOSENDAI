/**
 * terrainAirPlace.test.ts - the ghost block at arm's length
 * (lib/terrain/airPlace.ts; owner, 2026-11-27: "we need to make it so you can
 * place blocks in the air", option A): the ghost's cell for a ray and a
 * distance, snapped and clamped; a hit always comes first; a cell taken by a
 * block or by your own body is refused in plain words.
 */

import { describe, expect, it } from 'vitest'
import {
  AIR_DEFAULT, AIR_MAX, AIR_MIN, AIR_OCCUPIED, AIR_TOO_CLOSE, airCell, airProblem, bodyCells, clampAirDistance, placeTarget,
} from '../terrain/airPlace'
import { CURSOR_REACH } from '../terrain/world'
import { raycast } from '../terrain/raycast'

describe('the distance', () => {
  it('starts at 3 blocks and runs from 1 to the cursor\'s reach, in whole blocks', () => {
    expect(AIR_DEFAULT).toBe(3)
    expect(AIR_MIN).toBe(1)
    expect(AIR_MAX).toBe(CURSOR_REACH)
    expect(clampAirDistance(0)).toBe(1)
    expect(clampAirDistance(-4)).toBe(1)
    expect(clampAirDistance(99)).toBe(AIR_MAX)
    expect(clampAirDistance(2.4)).toBe(2)
    expect(clampAirDistance(Number.NaN)).toBe(AIR_DEFAULT)
  })
})

describe('the ghost\'s cell', () => {
  it('stands the distance along the look, in the cell that point falls in', () => {
    expect(airCell([0, 0, 0], [0, 0, -1], 3)).toEqual([0, 0, -3])
    expect(airCell([0, 0, 0], [1, 0, 0], 1)).toEqual([1, 0, 0])
    // A direction of any length: only its way counts.
    expect(airCell([0, 0, 0], [0, 10, 0], 2)).toEqual([0, 2, 0])
    // From an eye off the cell's centre, snapped: 0.3 + 3 is 3.3, in the cell centred on 3.
    expect(airCell([0.3, -0.2, 0], [1, 0, 0], 3)).toEqual([3, 0, 0])
    // 0.4 + 3 * cos(45deg) is about 2.52: the cell centred on 3; -0.4 + 2.12 is 1.72: the cell centred on 2.
    expect(airCell([0.4, -0.4, 0], [1, 1, 0], 3)).toEqual([3, 2, 0])
  })

  it('clamps the distance it is given', () => {
    expect(airCell([0, 0, 0], [0, 0, -1], 40)).toEqual([0, 0, -AIR_MAX])
    expect(airCell([0, 0, 0], [0, 0, -1], 0)).toEqual([0, 0, -1])
  })

  it('a ray with no direction has no ghost', () => {
    expect(airCell([0, 0, 0], [0, 0, 0], 3)).toBeNull()
  })

  it('is always a cell the look crosses, so with no block met within reach it is open', () => {
    const solid = new Set(['0,-1,0', '5,0,0'])
    const isSolid = (i: number, j: number, k: number): boolean => solid.has(`${i},${j},${k}`)
    const dir: [number, number, number] = [0.3, 0.5, -0.8]
    expect(raycast([0, 0, 0], dir, CURSOR_REACH, isSolid)).toBeNull()
    for (let d = AIR_MIN; d <= AIR_MAX; d++) expect(isSolid(...airCell([0, 0, 0], dir, d)!)).toBe(false)
  })
})

describe('where PLACE goes', () => {
  const hit = { cell: [4, 0, 0] as [number, number, number], normal: [-1, 0, 0] as [number, number, number], distance: 3.5 }
  it('a hit comes first: on its face, even with a ghost nearer', () => {
    expect(placeTarget(hit, [1, 0, 0])).toEqual({ kind: 'face', cell: [3, 0, 0] })
  })
  it('with no hit, the ghost\'s cell', () => {
    expect(placeTarget(null, [0, 3, 0])).toEqual({ kind: 'air', cell: [0, 3, 0] })
  })
  it('a hit with no face (the look starts inside a block) places nothing; nor does no hit and no ghost', () => {
    expect(placeTarget({ cell: [0, 0, 0], normal: [0, 0, 0], distance: 0 }, [0, 3, 0])).toBeNull()
    expect(placeTarget(null, null)).toBeNull()
  })
})

describe('a cell refused', () => {
  const none = (): boolean => false
  it('taken by a block: "Something\'s already there"', () => {
    expect(airProblem([0, 3, 0], (c) => c[1] === 3, [[0, 0, 0]])).toBe(AIR_OCCUPIED)
    expect(AIR_OCCUPIED).toBe("Something's already there")
  })
  it('inside your own body: "Too close to you"', () => {
    const body = bodyCells([0, 0, 0], [0.1, 1.6, 0])
    expect(body).toEqual([[0, 0, 0], [0, 1, 0], [0, 2, 0]])
    expect(airProblem([0, 1, 0], none, body)).toBe(AIR_TOO_CLOSE)
    expect(airProblem([0, 2, 0], none, body)).toBe(AIR_TOO_CLOSE)
    expect(airProblem([0, 0, 0], none, body)).toBe(AIR_TOO_CLOSE)
    expect(AIR_TOO_CLOSE).toBe('Too close to you')
  })
  it('anywhere else open: none', () => {
    expect(airProblem([0, 3, 0], none, bodyCells([0, 0, 0], [0, 0.6, 0]))).toBeNull()
    expect(bodyCells([2, 2, 2], null)).toEqual([[2, 2, 2]])
  })
})
