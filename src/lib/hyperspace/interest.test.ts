/**
 * What these prove: the sphere is the formula arkinox gave (h54 at 2^49,
 * h37 at 2^32) and nothing else; it exists only for a chosen point on
 * Earth at 2^49 and finer; the cull is a sphere decided in fixed point,
 * not a box and not a float; shrinking the sphere never re-deals the dots
 * that stayed inside; and the nearest landfall is drawn even when its
 * hash would have left it out.
 */
import { describe, expect, it } from 'vitest'
import { GIBSONS_PER_M, latLonToCsMetres, surfacePosition } from '../earthSurface'
import type { Position } from '../space'
import { landfallXyzApprox } from './landfall'
import { drawnSet } from './sample'
import {
  SELF_GIBSONS,
  SPHERE_SCALE_MAX,
  insideSphere,
  interestSphere,
  isqrt,
  nearestOf,
  onEarthSurface,
  sphereDistance2,
  sphereSelection,
  SPHERE_RADIUS_CELLS,
  sphereFrameDistance,
} from './interest'

const CENTRE = 1n << 84n
const EARTH_CENTRE: Position = { x: CENTRE, y: CENTRE, z: CENTRE }
const TEXAS = surfacePosition(31.6, -98.8)
const surface = (position: Position = TEXAS, plane: 0 | 1 = 0, drive?: boolean) => ({ position, plane, drive })

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A uniform bigint offset in [-r, r). */
function offset(rng: () => number, r: bigint): bigint {
  return (BigInt(Math.floor(rng() * 2 ** 40)) * (2n * r)) / (1n << 40n) - r
}

describe('interestSphere', () => {
  it('is 2^(scaleExp + 5) gibsons: h54 (2097 km) at 2^49, h37 (16 m) at 2^32', () => {
    const top = interestSphere(surface(), 49)
    expect(top).not.toBeNull()
    expect(top!.height).toBe(54)
    expect(top!.radius).toBe(1n << 54n)
    expect(Number(top!.radius) / GIBSONS_PER_M).toBe(2 ** 21)
    expect(Number(top!.radius) / GIBSONS_PER_M / 1000).toBeCloseTo(2097.152, 3)
    const bottom = interestSphere(surface(), 32)
    expect(bottom!.height).toBe(37)
    expect(bottom!.radius).toBe(1n << 37n)
    expect(Number(bottom!.radius) / GIBSONS_PER_M).toBe(16)
    // One height per press of the zoom, all the way down.
    for (let s = 49; s >= 32; s--) expect(interestSphere(surface(), s)!.height).toBe(s + 5)
  })

  it('is 32 cells at every zoom, and the camera must sit about 69 out to frame it', () => {
    expect(SPHERE_RADIUS_CELLS).toBe(32)
    for (const s of [49, 45, 38, 32]) {
      const sphere = interestSphere(surface(), s)!
      // radius in gibsons divided by one cell in gibsons.
      expect(Number(sphere.radius / (1n << BigInt(s)))).toBe(SPHERE_RADIUS_CELLS)
    }
    // The scene's 55 degree camera: 32 / tan(27.5) = 61.5 cells, plus the margin.
    expect(sphereFrameDistance(55, 1)).toBeCloseTo(61.47, 2)
    expect(sphereFrameDistance(55)).toBeCloseTo(68.85, 2)
    // Inside the orbit's own limit (GRID_RADIUS * 4 = 96), and well past the
    // 26 cells a reframe used, which framed 13.5.
    expect(sphereFrameDistance(55)).toBeLessThan(96)
    expect(sphereFrameDistance(55)).toBeGreaterThan(26)
  })

  it('is centred exactly on the focus', () => {
    const sphere = interestSphere(surface(), 45)!
    expect(sphere.centre).toEqual(TEXAS)
    expect(sphere.centre).not.toBe(TEXAS)
  })

  it('is absent at 2^50 and coarser, where the globe is drawn whole', () => {
    expect(SPHERE_SCALE_MAX).toBe(49)
    expect(interestSphere(surface(), 50)).toBeNull()
    expect(interestSphere(surface(), 52)).toBeNull()
    expect(interestSphere(surface(), 84)).toBeNull()
    expect(interestSphere(surface(), 49)).not.toBeNull()
  })

  it('is absent without a focus on Earth', () => {
    expect(interestSphere(null, 40)).toBeNull()
    // EARTH, CYBERSPACE and THE RIDE all focus the planet's centre.
    expect(interestSphere(surface(EARTH_CENTRE), 40)).toBeNull()
    // A port: the same coordinate in ideaspace is not on Earth.
    expect(interestSphere(surface(TEXAS, 1), 40)).toBeNull()
    // Ten kilometers up is not the ground.
    const m = latLonToCsMetres(31.6, -98.8, 10_000)
    const u = (v: number): bigint => CENTRE + BigInt(Math.round(v * GIBSONS_PER_M))
    expect(interestSphere(surface({ x: u(m.x), y: u(m.y), z: u(m.z) }), 40)).toBeNull()
    // Deep space.
    expect(interestSphere(surface({ x: 12345n, y: 1n << 70n, z: 0n }), 40)).toBeNull()
  })

  it('is present for a place typed into the POSITION panel, which drives the cursor', () => {
    // The VIEW field calls focusOn with drive true, so every latitude and
    // longitude and every place by name arrives driven. Excluding those left
    // the sphere off for the one path built to reach a place on Earth.
    const driven = interestSphere(surface(TEXAS, 0, true), 45)
    expect(driven).not.toBeNull()
    expect(driven!.centre).toEqual(TEXAS)
    expect(driven).toEqual(interestSphere(surface(TEXAS, 0, false), 45))
  })

  it('is present for a landfall, whose coordinate is on the ellipsoid', () => {
    // Golden vectors from landfall.test.ts: mainnet blocks 398 and 100399.
    for (const hash of [
      '000000002f7d702a27ccd65158740198f79d4ba1ddea8ab14b56b63a6289fe89',
      '000000000003cb256436f213199e7047e187ab99e6d3176262bfb9be49d2a31a',
    ]) {
      const p = landfallXyzApprox(hash)
      expect(onEarthSurface(p)).toBe(true)
      expect(interestSphere(surface(p), 49)!.centre).toEqual(p)
      expect(interestSphere(surface(p), 32)!.radius).toBe(1n << 37n)
      expect(interestSphere(surface(p), 50)).toBeNull()
    }
  })
})

describe('the cull', () => {
  const sphere = interestSphere(surface(), 49)!
  const r = sphere.radius
  const c = sphere.centre

  it('keeps a point inside and drops one outside, decided in fixed point', () => {
    expect(insideSphere(sphere, c.x, c.y, c.z)).toBe(true)
    expect(insideSphere(sphere, c.x + r, c.y, c.z)).toBe(true)
    expect(insideSphere(sphere, c.x + r + 1n, c.y, c.z)).toBe(false)
    expect(insideSphere(sphere, c.x, c.y - r - 1n, c.z)).toBe(false)
    // One gibson past the boundary at 2^54 is exactly what a Number cannot
    // see: the float rounds it back onto the boundary.
    expect(Number(r + 1n)).toBe(Number(r))
    expect(sphereDistance2(sphere, c.x + r + 1n, c.y, c.z)).toBe((r + 1n) * (r + 1n))
  })

  it('is a sphere, not a box', () => {
    // Inside the bounding box on every axis, outside the ball: 0.6 r along
    // each axis is 1.04 r away. Half of r on each axis is 0.87 r, inside.
    const six = (r * 6n) / 10n
    expect(insideSphere(sphere, c.x + six, c.y + six, c.z + six)).toBe(false)
    const half = r / 2n
    expect(insideSphere(sphere, c.x + half, c.y - half, c.z + half)).toBe(true)
  })
})

describe('the sample inside the sphere', () => {
  const budget = 1000
  // A synthetic population around the focus: heights 0..N-1 scattered
  // uniformly through the cube that bounds the 2^49 sphere.
  const rng = mulberry32(2026)
  const big = interestSphere(surface(), 49)!
  const N = 20_000
  const pts: Array<{ height: number; x: bigint; y: bigint; z: bigint }> = []
  for (let h = 0; h < N; h++) {
    pts.push({ height: h, x: big.centre.x + offset(rng, big.radius), y: big.centre.y + offset(rng, big.radius), z: big.centre.z + offset(rng, big.radius) })
  }
  /** What the field does: the geometric cull, then the selection. */
  const select = (scaleExp: number) => {
    const sphere = interestSphere(surface(), scaleExp)!
    const heights: number[] = []
    const d2: bigint[] = []
    for (const p of pts) {
      const d = sphereDistance2(sphere, p.x, p.y, p.z)
      if (d <= sphere.radius * sphere.radius) {
        heights.push(p.height)
        d2.push(d)
      }
    }
    return { sphere, inside: new Set(heights), sample: drawnSet(heights, budget), ...sphereSelection(heights, d2, budget) }
  }

  it('is deterministic: same sphere, same dots', () => {
    const a = select(48)
    const b = select(48)
    expect([...a.drawn].sort((x, y) => x - y)).toEqual([...b.drawn].sort((x, y) => x - y))
    expect(a.nearest).toEqual(b.nearest)
  })

  it('spends the budget inside the sphere, plus the nearest', () => {
    const at49 = select(49)
    expect(at49.inside.size).toBeGreaterThan(budget * 5)
    // Exactly the budget, plus one if the nearest was not in the sample.
    expect(at49.drawn.size - budget).toBeGreaterThanOrEqual(0)
    expect(at49.drawn.size - budget).toBeLessThanOrEqual(1)
    const at48 = select(48)
    expect(at48.inside.size).toBeGreaterThan(budget)
    expect(at48.inside.size).toBeLessThan(at49.inside.size)
    expect(at48.drawn.size - budget).toBeLessThanOrEqual(1)
  })

  it('is nested as the sphere shrinks: no dot that stayed inside is re-dealt', () => {
    let prev = select(49)
    for (const scaleExp of [48, 47, 46]) {
      const next = select(scaleExp)
      // The smaller sphere's candidates are a subset of the larger sphere's.
      for (const h of next.inside) expect(prev.inside.has(h)).toBe(true)
      // What is drawn is the identity sample over the candidates plus the
      // nearest, and nothing else: so the property below is sample.ts's own
      // nesting, not a coincidence of this data.
      expect(next.drawn).toEqual(new Set([...next.sample, next.nearest!.height]))
      // Every dot of the sample drawn before that is still inside is still
      // drawn: the smaller sphere's sample is the larger one's intersected
      // with the smaller sphere, minus nothing, plus what the budget now
      // has room for.
      for (const h of prev.sample) if (next.inside.has(h)) expect(next.sample.has(h)).toBe(true)
      // And what the smaller sphere adds was inside the larger one all
      // along, previously beyond the budget: never a point from outside.
      for (const h of next.sample) if (!prev.sample.has(h)) expect(prev.inside.has(h)).toBe(true)
      prev = next
    }
  })

  it('draws everything once the sphere holds fewer than the budget', () => {
    const small = select(46)
    expect(small.inside.size).toBeLessThan(budget)
    expect(small.inside.size).toBeGreaterThan(0)
    expect(small.drawn).toEqual(small.inside)
  })
})

describe('the nearest landfall', () => {
  it('is drawn and marked even when its hash would have left it out of the sample', () => {
    const budget = 1000
    const heights = Array.from({ length: 5000 }, (_, i) => i)
    const sample = drawnSet(heights, budget)
    expect(sample.size).toBe(budget)
    // A block the identity sample rejects, put nearest to the centre: a
    // kilometer out, with every other block farther than that.
    const unlucky = heights.find((h) => !sample.has(h))!
    const km = 1000n * SELF_GIBSONS
    const d2 = heights.map((h) => (2n * km + BigInt(h)) ** 2n)
    d2[unlucky] = km ** 2n
    const sel = sphereSelection(heights, d2, budget)
    expect(sel.nearest).toEqual({ height: unlucky, d2: km ** 2n })
    expect(sel.drawn.has(unlucky)).toBe(true)
    expect(sel.drawn.size).toBe(budget + 1)
    // On top of the sample, not instead of any of it.
    for (const h of sample) expect(sel.drawn.has(h)).toBe(true)
  })

  it('is marked on its own dot, not drawn twice, when the sample already has it', () => {
    const budget = 1000
    const heights = Array.from({ length: 5000 }, (_, i) => i)
    const sample = drawnSet(heights, budget)
    const lucky = [...sample][0]
    const km = 1000n * SELF_GIBSONS
    const d2 = heights.map((h) => (2n * km + BigInt(h)) ** 2n)
    d2[lucky] = km ** 2n
    const sel = sphereSelection(heights, d2, budget)
    expect(sel.nearest!.height).toBe(lucky)
    expect(sel.drawn.size).toBe(budget)
    expect(sel.drawn).toEqual(sample)
  })

  it('passes over the stop the sphere is centred on and names its neighbour', () => {
    // A landfall focus: the block itself sits six gibsons from the centre
    // (the index's float shortcut against the exact focus), the next block
    // is 6.9 km out.
    const m = SELF_GIBSONS
    const heights = [844153, 12, 40]
    const d2 = [36n, (6900n * m) ** 2n, (9000n * m) ** 2n]
    const sel = sphereSelection(heights, d2, 1000)
    expect(sel.nearest).toEqual({ height: 12, d2: (6900n * m) ** 2n })
    // Alone in its sphere it is still drawn, just not called the nearest.
    const alone = sphereSelection([844153], [36n], 1000)
    expect(alone.nearest).toBeNull()
    expect(alone.drawn).toEqual(new Set([844153]))
  })

  it('breaks a tie to the lower height, and is null with no candidates', () => {
    // Squared distances of a few meters, past the one-meter self threshold.
    const m2 = SELF_GIBSONS * SELF_GIBSONS
    expect(nearestOf([7, 3, 9], [5n * m2, 5n * m2, 5n * m2])).toEqual({ height: 3, d2: 5n * m2 })
    expect(nearestOf([7, 3, 9], [5n * m2, 6n * m2, 4n * m2])).toEqual({ height: 9, d2: 4n * m2 })
    expect(nearestOf([], [])).toBeNull()
    expect(sphereSelection([], [], 1000)).toEqual({ drawn: new Set(), nearest: null })
  })
})

describe('isqrt', () => {
  it('is the floor square root, exact at any size', () => {
    expect(isqrt(0n)).toBe(0n)
    expect(isqrt(1n)).toBe(1n)
    expect(isqrt(15n)).toBe(3n)
    expect(isqrt(16n)).toBe(4n)
    expect(isqrt(17n)).toBe(4n)
    const big = (1n << 54n) + 12345n
    expect(isqrt(big * big)).toBe(big)
    expect(isqrt(big * big - 1n)).toBe(big - 1n)
    expect(isqrt(big * big + 1n)).toBe(big)
  })
})
