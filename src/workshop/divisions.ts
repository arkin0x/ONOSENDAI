/**
 * divisions.ts: stepping through the grid divisions (arkinox, 2026-10-15:
 * divisions down to a single tick). The bench draws every one as itself
 * (benchGrid.ts).
 *
 * The divisions themselves are sno-core's DIVISIONS, every one a divisor of
 * TICKS_PER_UNIT, so a snap always lands on whole ticks.
 */
import { DIVISIONS, type Division } from 'sno-core/shards'

/** The next division in the list, finer for +1 and coarser for -1, held at the ends. */
export function stepDivision(current: Division, dir: 1 | -1): Division {
  const i = DIVISIONS.indexOf(current)
  const at = i < 0 ? 0 : i
  return DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, at + dir))]
}
