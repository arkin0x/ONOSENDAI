import { describe, expect, it } from 'vitest'
import { coastTier, linesInWindow, parseCoastline, type Coastline } from './coastline'

/** Hand-build a CST1 buffer the way pack-coastlines.mjs does. */
function pack(lines: number[][][]): ArrayBuffer {
  let points = 0
  for (const l of lines) points += l.length
  const buf = new ArrayBuffer(8 + lines.length * 4 + points * 8)
  const view = new DataView(buf)
  view.setUint8(0, 0x43)
  view.setUint8(1, 0x53)
  view.setUint8(2, 0x54)
  view.setUint8(3, 0x31)
  view.setUint32(4, lines.length, true)
  let o = 8
  for (const l of lines) {
    view.setUint32(o, l.length, true)
    o += 4
    for (const [lat, lon] of l) {
      view.setFloat32(o, lat, true)
      view.setFloat32(o + 4, lon, true)
      o += 8
    }
  }
  return buf
}

describe('parseCoastline', () => {
  it('round-trips lines and computes bounds', () => {
    const c = parseCoastline(pack([
      [[10, 20], [11, 21], [12, 19]],
      [[-5, 170], [-6, -178]],
    ]))
    expect(c.lines).toHaveLength(2)
    expect(Array.from(c.lines[0].pts)).toEqual([10, 20, 11, 21, 12, 19])
    expect(c.lines[0].minLat).toBe(10)
    expect(c.lines[0].maxLat).toBe(12)
    expect(c.lines[0].minLon).toBe(19)
    expect(c.lines[0].maxLon).toBe(21)
    expect(c.lines[1].minLon).toBe(-178)
    expect(c.lines[1].maxLon).toBe(170)
  })

  it('rejects other bytes', () => {
    expect(() => parseCoastline(new ArrayBuffer(4))).toThrow()
    const wrong = pack([[[0, 0], [1, 1]]])
    new DataView(wrong).setUint8(0, 0x58)
    expect(() => parseCoastline(wrong)).toThrow()
  })
})

describe('coastTier', () => {
  it('refines as the window closes in', () => {
    expect(coastTier(55)).toBe('110m')
    expect(coastTier(50)).toBe('110m')
    expect(coastTier(49)).toBe('50m')
    expect(coastTier(46)).toBe('50m')
    expect(coastTier(45)).toBe('10m')
    expect(coastTier(32)).toBe('10m')
  })
})

describe('linesInWindow', () => {
  const coast: Coastline = parseCoastline(pack([
    [[10, 20], [12, 22]],
    [[-40, 100], [-42, 104]],
    [[5, 179], [6, 179.9]],
  ]))

  it('selects by bounds', () => {
    expect(linesInWindow(coast, 9, 13, 19, 23)).toHaveLength(1)
    expect(linesInWindow(coast, -50, 50, -180, 180)).toHaveLength(3)
    expect(linesInWindow(coast, 30, 60, 0, 10)).toHaveLength(0)
  })

  it('sees across the antimeridian through the +-360 aliases', () => {
    // A window past +180: [170, 190] names the seam's far side too.
    expect(linesInWindow(coast, 0, 10, 170, 190)).toHaveLength(1)
    // The same coastline from the other approach, window below -180.
    expect(linesInWindow(coast, 0, 10, -190, -170)).toHaveLength(1)
  })
})
