/**
 * nearestPortToView.test.ts: the port the NEAREST label names (arkinox,
 * 2026-11-03). Spectating Sebastix at 2^75, "NEAREST · BLOCK 8055 · 360 AU"
 * was not the nearest block: several were visibly closer. The label prints
 * a straight-line distance, so the port it names has to be the one with the
 * least straight-line distance from the view, not the protocol station's
 * pick (smallest shared aligned cube, then the lowest height in it), which
 * can sit far off while a port just across a cube face is right beside you.
 */
import { describe, expect, it } from 'vitest'
import { coordToXyz, xyzToCoord } from 'cyberspace-core'
import { buildIndex, nearestPortToView } from '../station'
import { isqrt } from '../interest'
import type { Stop } from '../stops'

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
const AXIS = (1n << 85n) - 1n
function port(height: number, x: bigint, y: bigint, z: bigint): Stop {
  const coord = xyzToCoord(x, y, z, 1)
  return { height, kind: 'port', merkleRoot: coord.toString(16).padStart(64, '0'), blockHash: null, coordExact: coord, coordApprox: coord }
}
function d2(a: { x: bigint; y: bigint; z: bigint }, b: { x: bigint; y: bigint; z: bigint }): bigint {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

describe('nearestPortToView', () => {
  it('names the port just across a cube face, not the far one sharing the view cube', () => {
    // The view sits one gibson short of the 2^75 face on x. A port one gibson
    // across the face is at 2 G; a port at the cube's far corner shares the
    // view's 2^75 cube and is ~2^75 G off.
    const face = 1n << 75n
    const view = { x: (5n << 76n) + face - 1n, y: 3n << 76n, z: 7n << 76n }
    const across = port(9000, view.x + 2n, view.y, view.z)
    const sameCube = port(8055, view.x - face + 1n, view.y, view.z)
    const n = nearestPortToView(buildIndex([across, sameCube]), view)!
    expect(n.stop.height).toBe(9000)
    expect(n.distance).toBe(2n)
  })

  it('inside one cube, takes the closer port over the lower height', () => {
    const view = { x: 1n << 70n, y: 1n << 70n, z: 1n << 70n }
    // Both share the view's 2^40 cube (highest differing bit 39), so the
    // station metric calls them equal and takes the lower height.
    const far = port(10, view.x + (1n << 39n) + (1n << 38n), view.y, view.z)
    const close = port(20, view.x + (1n << 39n) + 1n, view.y, view.z)
    expect(nearestPortToView(buildIndex([far, close]), view)!.stop.height).toBe(20)
  })

  it('never names the port the view stands on', () => {
    const view = { x: 1n << 70n, y: 1n << 70n, z: 1n << 70n }
    const onIt = port(1, view.x, view.y, view.z)
    const next = port(2, view.x + 5n, view.y, view.z)
    expect(nearestPortToView(buildIndex([onIt, next]), view)!.stop.height).toBe(2)
  })

  it('matches brute-force straight-line distance, ties to the lowest height', () => {
    const rng = mulberry32(7)
    const centre = { x: 3n << 80n, y: 5n << 80n, z: 2n << 80n }
    const stops: Stop[] = []
    for (let i = 0; i < 2000; i++) {
      const spread = 1n << BigInt(60 + Math.floor(rng() * 20))
      const off = (): bigint => BigInt(Math.floor(rng() * Number(spread))) - spread / 2n
      const clamp = (v: bigint): bigint => (v < 0n ? 0n : v > AXIS ? AXIS : v)
      stops.push(port(i + 1, clamp(centre.x + off()), clamp(centre.y + off()), clamp(centre.z + off())))
    }
    const index = buildIndex(stops)
    const places = stops.map((s) => coordToXyz(s.coordExact as bigint))
    for (let q = 0; q < 200; q++) {
      const spread = 1n << BigInt(62 + Math.floor(rng() * 18))
      const off = (): bigint => BigInt(Math.floor(rng() * Number(spread))) - spread / 2n
      const view = { x: centre.x + off(), y: centre.y + off(), z: centre.z + off() }
      let best: Stop | null = null
      let bestD2 = 0n
      for (let k = 0; k < stops.length; k++) {
        const s = stops[k]
        const d = d2(places[k], view)
        if (d === 0n) continue
        if (best === null || d < bestD2 || (d === bestD2 && s.height < best.height)) {
          best = s
          bestD2 = d
        }
      }
      const got = nearestPortToView(index, view)!
      expect(got.stop.height).toBe(best!.height)
      expect(got.distance).toBe(isqrt(bestD2))
    }
  })
})

describe('nearestPortToView reads only the rows that could win (review of #585)', () => {
  it('decodes a handful of rows per view, not the whole block around it', () => {
    // Uniform ports, as proof of work scatters them. Reading a row is the
    // cost (de-interleaving its coordinate, cached per row in index.xyz), and
    // reading the whole 3x3x3 block of side 2^(d + 1) read hundreds per view:
    // 65 ms at p90 on the 460,000-port line, against 0.01 ms for the old pick.
    const rng = mulberry32(5)
    const r85 = (): bigint => (BigInt(Math.floor(rng() * 2 ** 30)) << 55n) | (BigInt(Math.floor(rng() * 2 ** 30)) << 25n) | BigInt(Math.floor(rng() * 2 ** 25))
    const stops: Stop[] = []
    for (let i = 0; i < 40_000; i++) stops.push(port(i + 1, r85(), r85(), r85()))
    const index = buildIndex(stops)
    const VIEWS = 50
    for (let q = 0; q < VIEWS; q++) nearestPortToView(index, { x: r85(), y: r85(), z: r85() })
    const decoded = index.xyz.filter((d) => d !== undefined).length
    expect(decoded / VIEWS).toBeLessThan(40)
  })
})
