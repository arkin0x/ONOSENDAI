import { describe, it, expect } from 'vitest'
import { MeshLambertMaterial } from 'three'
import {
  AMBIENT_INTENSITY,
  AMBIENT_SHARE,
  BACK_SHADE,
  BACK_SHADE_COLOR,
  FILL_INTENSITY,
  FILL_SHARE,
  KEY_INTENSITY,
  KEY_POSITION,
  KEY_SHARE,
  SHARD_FACES_TONE_MAPPED,
  faceShare,
} from '../shardLight'

// The bench, the avatar preview and the thumbnails share one rig, anchored at
// the world's full color (arkinox, 2026-10-12). These hold it to that.

/** Normals spread over the whole sphere (a Fibonacci lattice). */
function sphere(n: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const g = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(1 - y * y)
    out.push([Math.cos(g * i) * r, y, Math.sin(g * i) * r])
  }
  return out
}

describe('shardLight', () => {
  const normals = sphere(4000)
  const fronts = normals.map((n) => faceShare(n))
  const backs = normals.map((n) => faceShare(n, true))

  it('never lights a front face past its own color, and reaches it square to the key', () => {
    expect(Math.max(...fronts)).toBeLessThanOrEqual(1 + 1e-9)
    expect(faceShare(KEY_POSITION)).toBeCloseTo(1, 6)
  })

  it('keeps every front face near full color', () => {
    expect(Math.min(...fronts)).toBeGreaterThanOrEqual(AMBIENT_SHARE)
    expect(AMBIENT_SHARE).toBeGreaterThanOrEqual(0.5)
  })

  it('shades a solid enough to tell its faces apart', () => {
    expect(Math.max(...fronts) - Math.min(...fronts)).toBeGreaterThanOrEqual(0.3)
  })

  it('draws the brightest back darker than the darkest front', () => {
    expect(Math.max(...backs)).toBeLessThan(Math.min(...fronts))
    expect(BACK_SHADE).toBeGreaterThan(0)
  })

  it("turns shares into three's Lambert intensities (light divided by pi)", () => {
    expect(AMBIENT_INTENSITY).toBeCloseTo(AMBIENT_SHARE * Math.PI, 9)
    expect(KEY_INTENSITY).toBeCloseTo(KEY_SHARE * Math.PI, 9)
    expect(FILL_INTENSITY).toBeCloseTo(FILL_SHARE * Math.PI, 9)
  })

  it('sets the back multiplier in linear terms, not through color management', () => {
    expect(BACK_SHADE_COLOR.r).toBe(BACK_SHADE)
    expect(BACK_SHADE_COLOR.g).toBe(BACK_SHADE)
    expect(BACK_SHADE_COLOR.b).toBe(BACK_SHADE)
    // As a material color it arrives unchanged (a CSS string would not).
    const m = new MeshLambertMaterial({ color: BACK_SHADE_COLOR })
    expect(m.color.r).toBe(BACK_SHADE)
    m.dispose()
  })

  it('leaves faces out of tone mapping, as the world does', () => {
    expect(SHARD_FACES_TONE_MAPPED).toBe(false)
  })
})
