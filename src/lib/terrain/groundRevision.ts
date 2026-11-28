/**
 * groundRevision.ts - which revision of the generated ground a chunk is
 * (DECK-0009 §3.10, §5.4 and §7.5, cyberspace #128).
 *
 * The ground has two revisions: 2, frozen (layers on relays name it), and 3,
 * which changes only the vein rolls (Glowcore from K 8, the cinder vent), so
 * the two meet without seams. A chunk keeps the revision it was first
 * surveyed at, so the ground never shifts under a build:
 *
 * - every surveyed plane of a layer names its revision (`ground`) and the
 *   date of its first survey (`surveyed`), carried forward unchanged;
 * - a reader's base revision for a plane is the revision of the first
 *   counted survey by the reader's own rank, then the earliest `surveyed`,
 *   then the lower author, builder key and event id (blockLayer.ts
 *   baseRevision);
 * - a writer's first survey of a plane takes the base revision its view
 *   gives, or, where nobody surveyed it, GROUND_WRITE_REVISION.
 *
 * Shipping a revision (§3.10): a client reads it a release before it writes
 * it, so clients not yet updated do not set aside the first chunks surveyed
 * at it. Revision 3 was read from #957 on while revision 2 was still
 * written; GROUND_WRITE_REVISION is 3 since, so new surveys find Glowcore
 * and Cinderrock. Reverting this one constant goes back to 2.
 */

import { isGroundRevision, type GroundRevision } from './generate'

export { GROUND_REVISIONS, isGroundRevision, type GroundRevision } from './generate'

/**
 * The revision a fresh chunk is surveyed at: one nobody has surveyed in this
 * reader's view. 3: chunks already surveyed keep their own revision, 2 for
 * every one surveyed before.
 */
export const GROUND_WRITE_REVISION: GroundRevision = 3

let writeRevision: GroundRevision = GROUND_WRITE_REVISION

/** The revision a fresh survey writes now (GROUND_WRITE_REVISION, unless a test set another). */
export function groundWriteRevision(): GroundRevision {
  return writeRevision
}

/** For tests: write another revision (null puts GROUND_WRITE_REVISION back). */
export function setGroundWriteRevisionForTests(r: GroundRevision | null): void {
  writeRevision = r ?? GROUND_WRITE_REVISION
}

/**
 * A plane's `surveyed` as a reader reads it (§5.4): a non-negative integer no
 * later than the layer's `created_at`; anything else, absent included, reads
 * as the layer's `created_at`. Never a reason to drop a layer.
 */
export function readSurveyed(plane: { surveyed?: unknown }, createdAt: number): number {
  const v = plane.surveyed
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= createdAt ? v : createdAt
}

/** A stored revision as this client reads it: anything but 2 or 3 (an old row with none) is 2, the only revision written before 3. */
export function storedRevision(v: unknown): GroundRevision {
  return isGroundRevision(v) ? v : 2
}
