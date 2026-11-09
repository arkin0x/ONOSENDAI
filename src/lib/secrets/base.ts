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

/** An integer only when it is exact: a decimal string, a bigint, or a safe integer; null for anything else. */
export function exactInteger(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return Number.isSafeInteger(v) ? BigInt(v) : null
  if (typeof v === 'string' && DECIMAL.test(v.trim())) return BigInt(v.trim())
  return null
}

/** A stored corner as a position, or null when any axis is not an exact integer. Never throws. */
export function baseOf(base: { x: unknown; y: unknown; z: unknown } | null | undefined): Position | null {
  if (!base || typeof base !== 'object') return null
  const x = exactInteger(base.x)
  const y = exactInteger(base.y)
  const z = exactInteger(base.z)
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
  const approx = BigInt(n)
  // The unit in the last place of n: 2^(exponent - 52) for a normal double.
  const exp = approx === 0n ? 0 : approx.toString(2).length - 1
  const ulp = exp > 52 ? 1n << BigInt(exp - 52) : 1n
  const side = 1n << BigInt(height)
  if (side <= ulp) return null
  const h = BigInt(height)
  return ((approx + side / 2n) >> h) << h
}

/**
 * A key's corner as it should be stored, or null when it is already exact or
 * cannot be known. From where it was bought or hidden when that is known
 * (`at`, exact), else recovered from the rounded Number when that is unique.
 */
export function repairBase(stored: { x: unknown; y: unknown; z: unknown } | null | undefined, height: number | { x: number; y: number; z: number }, at?: Position): Base | null {
  if (baseOf(stored)) return null
  const per = typeof height === 'number' ? { x: height, y: height, z: height } : height
  if (at) {
    const one = (v: bigint, h: number): string => ((v >> BigInt(h)) << BigInt(h)).toString()
    return { x: one(at.x, per.x), y: one(at.y, per.y), z: one(at.z, per.z) }
  }
  if (!stored) return null
  const out: Partial<Record<'x' | 'y' | 'z', bigint>> = {}
  for (const a of AXES) {
    const exact = exactInteger(stored[a])
    const v = exact ?? recoverAxis(stored[a], per[a])
    if (v === null) return null
    out[a] = v
  }
  return { x: out.x!.toString(), y: out.y!.toString(), z: out.z!.toString() }
}
