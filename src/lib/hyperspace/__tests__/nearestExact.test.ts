/**
 * What would fail silently without these tests: the nearest-stop search
 * derives only the landfalls whose filed (float64) point leaves their side
 * of a cube face in doubt. Get that bound wrong and GOAL names a stop that
 * is not the nearest, or a ride boards at the wrong station and its jump is
 * rejected by every verifier, with nothing in the UI looking broken. Get it
 * too loose and the tab freezes for half a minute deriving an octant of the
 * planet, which is the bug this replaced. So the search is checked against
 * an exhaustive exact search on thousands of targets, over landfalls filed
 * the way the header worker files them and over landfalls filed as far from
 * their exact point as the slack allows, in both directions, on every axis.
 */
import { describe, expect, it } from 'vitest'
import { coordToXyz, xyzToCoord } from 'cyberspace-core'
import { buildIndex, findNearestInPlane, findStation, maxAxisLca, type StationResult } from '../station'
import { LANDFALL_SLACK_BITS, stopAt } from '../compactIndex'
import { landfallCoord, landfallCoordApprox } from '../landfall'
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

function randHex(rng: () => number): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += Math.floor(rng() * 2 ** 32).toString(16).padStart(8, '0')
  return s
}

function randBits(rng: () => number, bits: number): bigint {
  let v = 0n
  for (let i = 0; i < Math.ceil(bits / 16); i++) v = (v << 16n) | BigInt(Math.floor(rng() * 65536))
  return v & ((1n << BigInt(bits)) - 1n)
}

const AXIS_MAX = (1n << 85n) - 1n
const CENTER = 1n << 84n
const SLACK = 1n << BigInt(LANDFALL_SLACK_BITS)
const clampAxis = (v: bigint): bigint => (v < 0n ? 0n : v > AXIS_MAX ? AXIS_MAX : v)

interface Fixture {
  stops: Stop[]
  /** Exact coordinate by height. */
  exact: bigint[]
}

/**
 * Ports at random merkle coordinates and `place.length` landfalls, dealt to
 * heights at random. `place[i]` gives landfall i's exact point from its block
 * hash; `file` decides where it is filed in the index: the float64
 * approximation, or the exact point pushed by up to the slack on each axis.
 */
function fixture(
  seed: number,
  place: Array<(hash: string) => bigint>,
  ports: number,
  file: (exact: bigint, hash: string, rng: () => number) => bigint,
): Fixture {
  const rng = mulberry32(seed)
  const stops: Stop[] = []
  const exact: bigint[] = []
  // Ports and landfalls interleaved by height, as the merkle plane bit deals them.
  const kinds = [...place.map((_, i) => i), ...Array<number>(ports).fill(-1)]
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[kinds[i], kinds[j]] = [kinds[j], kinds[i]]
  }
  for (let h = 0; h < kinds.length; h++) {
    const hash = randHex(rng)
    if (kinds[h] < 0) {
      const c = xyzToCoord(randBits(rng, 85), randBits(rng, 85), randBits(rng, 85), 1)
      stops.push({ height: h, kind: 'port', merkleRoot: c.toString(16).padStart(64, '0'), blockHash: hash, coordExact: c, coordApprox: c })
      exact.push(c)
    } else {
      const e = place[kinds[h]](hash)
      stops.push({ height: h, kind: 'landfall', merkleRoot: randHex(rng), blockHash: hash, coordExact: null, coordApprox: file(e, hash, rng) })
      exact.push(e)
    }
  }
  return { stops, exact }
}

/** Landfalls where their block hashes put them (DECK-0001 §1.2). */
const derived = (count: number): Array<(hash: string) => bigint> => Array.from({ length: count }, () => landfallCoord)

/**
 * Landfalls in tight clusters, the density the slack matters at. Real hashes
 * put landfalls kilometers apart, so a stop filed a slack away from its point
 * never meets a rival there, and a search that found it a level late would
 * still return it at its true distance. Here the exact points are placed, not
 * derived (indexOf seeds them on the memoized stops, which is exactly what
 * the search reads through stopCoordExact), a few to a few hundred slacks
 * apart, and half the clusters straddle an aligned cube face.
 */
function clustered(seed: number, clusters: number, perCluster: number): Array<(hash: string) => bigint> {
  const rng = mulberry32(seed)
  const sign = (v: bigint): bigint => (rng() < 0.5 ? -v : v)
  const out: Array<(hash: string) => bigint> = []
  for (let c = 0; c < clusters; c++) {
    const spread = LANDFALL_SLACK_BITS + 1 + Math.floor(rng() * 8)
    const face = BigInt(spread + 1 + Math.floor(rng() * 3))
    const onFace = rng() < 0.5
    const center = [0, 1, 2].map(() => {
      const v = clampAxis(CENTER + sign(randBits(rng, 55)))
      return onFace ? (v >> face) << face : v
    })
    for (let m = 0; m < perCluster; m++) {
      const at = xyzToCoord(...(center.map((v) => clampAxis(v + sign(randBits(rng, spread)))) as [bigint, bigint, bigint]), 0)
      out.push(() => at)
    }
  }
  return out
}

/** Filed where the header worker files it. */
const fileApprox = (_exact: bigint, hash: string): bigint => landfallCoordApprox(hash)

/** Filed as far off as the slack allows: half the axes at the very edge of it, either side. */
const fileAdversarial = (exact: bigint, _hash: string, rng: () => number): bigint => {
  const { x, y, z } = coordToXyz(exact)
  const push = (v: bigint): bigint => {
    const r = rng()
    const mag = r < 0.5 ? SLACK - 1n - BigInt(Math.floor(rng() * 4)) : BigInt(Math.floor(rng() * Number(SLACK - 1n)))
    return clampAxis(rng() < 0.5 ? v - mag : v + mag)
  }
  return xyzToCoord(push(x), push(y), push(z), 0)
}

/** The index, with each stop's exact coordinate cached so the brute force and the search agree on it cheaply. */
function indexOf(f: Fixture): ReturnType<typeof buildIndex> {
  const index = buildIndex(f.stops)
  for (let row = 0; row < index.size; row++) {
    const stop = stopAt(index, row)
    stop.coordExact = f.exact[stop.height]
  }
  return index
}

interface Brute {
  /** Nearest landfall (plane 0), optionally excluding a coordinate. */
  landfall: { height: number; distance: number } | null
  /** Nearest port (plane 1), excluding the given coordinate. */
  port: { height: number; distance: number } | null
  /** The station: any kind, height <= maxHeight. */
  station: { height: number; distance: number } | null
}

/** Every stop's exact distance, the lowest height winning a tie. */
function brute(f: Fixture, q: bigint, maxHeight: number, exclude: bigint | undefined): Brute {
  const out: Brute = { landfall: null, port: null, station: null }
  const better = (cur: { height: number; distance: number } | null, height: number, distance: number): boolean =>
    cur === null || distance < cur.distance || (distance === cur.distance && height < cur.height)
  for (const stop of f.stops) {
    const h = stop.height
    const at = f.exact[h]
    const distance = maxAxisLca(q, at)
    const port = stop.kind === 'port'
    if (at !== exclude) {
      if (port && better(out.port, h, distance)) out.port = { height: h, distance }
      if (!port && better(out.landfall, h, distance)) out.landfall = { height: h, distance }
    }
    if (h <= maxHeight && better(out.station, h, distance)) out.station = { height: h, distance }
  }
  return out
}

/**
 * Query points of every kind GOAL and the station see: on and beside a
 * landfall at every scale, straddling an aligned cube face next to one,
 * on and above the surface, the Earth view out in space, the planet's
 * center (a corner of every aligned cube), and anywhere at all.
 */
function targets(f: Fixture, seed: number, count: number): bigint[] {
  const rng = mulberry32(seed)
  const landfalls = f.stops.filter((s) => s.kind === 'landfall').map((s) => f.exact[s.height])
  const pick = (): bigint => landfalls[Math.floor(rng() * landfalls.length)]
  const sign = (v: bigint): bigint => (rng() < 0.5 ? -v : v)
  const out: bigint[] = []
  for (let i = 0; i < count; i++) {
    const kind = i % 8
    if (kind === 0) {
      out.push(pick())
    } else if (kind === 1 || kind === 2) {
      // Beside a landfall, at a random scale per axis: any scale, or the few
      // slacks to a few hundred where filing error decides cube membership.
      const { x, y, z } = coordToXyz(pick())
      const bits = (): number => (kind === 1 ? 1 + Math.floor(rng() * 60) : LANDFALL_SLACK_BITS - 4 + Math.floor(rng() * 16))
      const off = (): bigint => sign(randBits(rng, bits()))
      out.push(xyzToCoord(clampAxis(x + off()), clampAxis(y + off()), clampAxis(z + off()), 0))
    } else if (kind === 3) {
      // A cube face within a few slacks of a landfall: the query sits just on
      // the far side of an aligned boundary the landfall is close to.
      const { x, y, z } = coordToXyz(pick())
      const level = BigInt(LANDFALL_SLACK_BITS + 1 + Math.floor(rng() * 40))
      const toFace = (v: bigint): bigint => {
        const face = ((v + (1n << (level - 1n))) >> level) << level
        return clampAxis(face + sign(randBits(rng, LANDFALL_SLACK_BITS + 2)))
      }
      out.push(xyzToCoord(rng() < 0.5 ? toFace(x) : x, rng() < 0.5 ? toFace(y) : y, toFace(z), 0))
    } else if (kind === 4) {
      // Near the surface or above it: a landfall pushed outward from the center.
      const { x, y, z } = coordToXyz(pick())
      const k = BigInt(1 + Math.floor(rng() * 8))
      const up = (v: bigint): bigint => clampAxis(CENTER + ((v - CENTER) * (8n + k)) / 8n)
      out.push(xyzToCoord(up(x), up(y), up(z), 0))
    } else if (kind === 5) {
      // The Earth view: out in space within a few thousand planet radii.
      const r = (): bigint => clampAxis(CENTER + sign(randBits(rng, 54 + Math.floor(rng() * 12))))
      out.push(xyzToCoord(r(), r(), r(), 0))
    } else if (kind === 6) {
      // The planet's center and the gibsons around it.
      const r = (): bigint => CENTER + sign(randBits(rng, Math.floor(rng() * 20)))
      out.push(xyzToCoord(r(), r(), r(), 0))
    } else {
      out.push(xyzToCoord(randBits(rng, 85), randBits(rng, 85), randBits(rng, 85), 0))
    }
  }
  return out
}

function checkAgainstBrute(f: Fixture, seed: number, count: number): { disagreeFiled: number } {
  const index = indexOf(f)
  const rng = mulberry32(seed + 1)
  const filed = f.stops.map((s) => s.coordApprox)
  let disagreeFiled = 0
  for (const q of targets(f, seed, count)) {
    const maxHeight = rng() < 0.5 ? f.stops.length : Math.floor(rng() * f.stops.length)
    // Half the time the place looked at is itself a stop and is excluded.
    const exclude = rng() < 0.5 ? q : undefined
    const want = brute(f, q, maxHeight, exclude)

    const landfall = findNearestInPlane(index, q, 0, exclude)
    expect({ height: landfall?.stop.height, distance: landfall?.distance }).toEqual({ height: want.landfall?.height, distance: want.landfall?.distance })
    const station = findStation(index, q, maxHeight)
    expect({ height: station?.stop.height, distance: station?.distance }).toEqual({ height: want.station?.height, distance: want.station?.distance })
    // The same place in ideaspace, for the port search.
    const portQ = q | 1n
    const port = findNearestInPlane(index, portQ, 1, exclude === undefined ? undefined : portQ)
    const wantPort = brute(f, portQ, maxHeight, exclude === undefined ? undefined : portQ).port
    expect({ height: port?.stop.height, distance: port?.distance }).toEqual({ height: wantPort?.height, distance: wantPort?.distance })

    // How often deciding on the filed points alone would have been wrong:
    // the measure of whether these targets exercise the slack at all.
    let best: { height: number; distance: number } | null = null
    for (let h = 0; h < f.stops.length; h++) {
      if (f.stops[h].kind !== 'landfall' || f.exact[h] === exclude) continue
      const d = maxAxisLca(q, filed[h])
      if (best === null || d < best.distance || (d === best.distance && h < best.height)) best = { height: h, distance: d }
    }
    if (best?.height !== want.landfall?.height || best?.distance !== want.landfall?.distance) disagreeFiled++
  }
  return { disagreeFiled }
}

describe('nearest stop, exact against brute force', () => {
  it('matches an exhaustive exact search with landfalls filed as the header worker files them', () => {
    const f = fixture(20261015, derived(1000), 600, fileApprox)
    checkAgainstBrute(f, 1, 1600)
  }, 60_000)

  it('matches it with landfalls clustered across cube faces and filed as far off as the slack allows', () => {
    const f = fixture(424242, [...clustered(7, 40, 30), ...derived(200)], 300, fileAdversarial)
    const { disagreeFiled } = checkAgainstBrute(f, 2, 2000)
    // The filed points alone get a good share of these wrong (the stop or
    // its distance), so the slack handling is what the agreement above is
    // testing, not luck.
    expect(disagreeFiled).toBeGreaterThan(50)
  }, 60_000)
})

describe('nearest stop, a stop filed away from its true point', () => {
  it('reports every stop at its true distance and still finds the nearest correctly filed one', () => {
    // A relay anchor's C tag is where a landfall is filed, and nothing checks
    // it against the block hash at ingest. File a few landfalls right beside
    // the places queried while their true points stay where their hashes put
    // them. Such a stop cannot always be found where it truly is (it is not
    // filed there, which the old search shared), but it must never be
    // reported at the distance of where it was filed, and it must never hide
    // a correctly filed stop that is nearer.
    const f = fixture(77, derived(300), 100, fileApprox)
    const rng = mulberry32(78)
    const queries = targets(f, 79, 60)
    const landfalls = f.stops.filter((s) => s.kind === 'landfall')
    const misfiled = new Set<number>()
    for (let i = 0; i < 12; i++) {
      const { x, y, z } = coordToXyz(queries[i * 5])
      landfalls[i].coordApprox = xyzToCoord(x + BigInt(1 + Math.floor(rng() * 1000)), y, z, 0)
      misfiled.add(landfalls[i].height)
    }
    const index = indexOf(f)
    const honest: Fixture = { stops: f.stops.filter((s) => !misfiled.has(s.height)), exact: f.exact }
    const notWorse = (got: StationResult | null, want: { height: number; distance: number } | null): boolean =>
      want === null || (got !== null && (got.distance < want.distance || (got.distance === want.distance && got.stop.height <= want.height)))
    for (const q of queries) {
      for (const [got, all, fair] of [
        [findNearestInPlane(index, q, 0), brute(f, q, f.stops.length, undefined).landfall, brute(honest, q, f.stops.length, undefined).landfall],
        [findStation(index, q, f.stops.length), brute(f, q, f.stops.length, undefined).station, brute(honest, q, f.stops.length, undefined).station],
      ] as const) {
        expect(got).not.toBeNull()
        expect(got!.distance).toBe(maxAxisLca(q, f.exact[got!.stop.height]))
        expect(notWorse(got, fair)).toBe(true)
        if (got!.stop.height !== all?.height) expect(misfiled.has(all!.height)).toBe(true)
      }
    }
  })
})

describe('nearest stop, derivation count', () => {
  it('derives a handful of landfalls, not the planet, for a query out in space', () => {
    // 20,000 landfalls filed by their float path and nothing derived yet.
    const rng = mulberry32(5)
    const stops: Stop[] = []
    for (let h = 0; h < 20_000; h++) {
      const hash = randHex(rng)
      stops.push({ height: h, kind: 'landfall', merkleRoot: randHex(rng), blockHash: hash, coordExact: null, coordApprox: landfallCoordApprox(hash) })
    }
    const index = buildIndex(stops)
    const kmToG = (km: number): bigint => BigInt(Math.round(km * 1000)) * 2n ** 33n
    const queries = [
      xyzToCoord(CENTER + kmToG(20000), CENTER + kmToG(3000), CENTER - kmToG(5000), 0),
      xyzToCoord(CENTER, CENTER, CENTER, 0),
      xyzToCoord(CENTER + (1n << 80n), CENTER - (1n << 79n), CENTER + 12345n, 0),
    ]
    for (const q of queries) {
      index.stopCache.clear()
      expect(findNearestInPlane(index, q, 0)).not.toBeNull()
      expect(findStation(index, q, 20_000)).not.toBeNull()
      // Every derivation materializes the stop it derives; the old search
      // materialized and derived every landfall in the cube (thousands here).
      expect(index.stopCache.size).toBeLessThanOrEqual(8)
    }
  })
})

describe('nearest stop, the edges the random targets miss', () => {
  it('excludes a port being looked at and names its true neighbor, among clustered ports', () => {
    // StopField asks for the port nearest a port view, excluding the port
    // itself. Random ports sit far apart, and a query of q | 1 is almost
    // never a port, so the brute force above never really excludes one.
    // Here ports come in tight clusters, some sharing a coordinate, and
    // every port is queried with itself excluded.
    const rng = mulberry32(31)
    const stops: Stop[] = []
    const exact: bigint[] = []
    let h = 0
    for (let c = 0; c < 30; c++) {
      const center = [0, 1, 2].map(() => randBits(rng, 85))
      const spread = 2 + Math.floor(rng() * 30)
      let last: bigint | null = null
      for (let m = 0; m < 12; m++) {
        const at: bigint = last !== null && rng() < 0.15
          ? last
          : xyzToCoord(...(center.map((v) => clampAxis(v + randBits(rng, spread) - (1n << BigInt(spread - 1)))) as [bigint, bigint, bigint]), 1)
        last = at
        stops.push({ height: h, kind: 'port', merkleRoot: at.toString(16).padStart(64, '0'), blockHash: randHex(rng), coordExact: at, coordApprox: at })
        exact.push(at)
        h++
      }
      // Landfalls in the same cubes, which the port search must step over.
      for (let m = 0; m < 6; m++) {
        const at = xyzToCoord(...(center.map((v) => clampAxis(v + randBits(rng, spread))) as [bigint, bigint, bigint]), 0)
        stops.push({ height: h, kind: 'landfall', merkleRoot: randHex(rng), blockHash: randHex(rng), coordExact: at, coordApprox: at })
        exact.push(at)
        h++
      }
    }
    const f: Fixture = { stops, exact }
    const index = indexOf(f)
    for (const stop of stops) {
      if (stop.kind !== 'port') continue
      const q = exact[stop.height]
      const got = findNearestInPlane(index, q, 1, q)
      const want = brute(f, q, stops.length, q).port
      expect({ height: got?.stop.height, distance: got?.distance }).toEqual({ height: want?.height, distance: want?.distance })
      expect(got?.stop.coordExact).not.toBe(q)
    }
  })

  it('matches the brute force with stops filed at the very edges of the axes, where the 3x3x3 block is clipped', () => {
    // No landfall is really near an axis end, but a relay anchor's C tag can
    // put one anywhere, and the clipped neighborhood is code that otherwise
    // never runs. Clusters sit at each corner of the space and filing is as
    // far off as the slack allows, so stops straddle the faces next to the
    // clipped ones.
    const rng = mulberry32(91)
    const place: Array<(hash: string) => bigint> = []
    for (let c = 0; c < 16; c++) {
      const spread = LANDFALL_SLACK_BITS + 1 + Math.floor(rng() * 6)
      const corner = [0, 1, 2].map(() => (rng() < 0.5 ? 0n : AXIS_MAX))
      for (let m = 0; m < 20; m++) {
        const at = xyzToCoord(...(corner.map((v) => (v === 0n ? randBits(rng, spread) : AXIS_MAX - randBits(rng, spread)))) as [bigint, bigint, bigint], 0)
        place.push(() => at)
      }
    }
    const f = fixture(5150, [...place, ...derived(50)], 100, fileAdversarial)
    checkAgainstBrute(f, 3, 800)
  }, 60_000)
})
