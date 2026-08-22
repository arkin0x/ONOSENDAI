/**
 * bits.ts: the arithmetic behind the XOR readout, kept out of the component so
 * the one claim it makes can be checked against the protocol's own LCA function.
 *
 * Cost here is not distance. A move between two coordinates costs 2^h - 1
 * Cantor pairings, where h = bit_length(v1 XOR v2), so the price is set entirely
 * by the highest bit at which the two values disagree. That is why 7 to 8 costs
 * sixteen times what 4 to 5 costs despite both being one step: 7 XOR 8 is
 * 0b1111 (h = 4) while 4 XOR 5 is 0b0001 (h = 1).
 *
 * A cost readout in digits cannot show why. A bit pattern can, which is what
 * this module prepares: the XOR split into the leading run of zeroes (the prefix
 * the two coordinates share, the subtree you never have to leave) and the
 * highest set bit (the wall you are paying to cross).
 *
 * The leading run is the only part that means "shared". Zeroes below the highest
 * set bit are inside the differing region and buy nothing: 0b00001001 has three
 * interior zeroes and h is still 4. Colouring all zeroes alike would draw that
 * pattern as mostly-matched when it is nothing of the sort.
 */

import type { AxisName, Position, ViewAxes } from './space'

/**
 * Width of the readout window, in bits.
 *
 * Matched to MAX_COMPUTE_HEIGHT (the Cantor ceiling) so the window sorts moves
 * into the two categories the app already distinguishes: a wall inside it is a
 * hop you can afford, and a wall above it is sidestep territory. Any other width
 * would be an arbitrary number of columns.
 *
 * Deliberately not imported from the store. This module has to stay loadable
 * without zustand and localStorage, which is what makes it testable at all.
 */
export const WINDOW_BITS = 20

const WINDOW_MASK = (1n << BigInt(WINDOW_BITS)) - 1n

/** The window's bits, MSB first, zero padded to WINDOW_BITS characters. */
function windowOf(v: bigint, low: number): string {
  return ((v >> BigInt(low)) & WINDOW_MASK).toString(2).padStart(WINDOW_BITS, '0')
}

export interface AxisReadout {
  /** Which cyberspace axis this is, since screen order changes as you rotate. */
  axis: AxisName
  /** Avatar bits in the window, MSB first. */
  avatar: string
  /** Cursor bits in the window, MSB first. */
  cursor: string
  /** XOR of the two, MSB first. Always `matched + wall + rest`. */
  xor: string
  /** Leading run of zeroes: the prefix both coordinates share. */
  matched: string
  /** The highest set bit, or '' when the wall is not inside the window. */
  wall: string
  /** Everything below the wall. Diverged territory, whatever its bits say. */
  rest: string
  /** Absolute index of the highest set XOR bit, or null when they are equal. */
  wallBit: number | null
  /** LCA height for this axis, so cost is 2^height - 1 pairings. */
  height: number
  /** A set XOR bit below the window, too fine to be reachable at this scale. */
  hiddenBelow: boolean
  /** The wall itself is above the window, so the window shows only the tail. */
  hiddenAbove: boolean
}

/**
 * Split one axis pair into the window the HUD draws.
 *
 * `low` is the current scaleExp, so the window covers bits
 * [low, low + WINDOW_BITS - 1]. Bits under it are inert while you drive, because
 * the cursor only moves in steps of 2^scaleExp, but they are not always zero:
 * nudge a gibson at scale 0 and then zoom out and the divergence you created
 * drops out of sight. It still sets the cost when nothing above it differs, so
 * it is reported rather than quietly dropped.
 */
export function axisReadout(
  axis: AxisName,
  avatar: bigint,
  cursor: bigint,
  low: number,
): AxisReadout {
  const high = low + WINDOW_BITS - 1
  const diff = avatar ^ cursor

  // Bit length via the binary string: bigint has no clz, and toString(2) never
  // emits leading zeroes, so its length is exactly the highest set bit plus one.
  // Computed here rather than borrowed from findLcaHeight so that the test
  // comparing the two is an actual cross-check instead of a tautology.
  const wallBit = diff === 0n ? null : diff.toString(2).length - 1
  const xor = windowOf(diff, low)

  // Window bits sitting strictly above the wall, clamped at both ends: a wall
  // below the window leaves the whole window shared, a wall above it leaves none
  // of the window shared, because every bit drawn is then below the divergence.
  const matchedLength =
    wallBit === null ? WINDOW_BITS : Math.min(Math.max(high - wallBit, 0), WINDOW_BITS)
  const inside = wallBit !== null && wallBit >= low && wallBit <= high

  return {
    axis,
    avatar: windowOf(avatar, low),
    cursor: windowOf(cursor, low),
    xor,
    matched: xor.slice(0, matchedLength),
    wall: inside ? xor[matchedLength] : '',
    rest: xor.slice(matchedLength + (inside ? 1 : 0)),
    wallBit,
    height: wallBit === null ? 0 : wallBit + 1,
    hiddenBelow: (diff & ((1n << BigInt(low)) - 1n)) !== 0n,
    hiddenAbove: wallBit !== null && wallBit > high,
  }
}

/**
 * The three columns of the readout, in screen order: right, up, then out.
 *
 * Screen order rather than x/y/z so a column lines up with the direction the key
 * you press moves the cursor. Rotating the view reshuffles them, which is why
 * every column carries its axis letter.
 */
export function xorReadout(
  avatar: Position,
  cursor: Position,
  axes: ViewAxes,
  scaleExp: number,
): AxisReadout[] {
  return [axes.right, axes.up, axes.out].map((a) =>
    axisReadout(a.axis, avatar[a.axis], cursor[a.axis], scaleExp),
  )
}
