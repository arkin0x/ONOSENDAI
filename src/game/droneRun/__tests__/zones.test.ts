import { describe, expect, it } from 'vitest'
import { edgePoints, overZone } from '../Zones'

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

describe('edgePoints', () => {
  const box = { lo: [108, 62, 184] as [number, number, number], hi: [148, 80, 204] as [number, number, number] }
  it('stands on every corner and keeps every gap within the spacing', () => {
    const pts = edgePoints(box, 4)
    for (const c of [[108, 184], [148, 184], [148, 204], [108, 204]]) expect(pts).toContainEqual(c)
    // 40 by 20 at 4 apart: 10 + 5 + 10 + 5, each corner once.
    expect(pts.length).toBe(30)
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(4 + 1e-9)
    }
  })
  it('lies on the footprint\'s edge only', () => {
    for (const [x, z] of edgePoints(box, 3)) {
      const onX = x === 108 || x === 148, onZ = z === 184 || z === 204
      expect(onX || onZ).toBe(true)
    }
  })
})
