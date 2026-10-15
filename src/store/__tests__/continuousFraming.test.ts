/**
 * What these prove: the camera frames you where you are drawn. From 2^80 up
 * the scene places everything at its true position (placeCentre), you
 * included, so the camera's target, cursorOffset, has to be that position
 * too, not the centre of your cell: framed on the centre, the view would
 * look at an empty point up to half a cell beside you. Below 2^80 nothing
 * changes and the target is the cell centre it always was (arkinox,
 * 2026-10-01).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { alignedOrigin, useCyberspace } from '../useCyberspace'
import { CONTINUOUS_SCALE_MIN, MAX_SCALE_EXP, anchorCentre, placeCentre, type Position } from '../../lib/space'

const S = () => useCyberspace.getState()

/** Bits all the way down, so every zoom sees a different sub-cell fraction. */
const HERE: Position = {
  x: (1n << 84n) + 0x1d3c5a7f9e1b2c3d4e5fn,
  y: 0x0fedcba9876543210abcn,
  z: (3n << 82n) + 0x123456789abcdef0123n,
}

const flat = (v: number[]): number[] => v.map((n) => (n === 0 ? 0 : n))

describe('the camera target from 2^80 up', () => {
  beforeEach(() => {
    S().clearFocus()
    useCyberspace.setState({ position: HERE, anchor: HERE, cursor: HERE, spectate: null, exploreIndex: null, transit: null })
  })

  it('is the cell centre at 2^79 and below, as before', () => {
    for (let scaleExp = 0; scaleExp < CONTINUOUS_SCALE_MIN; scaleExp++) {
      useCyberspace.setState({ scaleExp })
      expect(flat(S().cursorOffset()), `scaleExp ${scaleExp}`).toEqual([0, 0, 0])
    }
  })

  it('is where your avatar is drawn, at every scale in the range', () => {
    for (let scaleExp = CONTINUOUS_SCALE_MIN; scaleExp <= MAX_SCALE_EXP; scaleExp++) {
      useCyberspace.setState({ scaleExp })
      const target = S().cursorOffset()
      expect(target).toEqual(anchorCentre(HERE, scaleExp, S().axes()))
      // And it really is off the centre: the sub-cell fraction is not a half.
      expect(target.some((v) => Math.abs(v) > 1e-3)).toBe(true)
    }
  })

  it('follows the cursor to the true position it is drawn at', () => {
    useCyberspace.setState({ scaleExp: 82 })
    S().moveCursor(S().axes().right)
    const cursor = S().cursor
    expect(cursor).not.toEqual(HERE)
    const drawn = placeCentre(cursor, alignedOrigin(HERE, 82), 82, S().axes())
    expect(S().cursorOffset()).toEqual(drawn)
    // One step of the cursor is one whole cell from where you stand.
    const you = anchorCentre(HERE, 82, S().axes())
    expect(drawn[0] - you[0]).toBeCloseTo(1, 4)
  })

  it('stays on the anchor when there is no cursor to drive', () => {
    // History: the scene is anchored on a link and the camera sits on it,
    // where the avatar standing in for it is drawn.
    useCyberspace.setState({ scaleExp: 84, exploreIndex: 0 })
    expect(S().canDrive()).toBe(false)
    expect(S().cursorOffset()).toEqual(anchorCentre(HERE, 84, S().axes()))
  })
})
