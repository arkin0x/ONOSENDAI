/**
 * starCross.test.ts: the pin's cross over a starred place (EarthPin.tsx).
 *
 * VIEW on a starred place on Earth drops the pin there, and the pin's cross
 * has to frame the star: same point at every zoom, where it used to sit on
 * the low corner of the gibson's cell at 2^0 (arkinox, 2026-10-08). The pin's
 * label goes when a named star already stands at its point, matched by
 * coordinate and plane. And the star's glow is backed off by half.
 */

import { describe, expect, it } from 'vitest'
import { placedStars, type StarredPlace } from '../../lib/starred'
import type { Position, ViewAxes } from '../../lib/space'
import { alignedOrigin } from '../../store/useCyberspace'
import { gpsToDataspaceXyz } from '../../lib/hyperspace/landfall'
import { pinPoint, starNamesPin } from '../EarthPin'
import { GLOW_BASE, GLOW_REST, GLOW_SWING, STAR_REACH } from '../StarredMarks'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as ViewAxes
/** Looking from behind: two axes flipped, as the view menu can leave them. */
const FLIPPED: ViewAxes = { right: { axis: 'x', dir: -1 }, up: { axis: 'z', dir: 1 }, out: { axis: 'y', dir: -1 } } as ViewAxes

/** The Moscone Center, on the ellipsoid, as a starred place holds it. */
const MOSCONE = gpsToDataspaceXyz(37.7847, -122.4011)
const input = (p: Position): string => `${p.x}, ${p.y}, ${p.z}`
const star = (p: Position, extra: Partial<StarredPlace> = {}): StarredPlace => ({
  input: input(p), label: 'EARTH · 37.8°N 122.4°W', plane: 0, at: 0, scaleExp: 0, nickname: 'MOSCONE', ...extra,
})

const ZOOMS = [0, 1, 2, 10, 30, 52]

describe("the pin's cross over a starred place", () => {
  it('stands exactly where the star is drawn, at every zoom, looking at the place', () => {
    for (const axes of [AXES, FLIPPED]) {
      for (const k of ZOOMS) {
        // VIEW anchors the scene on the place itself.
        const origin = alignedOrigin(MOSCONE, k)
        const drawn = placedStars([star(MOSCONE)], origin, 0, k, axes, Infinity)
        expect(drawn).toHaveLength(1)
        expect(pinPoint(MOSCONE, origin, k, axes)).toEqual(drawn[0].at)
      }
    }
  })

  it('stands where the star is drawn when the scene is anchored somewhere nearby', () => {
    const near = { x: MOSCONE.x + 5n, y: MOSCONE.y - 3n, z: MOSCONE.z + 1n }
    for (const k of ZOOMS) {
      const origin = alignedOrigin(near, k)
      const drawn = placedStars([star(MOSCONE)], origin, 0, k, AXES, Infinity)
      expect(pinPoint(MOSCONE, origin, k, AXES)).toEqual(drawn[0].at)
    }
  })

  it('is in the middle of the gibson at 2^0, not on its corner', () => {
    // At 2^0 the gibson is the whole cell, the cell the view is centered on.
    expect(pinPoint(MOSCONE, alignedOrigin(MOSCONE, 0), 0, AXES)).toEqual([0, 0, 0])
  })
})

describe("the pin's label beside a starred place", () => {
  const origin = alignedOrigin(MOSCONE, 0)

  it('goes when a named star stands at the pin', () => {
    expect(starNamesPin(MOSCONE, [star(MOSCONE)], origin, 0, 0, AXES)).toBe(true)
    // Matched by place, not words: a star named otherwise names the spot too.
    expect(starNamesPin(MOSCONE, [star(MOSCONE, { nickname: 'SOMEWHERE ELSE' })], origin, 0, 0, AXES)).toBe(true)
  })

  it('stays with no star there, a star elsewhere, or a star in the other plane', () => {
    expect(starNamesPin(MOSCONE, [], origin, 0, 0, AXES)).toBe(false)
    const beside = { ...MOSCONE, x: MOSCONE.x + 1n }
    expect(starNamesPin(MOSCONE, [star(beside)], origin, 0, 0, AXES)).toBe(false)
    expect(starNamesPin(MOSCONE, [star(MOSCONE, { plane: 1 })], origin, 0, 0, AXES)).toBe(false)
  })

  it('stays beside a bare star, which has no words of its own', () => {
    const bare = star(MOSCONE, { nickname: undefined, label: '19342…76661, 19342…57376, 19342…11837' })
    expect(starNamesPin(MOSCONE, [bare], origin, 0, 0, AXES)).toBe(false)
  })

  it('stays when the star is past the reach the scene draws stars to', () => {
    const far = { ...MOSCONE, x: MOSCONE.x + BigInt(Math.ceil(STAR_REACH) + 10) }
    expect(starNamesPin(far, [star(far)], origin, 0, 0, AXES)).toBe(false)
  })
})

describe("the star's glow", () => {
  it('is half as opaque as it was (0.55 still, 0.4 to 0.65 breathing)', () => {
    expect(GLOW_REST).toBeCloseTo(0.55 / 2, 10)
    expect(GLOW_BASE).toBeCloseTo(0.4 / 2, 10)
    expect(GLOW_SWING).toBeCloseTo(0.25 / 2, 10)
  })
})
