import { describe, expect, it } from 'vitest'
import { DEFAULT_AXES, nudgeFor, nudgeLabel } from './benchAxes'

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
