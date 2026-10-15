/**
 * portCube.test.ts - ideaspace's counterpart to the sphere of interest
 * (arkinox, 2026-10-15): every port inside the aligned cube of height
 * scaleExp + 3 around the view, up to the same budget, nearest always drawn.
 * The cube's cover is one exact prefix range (cubeRun), so it is checked
 * against brute force, and the nearest skips the port being looked at.
 */
import { describe, expect, it } from 'vitest'
import { coordToXyz, xyzToCoord } from 'cyberspace-core'
import { buildIndex, cubeRun, findNearestInPlane, maxAxisLca } from '../station'
import { heightAt } from '../compactIndex'
import { cubeSelection, portCube, portCubeLabel, PORT_CUBE_OFFSET } from '../interest'
import { drawnSet } from '../sample'
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
function near(rng: () => number, v: bigint, spread: bigint): bigint {
  const off = BigInt(Math.floor(rng() * Number(spread))) - spread / 2n
  const r = v + off
  return r < 0n ? 0n : r > AXIS ? AXIS : r
}
function port(height: number, x: bigint, y: bigint, z: bigint): Stop {
  const coord = xyzToCoord(x, y, z, 1)
  return { height, kind: 'port', merkleRoot: coord.toString(16).padStart(64, '0'), blockHash: null, coordExact: coord, coordApprox: coord }
}

describe('cubeRun', () => {
  it('holds exactly the stops inside the aligned cube, against brute force', () => {
    const rng = mulberry32(11)
    const centre = { x: 3n << 60n, y: 5n << 60n, z: 7n << 60n }
    const stops: Stop[] = []
    // Clustered around the centre at several spreads, so every height has stops in and out of its cube.
    for (let i = 0; i < 3000; i++) {
      const spread = 1n << BigInt(40 + Math.floor(rng() * 24))
      stops.push(port(i + 1, near(rng, centre.x, spread), near(rng, centre.y, spread), near(rng, centre.z, spread)))
    }
    const index = buildIndex(stops)
    for (const h of [41, 48, 55, 60, 63, 85]) {
      const cube = portCube(centre, 1, h - PORT_CUBE_OFFSET)!
      const [start, end] = cubeRun(index, centre.x, centre.y, centre.z, cube.height)
      const got = new Set<number>()
      for (let pos = start; pos < end; pos++) got.add(heightAt(index, index.perm[pos]))
      const side = cube.height >= 85 ? 1n << 85n : 1n << BigInt(cube.height)
      const want = new Set(stops.filter((s) => {
        const p = coordToXyz(s.coordExact as bigint)
        return p.x >= cube.base.x && p.x < cube.base.x + side && p.y >= cube.base.y && p.y < cube.base.y + side && p.z >= cube.base.z && p.z < cube.base.z + side
      }).map((s) => s.height))
      expect(got).toEqual(want)
    }
  })

  it('is empty on an empty index', () => {
    expect(cubeRun(buildIndex([]), 1n, 2n, 3n, 40)).toEqual([0, 0])
  })
})

describe('portCube', () => {
  it('is ideaspace only, aligned to scaleExp + 3, capped at the whole cube', () => {
    const a = { x: (9n << 50n) + 12345n, y: 7n << 50n, z: 1n }
    expect(portCube(a, 0, 40)).toBeNull()
    const c = portCube(a, 1, 47)!
    expect(c.height).toBe(50)
    expect(c.base).toEqual({ x: 9n << 50n, y: 7n << 50n, z: 0n })
    expect(portCube(a, 1, 84)!.height).toBe(85)
    expect(portCube(a, 1, 84)!.base).toEqual({ x: 0n, y: 0n, z: 0n })
  })
  it('labels the count honestly', () => {
    expect(portCubeLabel(1000, 8214, 80)).toBe('1,000 of 8,214 hyperjumps in this h80 box')
    expect(portCubeLabel(2, 2, 78)).toBe('2 of 2 hyperjumps in this h78 box')
    // No label until there are two to choose between (arkinox, 2026-10-15).
    expect(portCubeLabel(1, 1, 77)).toBeNull()
    expect(portCubeLabel(0, 0, 74)).toBeNull()
  })
})

describe('cubeSelection', () => {
  const heights = (n: number, from: number): number[] => Array.from({ length: n }, (_, i) => from + i)
  it('draws every port in a cube that holds no more than the budget', () => {
    const sel = cubeSelection(heights(5000, 1), heights(412, 10_000), 1100, 1000)
    expect(sel.cubeDrawn).toBe(412)
    for (const h of heights(412, 10_000)) expect(sel.drawn.has(h)).toBe(true)
  })
  it('caps a crowded cube at the budget, deterministically and nested in its candidates', () => {
    const cube = heights(8000, 10_000)
    const a = cubeSelection([], cube, 1100, 1000)
    const b = cubeSelection([], cube, 1100, 1000)
    expect(a.cubeDrawn).toBe(1000)
    expect([...a.drawn].sort()).toEqual([...b.drawn].sort())
    // Zooming in: a sub-cube's candidates are a subset, and nothing drawn in it is re-dealt.
    const sub = cube.slice(0, 2000)
    const inner = cubeSelection([], sub, 1100, 1000)
    for (const h of sub) if (a.drawn.has(h)) expect(inner.drawn.has(h)).toBe(true)
    expect(a.drawn).toEqual(drawnSet(cube, 1000))
  })
})

describe('findNearestInPlane with exclude', () => {
  it('names the neighbour of the port being looked at, never the port itself', () => {
    const a = port(1, 1n << 70n, 1n << 70n, 1n << 70n)
    const b = port(2, (1n << 70n) + (1n << 30n), 1n << 70n, 1n << 70n)
    const c = port(3, 5n << 80n, 5n << 80n, 5n << 80n)
    const index = buildIndex([a, b, c])
    const at = a.coordExact as bigint
    expect(findNearestInPlane(index, at, 1)!.stop.height).toBe(1)
    const n = findNearestInPlane(index, at, 1, at)!
    expect(n.stop.height).toBe(2)
    expect(n.distance).toBe(maxAxisLca(at, b.coordExact as bigint))
  })
})
