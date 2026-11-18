/**
 * randomCoord.ts - a completely random coordinate for the View panel's dice
 * (arkinox, 2026-11-18: "the dice button uses CSPRNG to generate a
 * completely random 256-bit number and then takes you to that coordinate").
 *
 * Thirty-two bytes from the browser's cryptographic generator
 * (crypto.getRandomValues), never Math.random, written as the 64 lowercase
 * hex characters a coordinate is typed and tagged as. Every 256-bit number
 * is a place: the low bit is the plane (0 dataspace, 1 ideaspace) and the
 * other 255 are X, Y and Z interleaved, 85 bits each (CYBERSPACE_V2.md §2.2,
 * cyberspace-core coordToXyz). No bit is reserved, so nothing is masked or
 * redrawn: half the rolls land in dataspace and half in ideaspace.
 */

/** The bytes in a coordinate: 256 bits. */
export const COORD_BYTES = 32

/** A uniformly random coordinate as 64 lowercase hex characters. */
export function randomCoordHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(COORD_BYTES))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
