/**
 * walkWall.test.ts - WALK draws one striped box: the highest whose nearest
 * face is within 10 cells, else the second smallest, held with hysteresis.
 */
import { describe, expect, it } from 'vitest'
import { nearestFace, pickWall, WALL_KEEP_CELLS, WALL_NEAR_CELLS, type WallBox } from '../walkWall'

/** A cube of `side` cells with its lowest corner at the origin. */
const cube = (height: number, side: number): WallBox => ({ height, min: [0, 0, 0], size: [side, side, side] })
// Nested as Rooms draws them: 8, 16 and 32 cells, all from one corner.
const NEST = [cube(3, 8), cube(4, 16), cube(5, 32)]

describe('nearestFace', () => {
  it('inside, is the distance to the closest of the six faces', () => {
    expect(nearestFace(cube(5, 32), [16, 16, 3])).toBe(3)
    expect(nearestFace(cube(5, 32), [16, 30, 16])).toBe(2)
  })

  it('outside, is the straight distance to the box', () => {
    expect(nearestFace(cube(3, 8), [11, 4, 4])).toBe(3)
    expect(nearestFace(cube(3, 8), [11, 12, 4])).toBe(5)
  })
})

describe('pickWall', () => {
  it('has nothing to draw with no boxes', () => {
    expect(pickWall([], [0, 0, 0], null)).toBeNull()
  })

  it('draws the highest box whose nearest face is within reach', () => {
    // 2 cells from the h5 box's floor, inside everything.
    expect(pickWall(NEST, [4, 4, 2], null)).toBe(5)
    // Deep in h5 (16 from every face) but near h4's far faces.
    expect(pickWall(NEST, [14, 14, 14], null)).toBe(4)
  })

  it('falls back to the second smallest when no face is near', () => {
    // A wide nest where the eye is far from every face.
    const wide = [cube(3, 40), cube(4, 80), cube(5, 160)]
    expect(pickWall(wide, [20, 20, 20], null)).toBe(4)
  })

  it('uses the only box when one is drawn', () => {
    expect(pickWall([cube(84, 40)], [20, 20, 20], null)).toBe(84)
  })

  it('keeps the box on show until it is beyond the keep distance', () => {
    const wide = [cube(3, 40), cube(4, 80), cube(5, 160)]
    // h3's nearest face is 11 cells away: past NEAR, inside KEEP.
    const eye: [number, number, number] = [20, 20, WALL_NEAR_CELLS + 1]
    expect(pickWall(wide, eye, null)).toBe(4)
    expect(pickWall(wide, eye, 3)).toBe(3)
    // Past KEEP: it lets go, to the fallback.
    expect(pickWall(wide, [20, 20, WALL_KEEP_CELLS + 1], 3)).toBe(4)
  })

  it('switches up at once when a harder wall comes within reach', () => {
    // Showing h4, and the h5 floor is now 2 cells away.
    expect(pickWall(NEST, [4, 4, 2], 4)).toBe(5)
  })

  it('does not drop to a lower box while the one on show is still held', () => {
    // h3 is 5 cells off and qualifies; h5, on show, is 11 off: past NEAR,
    // still held by KEEP, and a lower box is no reason to switch.
    const boxes: WallBox[] = [cube(3, 40), { height: 5, min: [-6, -6, -6], size: [160, 160, 160] }]
    expect(pickWall(boxes, [20, 20, 5], null)).toBe(3)
    expect(pickWall(boxes, [20, 20, 5], 5)).toBe(5)
  })
})
