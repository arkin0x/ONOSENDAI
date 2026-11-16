import { describe, expect, it } from 'vitest'
import { overZone } from '../Zones'

describe('overZone', () => {
  const box = { lo: [114, 66, 66] as [number, number, number], hi: [142, 78, 84] as [number, number, number] }
  it('is true over the footprint (render z is minus cyberspace z)', () => {
    expect(overZone(box, 128, -75)).toBe(true)
    expect(overZone(box, 114, -84)).toBe(true)
  })
  it('is false off the footprint', () => {
    expect(overZone(box, 128, 75)).toBe(false)
    expect(overZone(box, 128, -90)).toBe(false)
    expect(overZone(box, 110, -75)).toBe(false)
  })
})
