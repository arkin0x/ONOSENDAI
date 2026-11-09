/**
 * base.ts: a held key's aligned corner, exact, or known to be unknown.
 *
 * A region's corner is an 85-bit integer, kept as a decimal string. HOSAKA's
 * region_key answer sends it as a bare JSON integer, and JSON.parse made it a
 * Number, so near 2^84 its low bits were gone and String() of it read
 * "1.9342813113834067e+25". Stored like that, BigInt() of it threw: in
 * RESCAN ALL (one bought key failed every batch), in the scene's cages, in
 * the Region keys jump, in what is near. And the held-key comparison never
 * matched it.
 *
 * Now the corner of a bought key is computed here from where it was bought
 * and its height, never read from the answer (alignedBase); every reader
 * parses a stored corner with baseOf, which says null rather than throwing;
 * and a stored corner that is not an integer is repaired on load where it
 * can be (repairBase). A bought key is never dropped for it: only the corner
 * is fixed, or left as it was and ignored.
 */

import type { Position } from '../space'

export type Base = { x: string; y: string; z: string }

const AXES = ['x', 'y', 'z'] as const
const DECIMAL = /^-?\d+$/

/** The aligned corner of the 2^height cube holding `at`, as decimal strings. */
export function alignedBase(at: Position, height: number): Base {
  const h = BigInt(height)
  return { x: ((at.x >> h) << h).toString(), y: ((at.y >> h) << h).toString(), z: ((at.z >> h) << h).toString() }
}

const TWO_53 = 1n << 53n
/** String() writes an integer-valued Number below this in plain decimal, at or above it with an exponent. */
const PLAIN_DECIMAL_LIMIT = 10n ** 21n

/** The unit in the last place of a double near v (v >= 0): 1 below 2^53, else 2^(exponent - 52). */
function ulpOf(v: bigint): bigint {
  const exp = v === 0n ? 0 : v.toString(2).length - 1
  return exp > 52 ? 1n << BigInt(exp - 52) : 1n
}

/**
 * An integer only when it is exact: a decimal string, a bigint, or a safe
 * integer; null for anything else.
 *
 * Given the height of the cube it is the corner of, a decimal string past
 * 2^53 is held to more (review of #629): it must be a multiple of 2^height,
 * and one below 10^21 that a double holds exactly is refused where a double
 * would have rounded a corner of that height (2^height under its unit). Such
 * a string is what String() of a rounded Number looks like there: below
 * 10^21 String() writes plain digits, not an exponent. Near 2^84, where the
 * corners are, a rounded Number always reads with an exponent.
 */
export function exactInteger(v: unknown, height?: number): bigint | null {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return Number.isSafeInteger(v) ? BigInt(v) : null
  if (typeof v !== 'string' || !DECIMAL.test(v.trim())) return null
  const s = v.trim()
  const n = BigInt(s)
  if (height === undefined || n < TWO_53) return n
  const side = 1n << BigInt(height)
  if (n % side !== 0n) return null
  if (n < PLAIN_DECIMAL_LIMIT && side < ulpOf(n) && BigInt(Number(s)) === n) return null
  return n
}

/** Per-axis heights from a height or a box's heights. */
function perAxis(height: number | { x: number; y: number; z: number } | undefined): { x?: number; y?: number; z?: number } {
  return typeof height === 'number' ? { x: height, y: height, z: height } : height ?? {}
}

/**
 * A stored corner as a position, or null when any axis is not an exact
 * integer (held to its height when given: exactInteger). Never throws.
 */
export function baseOf(base: { x: unknown; y: unknown; z: unknown } | null | undefined, height?: number | { x: number; y: number; z: number }): Position | null {
  if (!base || typeof base !== 'object') return null
  const h = perAxis(height)
  const x = exactInteger(base.x, h.x)
  const y = exactInteger(base.y, h.y)
  const z = exactInteger(base.z, h.z)
  return x === null || y === null || z === null ? null : { x, y, z }
}

/**
 * One axis of a corner stored as a rounded Number, recovered exactly when
 * only one multiple of 2^height lies within the rounding, else null. A double
 * near v is off by at most half a unit in its last place; when 2^height is
 * wider than that unit, the one aligned value within reach is the corner.
 */
function recoverAxis(stored: unknown, height: number): bigint | null {
  const n = typeof stored === 'number' ? stored : typeof stored === 'string' ? Number(stored) : NaN
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null
  // Only what String() of a Number wrote: the same text back, not a value typed some other way.
  if (typeof stored === 'string' && String(n) !== stored) return null
  const approx = BigInt(n)
  // Below 2^53 a double is exact, so nothing was rounded and nothing is recovered here.
  if (approx < TWO_53) return null
  const ulp = ulpOf(approx)
  const side = 1n << BigInt(height)
  // One aligned corner within half a unit either way: 2^height at least the
  // unit. Equal is exact too: a corner of that height is itself a double, so
  // the Number is the corner (h32 near 2^84; review of #629).
  if (side < ulp) return null
  const h = BigInt(height)
  return ((approx + side / 2n) >> h) << h
}

/**
 * Whether an exact corner could be what a stored axis rounded from: within
 * half a unit of the Number it reads as, or equal to it when it is exact.
 * For checking a corner from elsewhere (a deploy row, HOSAKA's job) against
 * what was stored, before it replaces it.
 */
export function fitsStored(stored: unknown, corner: bigint, height: number): boolean {
  const exact = exactInteger(stored, height)
  if (exact !== null) return exact === corner
  const n = typeof stored === 'number' ? stored : typeof stored === 'string' ? Number(stored) : NaN
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return false
  const approx = BigInt(n)
  const diff = corner > approx ? corner - approx : approx - corner
  return diff * 2n <= ulpOf(approx)
}

/**
 * A key's corner as it should be stored, or null when it is already exact or
 * cannot be known. From where it was bought or hidden when that is known
 * (`at`, exact, when it fits what was stored), else recovered from the
 * rounded Number when that is unique.
 */
export function repairBase(stored: { x: unknown; y: unknown; z: unknown } | null | undefined, height: number | { x: number; y: number; z: number }, at?: Position): Base | null {
  if (baseOf(stored, height)) return null
  const per = typeof height === 'number' ? { x: height, y: height, z: height } : height
  if (at) {
    const one = (v: bigint, h: number): bigint => (v >> BigInt(h)) << BigInt(h)
    const fromAt = { x: one(at.x, per.x), y: one(at.y, per.y), z: one(at.z, per.z) }
    // Only a point the stored value could have rounded from, axis by axis: a
    // row that names the same lookup id from elsewhere is not taken on its
    // word (review of #629). One that does not fit is passed over.
    if (!stored || AXES.every((a) => fitsStored(stored[a], fromAt[a], per[a]))) {
      return { x: fromAt.x.toString(), y: fromAt.y.toString(), z: fromAt.z.toString() }
    }
  }
  if (!stored) return null
  const out: Partial<Record<'x' | 'y' | 'z', bigint>> = {}
  for (const a of AXES) {
    const exact = exactInteger(stored[a], per[a])
    const v = exact ?? recoverAxis(stored[a], per[a])
    if (v === null) return null
    out[a] = v
  }
  return { x: out.x!.toString(), y: out.y!.toString(), z: out.z!.toString() }
}

/**
 * A key's exact corner from a HOSAKA region_key job's answer, read again now
 * that big integers parse exactly (lib/hosaka parseJsonExactIntegers), or
 * null when the job is not this key's or its corner does not hold up: the
 * lookup id must be the key's, the height (when given) its height, every
 * axis an exact multiple of 2^height, and each one what the stored value
 * could have rounded from (fitsStored).
 */
export function cornerFromJob(result: unknown, key: { lookupId: string; height: number; base: { x: unknown; y: unknown; z: unknown } }): Base | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { lookup_id?: unknown; height?: unknown; base?: { x?: unknown; y?: unknown; z?: unknown } }
  if (typeof r.lookup_id !== 'string' || r.lookup_id.toLowerCase() !== key.lookupId.toLowerCase()) return null
  if (r.height !== undefined && r.height !== null && Number(r.height) !== key.height) return null
  if (!r.base || typeof r.base !== 'object') return null
  const side = 1n << BigInt(key.height)
  const out: Partial<Record<'x' | 'y' | 'z', bigint>> = {}
  for (const a of AXES) {
    const v = exactInteger(r.base[a], key.height)
    if (v === null || v % side !== 0n || !fitsStored(key.base[a], v, key.height)) return null
    out[a] = v
  }
  return { x: out.x!.toString(), y: out.y!.toString(), z: out.z!.toString() }
}
