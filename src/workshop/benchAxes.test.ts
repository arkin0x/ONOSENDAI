import { describe, expect, it } from 'vitest'
import { DEFAULT_AXES, nudgeFor, nudgeLabel, planeAfter } from './benchAxes'

describe('benchAxes', () => {
  it('turns screen directions into model moves, with Z mirrored as the bench draws it', () => {
    expect(nudgeFor(DEFAULT_AXES, 'right')).toEqual({ axis: 0, delta: 1 })
    expect(nudgeFor(DEFAULT_AXES, 'left')).toEqual({ axis: 0, delta: -1 })
    expect(nudgeFor(DEFAULT_AXES, 'up')).toEqual({ axis: 1, delta: 1 })
    expect(nudgeFor(DEFAULT_AXES, 'down')).toEqual({ axis: 1, delta: -1 })
    // Toward the viewer is render +Z, which is model -Z; away is model +Z, where cyberspace +Z points.
    expect(nudgeFor(DEFAULT_AXES, 'toward')).toEqual({ axis: 2, delta: -1 })
    expect(nudgeFor(DEFAULT_AXES, 'away')).toEqual({ axis: 2, delta: 1 })
    expect(nudgeLabel(nudgeFor(DEFAULT_AXES, 'away'))).toBe('+Z')
  })
})

describe('planeAfter', () => {
  const top = { right: { axis: 0, dir: 1 }, up: { axis: 2, dir: -1 }, out: { axis: 1, dir: 1 } } as const
  it('tips the floor up to face the viewer and rolls it to face the side', () => {
    expect(planeAfter(1, DEFAULT_AXES, 'tip')).toBe(2)
    expect(planeAfter(1, DEFAULT_AXES, 'roll')).toBe(0)
    expect(planeAfter(2, DEFAULT_AXES, 'tip')).toBe(1)
    expect(planeAfter(0, DEFAULT_AXES, 'roll')).toBe(1)
  })
  it('falls back to the screen vertical when the turn would be about the normal', () => {
    // From straight above the line of sight is Y, the floor's own normal.
    expect(planeAfter(1, top, 'roll')).toBe(0)
    expect(planeAfter(1, top, 'tip')).toBe(2)
  })
})
