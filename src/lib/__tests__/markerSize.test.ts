/**
 * Stop markers and their labels are sized on screen (arkinox, 2026-10-15):
 * a cube is its true size when that is larger, else a fixed pixel size, and
 * its label sits just above its top at every zoom.
 */
import { describe, expect, it } from 'vitest'
import { CUBE_REACH, DEST_CUBE_PX, FLEET_CUBE_PX, LABEL_GAP_PX, cellsForPixels, labelLiftPx, markerSide, pixelsForCells, projScaleOf } from '../markerSize'

const proj = projScaleOf(915, 55)

describe('markers held at a size on screen', () => {
  it('pixels and cells convert both ways at any depth', () => {
    for (const depth of [0.5, 3, 26, 400]) {
      expect(pixelsForCells(cellsForPixels(12, depth, proj), depth, proj)).toBeCloseTo(12, 9)
    }
  })

  it('a sub-pixel gibson (2^84) is drawn at the pixel size, the same on screen near or far', () => {
    const gibson = 2 ** -84
    for (const depth of [0.8, 5, 60]) {
      expect(pixelsForCells(markerSide(gibson, DEST_CUBE_PX, depth, proj), depth, proj)).toBeCloseTo(DEST_CUBE_PX, 6)
      expect(pixelsForCells(markerSide(gibson * 0.5, FLEET_CUBE_PX, depth, proj), depth, proj)).toBeCloseTo(FLEET_CUBE_PX, 6)
    }
  })

  it('a gibson larger on screen than the floor (2^0, close) keeps its true size', () => {
    expect(markerSide(1, DEST_CUBE_PX, 2, proj)).toBe(1)
  })

  it("lifts a label by the marker's reach on screen plus a gap plus half the label", () => {
    const lift = labelLiftPx(2 ** -84, FLEET_CUBE_PX, 4, proj, 9)
    expect(lift).toBeCloseTo(FLEET_CUBE_PX * CUBE_REACH + LABEL_GAP_PX + 4.5, 9)
    // The same few pixels at 2^84 and at 2^76: the gap no longer grows with the zoom.
    expect(labelLiftPx(2 ** -76, FLEET_CUBE_PX, 30, proj, 9)).toBeCloseTo(lift, 6)
    // A true-size cube larger than the floor lifts its label above its own top.
    const big = labelLiftPx(1, FLEET_CUBE_PX, 2, proj, 9)
    expect(big).toBeCloseTo(pixelsForCells(1, 2, proj) * CUBE_REACH + LABEL_GAP_PX + 4.5, 9)
  })

  it('the destination stands out but does not dominate', () => {
    expect(DEST_CUBE_PX).toBeGreaterThan(FLEET_CUBE_PX)
    expect(DEST_CUBE_PX).toBeLessThanOrEqual(2 * FLEET_CUBE_PX)
  })
})
