/**
 * divisions.ts: stepping through the grid divisions, and how finely the
 * bench draws them (arkinox, 2026-10-15: divisions down to a single tick).
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

/** The finest division the bench draws as lines; finer snaps are drawn at a divisor of it. */
export const DRAWN_DIVISION_MAX = 12

/**
 * The division the bench draws for a snap of `division`: the snap itself up
 * to DRAWN_DIVISION_MAX lines a unit, past that its largest divisor that is
 * no finer, so every drawn line is still a place the snap can land and 1/120
 * reads as a grid rather than a solid sheet.
 */
export function drawnDivision(division: number): number {
  if (division <= DRAWN_DIVISION_MAX) return division
  for (let d = DRAWN_DIVISION_MAX; d > 1; d--) if (division % d === 0) return d
  return 1
}
