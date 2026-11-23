/** Browser allocation limits are independent of the benchmark's time budget. */
import { findLcaHeight, terrainK, type Plane } from 'cyberspace-core'
import type { Position } from './space'

export const FIREFOX_BIGINT_BITS = 1_048_576
let detectedLimit: number | undefined

/** A bounded 128 KiB probe detects the 2^20-bit cap of SpiderMonkey and JavaScriptCore without UA sniffing. */
export function bigintBitLimit(): number {
  if (detectedLimit !== undefined) return detectedLimit
  try {
    const probe = 1n << BigInt(FIREFOX_BIGINT_BITS)
    detectedLimit = probe > 0n ? Infinity : FIREFOX_BIGINT_BITS
  } catch {
    detectedLimit = FIREFOX_BIGINT_BITS
  }
  return detectedLimit
}

// Pairing multiplies (a+b)*(a+b+1) BEFORE dividing by two. Include that
// temporary allocation, and conservatively carry its width into the next pair.
const pairBits = (a: number, b: number): number => 2 * (Math.max(a, b) + 1)
export function cantorTreeBits(height: number, leafBits = 85): number {
  let bits = leafBits
  for (let h = 0; h < height; h++) bits = pairBits(bits, bits)
  return bits
}

export function axisComputeCeiling(ceiling: number, limit = bigintBitLimit()): number {
  while (ceiling > 0 && cantorTreeBits(ceiling) > limit) ceiling--
  return ceiling
}

/**
 * Rides (DECK-0001 §5.3, §5.5). A ride's leaf for a block of line terrain K
 * is a Cantor tree of height K + 6, up to 22 for K = 16, and every ride, here
 * or bought from HOSAKA, needs at least one re-roll attempt, a tree of height
 * 16, plus 32 sampled leaves of any K to check. The largest number a ride
 * makes is the top pairing of a height-22 tree, about 365 million bits.
 *
 * The engines' caps, from their source: V8 2^30 bits (src/objects/bigint.h,
 * kMaxBitsBits = 30); SpiderMonkey 2^20 (js/src/vm/BigIntType.h,
 * MaxBitLength = 1024 * 1024); JavaScriptCore 2^20 (Source/JavaScriptCore/
 * runtime/JSBigInt.h, maxLengthBits = 1024 * 1024). Under 2^20 no tree past
 * height 13 fits (K = 7), so not even the re-roll attempt can be built: no
 * ride can be computed there, and none bought from HOSAKA can be checked
 * before signing.
 *
 * RIDE_MAX_HEIGHT and GRIND_HEIGHT are lib/hyperspace/ride.ts's; they are
 * repeated here so the proof workers that import this file do not pull in
 * the ride module, and a test holds them equal.
 */
export const RIDE_TREE_HEIGHT = 22
export const RIDE_GRIND_HEIGHT = 16
/** The largest BigInt a ride makes, in bits (the temporary product of a height-22 tree's top pairing). */
export const RIDE_BIGINT_BITS = cantorTreeBits(RIDE_TREE_HEIGHT)

/** Chrome on an iPhone is WebKit with the same cap, so the notice says which devices too. */
export const RIDE_CAPABILITY_ISSUE = 'This browser cannot compute or check a ride proof: use Chrome, Edge or Brave on a computer or an Android phone.'

let rideProbe: boolean | undefined

/**
 * Whether this browser can hold the largest number a ride makes. A real
 * probe, never the user agent: first the cheap 2^20-bit probe above (a capped
 * engine refuses before allocating anything), then, only where that passes,
 * one BigInt of RIDE_BIGINT_BITS bits, about 46 MB for an instant, the size a
 * K=16 block makes anyway. Once per session.
 */
export function canRideBigints(limit: number = bigintBitLimit()): boolean {
  if (Number.isFinite(limit)) return RIDE_BIGINT_BITS <= limit
  if (rideProbe !== undefined) return rideProbe
  try {
    const probe = 1n << BigInt(RIDE_BIGINT_BITS - 1)
    rideProbe = probe > 0n
  } catch {
    rideProbe = false
  }
  return rideProbe
}

/** Why this browser cannot ride (RIDE HERE, or RIDE VIA HOSAKA, whose proof is checked here), or null. */
export function rideCapabilityIssue(canRide: boolean = canRideBigints()): string | null {
  return canRide ? null : RIDE_CAPABILITY_ISSUE
}

/** A cloud hop is checked at Level 1 (hop proof version 2, spec 5.11), which
 * builds no root and needs no big numbers, so any browser can verify and
 * sign one. A cloud sidestep still rebuilds the temporal root and combines it
 * with the Merkle roots. Use the full 85-bit seed bound: later route steps
 * have not been signed yet. */
export function movementCapabilityIssue(
  mode: 'hop' | 'sidestep', from: Position, to: Position, plane: Plane,
  source: 'local' | 'cloud' = 'local', limit = bigintBitLimit(),
): string | null {
  if (!Number.isFinite(limit)) return null
  if (source === 'cloud' && mode === 'hop') return null
  const temporalBits = cantorTreeBits(terrainK(to.x, to.y, to.z, plane))
  let bits = temporalBits
  if (source === 'local' || mode === 'sidestep') {
    const axes = (['x', 'y', 'z'] as const).map(axis => mode === 'sidestep'
      ? 256 : cantorTreeBits(findLcaHeight(from[axis], to[axis]), Math.max(from[axis].toString(2).length, to[axis].toString(2).length)))
    bits = pairBits(pairBits(pairBits(axes[0], axes[1]), axes[2]), temporalBits)
  }
  if (bits <= limit) return null
  return source === 'cloud'
    ? 'This browser cannot verify this cloud proof (BigInt limit): use Chrome.'
    : 'This browser cannot compute this proof (BigInt limit): try a nearer cursor, or Chrome.'
}
