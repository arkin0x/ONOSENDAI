/** Browser allocation limits are independent of the benchmark's time budget. */
import { findLcaHeight, terrainK, type Plane } from 'cyberspace-core'
import type { Position } from './space'

export const FIREFOX_BIGINT_BITS = 1_048_576
let detectedLimit: number | undefined

/** A bounded 128 KiB probe detects SpiderMonkey's limit without UA sniffing. */
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

export const BROWSER_PROOF_WARNING = 'This browser has a BigInt size limit that prevents some movement proofs. Unsupported moves are checked before computing or paying. Use Chrome or Chromium if a move is blocked.'

/** Cloud hops return hashed envelopes, but their temporal root is still
 * recomputed locally. Sidesteps also combine that root with the Merkle roots.
 * Use the full 85-bit seed bound: later route steps have not been signed yet. */
export function movementCapabilityIssue(
  mode: 'hop' | 'sidestep', from: Position, to: Position, plane: Plane,
  source: 'local' | 'cloud' = 'local', limit = bigintBitLimit(),
): string | null {
  if (!Number.isFinite(limit)) return null
  const temporalBits = cantorTreeBits(terrainK(to.x, to.y, to.z, plane))
  let bits = temporalBits
  if (source === 'local' || mode === 'sidestep') {
    const axes = (['x', 'y', 'z'] as const).map(axis => mode === 'sidestep'
      ? 256 : cantorTreeBits(findLcaHeight(from[axis], to[axis]), Math.max(from[axis].toString(2).length, to[axis].toString(2).length)))
    bits = pairBits(pairBits(pairBits(axes[0], axes[1]), axes[2]), temporalBits)
  }
  if (bits <= limit) return null
  return source === 'cloud'
    ? 'This browser cannot verify this movement proof because it exceeds its BigInt size limit. Cloud compute cannot complete this move here. Use Chrome or Chromium.'
    : 'This browser cannot compute this movement proof because it exceeds its BigInt size limit. Use Chrome or Chromium. A shorter hop may work, but terrain can also cause this limit.'
}
