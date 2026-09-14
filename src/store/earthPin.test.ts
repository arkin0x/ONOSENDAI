/**
 * What these prove: the pin's lifecycle, which is the whole of its
 * specification. It is dropped where you look on Earth, it SURVIVES looking
 * at something else (that is the point of it, and the reason it is not
 * derived from the focus), and it goes away on RETURN or on REMOVE PIN.
 * Clicking it looks at it again at the zoom it was dropped at.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useCyberspace } from './useCyberspace'
import { gpsToDataspaceXyz } from '../lib/hyperspace/landfall'

const S = () => useCyberspace.getState()

/** The Moscone Center, on the ellipsoid, the way the POSITION panel reaches it. */
const MOSCONE = gpsToDataspaceXyz(37.7847, -122.4011)
const SYDNEY = gpsToDataspaceXyz(-33.8568, 151.2153)
/** A block somewhere else entirely: what clicking a landfall focuses. */
const BLOCK = { x: 1n << 84n, y: (1n << 84n) + 99n, z: 1n << 84n }

describe('the pin', () => {
  beforeEach(() => { S().clearFocus(); S().clearPin() })

  it('is dropped where you look, and replaced rather than stacked', () => {
    S().dropPin(MOSCONE, 'EARTH · 37.8°N 122.4°W', 38)
    expect(S().pin).toEqual({ position: MOSCONE, plane: 0, scaleExp: 38, label: 'EARTH · 37.8°N 122.4°W' })
    S().dropPin(SYDNEY, 'EARTH · 33.9°S 151.2°E', 41)
    expect(S().pin?.position).toEqual(SYDNEY)
    expect(S().pin?.scaleExp).toBe(41)
  })

  it('takes the zoom you are at when none is given', () => {
    S().focusOn(MOSCONE, 0, 'SOMEWHERE', 44, true)
    S().dropPin(MOSCONE, 'EARTH · HERE')
    expect(S().pin?.scaleExp).toBe(44)
  })

  // The table from the brief, one row per transition.
  it('survives a look at a block, and goes away on RETURN and on REMOVE PIN', () => {
    // dropped
    S().focusOn(MOSCONE, 0, 'MOSCONE', 46, true)
    S().dropPin(MOSCONE, 'EARTH · MOSCONE', 46)
    expect(S().pin?.position).toEqual(MOSCONE)

    // a landfall clicked: the focus moves, the pin does not. This is the
    // whole reason the pin is its own state and not a reading of the focus.
    S().focusOn(BLOCK, 0, 'BLOCK 865944 · LANDFALL', 46)
    expect(S().focus?.label).toBe('BLOCK 865944 · LANDFALL')
    expect(S().pin?.position).toEqual(MOSCONE)

    // clicked again: back to the pin, at the zoom it was dropped at, driven
    // so the cursor comes along and a shard composed here lands there.
    S().focusOn(BLOCK, 0, 'BLOCK 865944 · LANDFALL', 32)
    S().viewPin()
    expect(S().focus?.position).toEqual(MOSCONE)
    expect(S().focus?.drive).toBe(true)
    expect(S().scaleExp).toBe(46)
    expect(S().pin?.position).toEqual(MOSCONE)

    // RETURN ends the look and the pin with it.
    S().clearFocus()
    expect(S().focus).toBeNull()
    expect(S().pin).toBeNull()
  })

  it('REMOVE PIN takes the pin without ending the look', () => {
    S().focusOn(MOSCONE, 0, 'MOSCONE', 46, true)
    S().dropPin(MOSCONE, 'EARTH · MOSCONE', 46)
    S().clearPin()
    expect(S().pin).toBeNull()
    expect(S().focus?.label).toBe('MOSCONE')
  })

  it('viewing a pin that is not there does nothing', () => {
    expect(S().pin).toBeNull()
    S().viewPin()
    expect(S().focus).toBeNull()
  })
})
