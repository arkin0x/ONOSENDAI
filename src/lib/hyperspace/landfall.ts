/**
 * landfall.ts: DECK-0001 v3 §1.2, the landfall derivation.
 *
 * A block whose merkle root has plane bit 0 "falls to Earth": its stop
 * coordinate is the point on the WGS84 ellipsoid where a direction chosen by
 * sha256(LANDFALL_DOMAIN || block_hash) meets the surface. This is consensus
 * critical, so it runs in the same decimal profile as the base spec's GPS
 * mapping (precision 96, ROUND_HALF_EVEN, the exact PI_STR, Taylor sin/cos),
 * with every operation performed in the order the DECK lists.
 *
 * `landfallCoordApprox` is a float64 shortcut good to about a metre, for
 * indexing and rendering hundreds of thousands of stops quickly. Anything a
 * verifier compares against MUST use the exact `landfallCoord`.
 */
import Decimal from 'decimal.js'
import { sha256, hexToBytes, xyzToCoord, coordToXyz, PLANE_DATASPACE } from 'cyberspace-core'

export const LANDFALL_DOMAIN = new TextEncoder().encode('CYBERSPACE_LANDFALL_V1')

// Independent constructor so we never mutate decimal.js's global config.
const D = Decimal.clone({ precision: 96, rounding: Decimal.ROUND_HALF_EVEN })

const PI_STR =
  '3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679'
const PI = new D(PI_STR)
const TWO_PI = PI.times(2)
const HALF_PI = PI.div(2)
const TRIG_EPS = new D('1e-88')
const TRIG_MAX_ITER = 256

const WGS84_A_M = new D('6378137')
const WGS84_F = new D(1).div('298.257223563')
const WGS84_B_M = WGS84_A_M.times(new D(1).minus(WGS84_F))

const AXIS_BITS = 85
const AXIS_MAX = (1n << BigInt(AXIS_BITS)) - 1n
const AXIS_CENTER = 1n << BigInt(AXIS_BITS - 1)
const UNITS_PER_KM = new D(1000).times(new D(2).pow(33))
const TWO_128 = new D(2).pow(128)

function truncMod(x: Decimal, m: Decimal): Decimal {
  // Python Decimal %: truncated toward zero, sign of the dividend.
  return x.minus(m.times(x.dividedToIntegerBy(m)))
}

/** Deterministic (sin, cos) per CYBERSPACE_V2 §9.5. */
export function sinCos(xIn: Decimal): { sin: Decimal; cos: Decimal } {
  let x = truncMod(xIn, TWO_PI)
  if (x.gt(PI)) x = x.minus(TWO_PI)
  let cosSign = new D(1)
  if (x.gt(HALF_PI)) {
    x = PI.minus(x)
    cosSign = new D(-1)
  } else if (x.lt(HALF_PI.neg())) {
    x = PI.neg().minus(x)
    cosSign = new D(-1)
  }
  const x2 = x.times(x)
  let sinSum = x
  let sinTerm = x
  let converged = false
  for (let k = 1; k <= TRIG_MAX_ITER; k++) {
    const denom = new D(2 * k).times(2 * k + 1)
    sinTerm = sinTerm.neg().times(x2).div(denom)
    sinSum = sinSum.plus(sinTerm)
    if (sinTerm.abs().lt(TRIG_EPS)) {
      converged = true
      break
    }
  }
  if (!converged) throw new Error('sin() Taylor series did not converge')
  let cosSum = new D(1)
  let cosTerm = new D(1)
  converged = false
  for (let k = 1; k <= TRIG_MAX_ITER; k++) {
    const denom = new D(2 * k - 1).times(2 * k)
    cosTerm = cosTerm.neg().times(x2).div(denom)
    cosSum = cosSum.plus(cosTerm)
    if (cosTerm.abs().lt(TRIG_EPS)) {
      converged = true
      break
    }
  }
  if (!converged) throw new Error('cos() Taylor series did not converge')
  return { sin: sinSum, cos: cosSum.times(cosSign) }
}

/** km from the centre to a u85 axis value, ROUND_HALF_EVEN, clamped (§9.7 step 9). */
export function kmToAxisU(kmFromCenter: Decimal): bigint {
  const u = kmFromCenter.times(UNITS_PER_KM).plus(new D(AXIS_CENTER.toString()))
  let uInt = BigInt(u.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toFixed(0))
  if (uInt < 0n) uInt = 0n
  if (uInt > AXIS_MAX) uInt = AXIS_MAX
  return uInt
}

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n
  for (const x of b) n = (n << 8n) | BigInt(x)
  return n
}

function normalizeHash(blockHashHex: string): Uint8Array {
  const clean = blockHashHex.startsWith('0x') ? blockHashHex.slice(2) : blockHashHex
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error('block hash must be 64 hex chars')
  return hexToBytes(clean.toLowerCase())
}

/** The unit ECEF direction (float64) chosen by the block hash. Shared by exact and approx paths. */
export function landfallSeed(blockHashHex: string): Uint8Array {
  const h = normalizeHash(blockHashHex)
  const pre = new Uint8Array(LANDFALL_DOMAIN.length + 32)
  pre.set(LANDFALL_DOMAIN, 0)
  pre.set(h, LANDFALL_DOMAIN.length)
  return sha256(pre)
}

/** Exact landfall axis values (DECK-0001 v3 §1.2 steps 1 to 10). */
export function landfallXyz(blockHashHex: string): { x: bigint; y: bigint; z: bigint } {
  const seed = landfallSeed(blockHashHex)
  const u1 = new D(bytesToBigInt(seed.subarray(0, 16)).toString()).div(TWO_128)
  const u2 = new D(bytesToBigInt(seed.subarray(16, 32)).toString()).div(TWO_128)
  const lon = new D(2).times(u1).minus(1).times(PI)
  const z = new D(2).times(u2).minus(1)
  const rxy = new D(1).minus(z.times(z)).sqrt()
  const { sin: sinLon, cos: cosLon } = sinCos(lon)
  const dx = rxy.times(cosLon)
  const dy = rxy.times(sinLon)
  const dz = z
  const inv = dx
    .times(dx)
    .plus(dy.times(dy))
    .div(WGS84_A_M.times(WGS84_A_M))
    .plus(dz.times(dz).div(WGS84_B_M.times(WGS84_B_M)))
    .sqrt()
  const r = new D(1).div(inv)
  const km = new D(1000)
  const xKm = r.times(dx).div(km)
  const yKm = r.times(dy).div(km)
  const zKm = r.times(dz).div(km)
  // Axis permutation per §9.4: X_cs = X_ecef, Y_cs = Z_ecef, Z_cs = Y_ecef.
  return { x: kmToAxisU(xKm), y: kmToAxisU(zKm), z: kmToAxisU(yKm) }
}

/** Exact landfall coord256 (plane 0). */
export function landfallCoord(blockHashHex: string): bigint {
  const { x, y, z } = landfallXyz(blockHashHex)
  return xyzToCoord(x, y, z, PLANE_DATASPACE)
}

const G_PER_M = 2 ** 33
const A_F = 6378137
const F_F = 1 / 298.257223563
const B_F = A_F * (1 - F_F)
const CENTER_F = 2 ** 84

/**
 * Float64 landfall approximation, about a metre of error (2^33 G), for the
 * index and the renderer. Never use for anything a verifier will check.
 */
export function landfallXyzApprox(blockHashHex: string): { x: bigint; y: bigint; z: bigint } {
  const seed = landfallSeed(blockHashHex)
  const u1 = Number(bytesToBigInt(seed.subarray(0, 8))) / 2 ** 64
  const u2 = Number(bytesToBigInt(seed.subarray(16, 24))) / 2 ** 64
  const lon = (2 * u1 - 1) * Math.PI
  const z = 2 * u2 - 1
  const rxy = Math.sqrt(1 - z * z)
  const dx = rxy * Math.cos(lon)
  const dy = rxy * Math.sin(lon)
  const dz = z
  const r = 1 / Math.sqrt((dx * dx + dy * dy) / (A_F * A_F) + (dz * dz) / (B_F * B_F))
  const toU = (m: number) => BigInt(Math.round(m * G_PER_M)) + BigInt(CENTER_F)
  return { x: toU(r * dx), y: toU(r * dz), z: toU(r * dy) }
}

export function landfallCoordApprox(blockHashHex: string): bigint {
  const { x, y, z } = landfallXyzApprox(blockHashHex)
  return xyzToCoord(x, y, z, PLANE_DATASPACE)
}

/** Float64 inverse for labels: dataspace axis values to WGS84 lat/lon/alt (metres). */
export function axesToLatLon(x: bigint, y: bigint, z: bigint): { lat: number; lon: number; altM: number } {
  const xm = Number(x - AXIS_CENTER) / G_PER_M
  const ym = Number(y - AXIS_CENTER) / G_PER_M
  const zm = Number(z - AXIS_CENTER) / G_PER_M
  // Undo the permutation: X_ecef = X_cs, Z_ecef = Y_cs, Y_ecef = Z_cs.
  const X = xm
  const Y = zm
  const Z = ym
  const e2 = F_F * (2 - F_F)
  const p = Math.hypot(X, Y)
  const lon = Math.atan2(Y, X)
  let lat = Math.atan2(Z, p * (1 - e2))
  let N = A_F
  let alt = 0
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat)
    N = A_F / Math.sqrt(1 - e2 * s * s)
    alt = p / Math.cos(lat) - N
    lat = Math.atan2(Z, p * (1 - (e2 * N) / (N + alt)))
  }
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI, altM: alt }
}

export function coordToLatLon(coord: bigint): { lat: number; lon: number; altM: number } {
  const { x, y, z } = coordToXyz(coord)
  return axesToLatLon(x, y, z)
}
