/**
 * What these prove: the HYPERSPACE tag can always get back to READY.
 *
 * The tag reads DRAWING from the moment a rebuild starts until it commits.
 * A rebuild does not always commit: the effect is cancelled whenever the
 * anchor, the zoom or the sphere changes, and its successor may look at how
 * far the view drifted and decide there is nothing to rebuild. Nobody calls
 * commit on that path, so without a settle the flag stays raised with no
 * build left to lower it, which is the bug arkinox hit: DRAWING forever.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useHyperspace } from './useHyperspace'

const field = () => useHyperspace.getState().field

describe('field status', () => {
  beforeEach(() => { useHyperspace.getState().fieldDone(0, null) })

  it('starts settled', () => {
    expect(field().building).toBe(false)
  })

  it('reads DRAWING from the start of a rebuild until it commits', () => {
    useHyperspace.getState().fieldBuilding()
    expect(field().building).toBe(true)
    useHyperspace.getState().fieldDone(187, 187)
    expect(field()).toEqual({ building: false, drawn: 187, inside: 187 })
  })

  it('settles a cancelled rebuild without disturbing the counts on screen', () => {
    useHyperspace.getState().fieldDone(187, 187)
    useHyperspace.getState().fieldBuilding()
    // The effect is torn down before it commits: a zoom, a nudge, a new sphere.
    useHyperspace.getState().fieldSettled()
    expect(field()).toEqual({ building: false, drawn: 187, inside: 187 })
  })

  it('stays settled when a successor decides it has nothing to rebuild', () => {
    useHyperspace.getState().fieldBuilding()
    useHyperspace.getState().fieldSettled()
    // The successor returns early on drift and never calls commit.
    expect(field().building).toBe(false)
  })

  it('raises the flag again for a successor that does rebuild', () => {
    useHyperspace.getState().fieldBuilding()
    useHyperspace.getState().fieldSettled()
    useHyperspace.getState().fieldBuilding()
    expect(field().building).toBe(true)
    useHyperspace.getState().fieldDone(4, 4)
    expect(field().building).toBe(false)
  })

  it('settling when nothing is building changes nothing', () => {
    useHyperspace.getState().fieldDone(12, 12)
    const before = field()
    useHyperspace.getState().fieldSettled()
    expect(field()).toBe(before)
  })

  it('an empty sphere settles to READY with a zero count, not to DRAWING', () => {
    // No landfall within the radius is a real answer, and the tag must say so.
    useHyperspace.getState().fieldBuilding()
    useHyperspace.getState().fieldDone(0, 0)
    expect(field()).toEqual({ building: false, drawn: 0, inside: 0 })
  })
})
