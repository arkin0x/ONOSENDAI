/**
 * chainBreak.ts - what to say about a broken chain, and to whom it is owed.
 *
 * arkinox, 2026-10-07 (Q3): an invalid chain stands at its last valid
 * position, frozen until a respawn, and the person is told which event broke
 * it and why. Two causes are not the person's doing, and for those the
 * client says so and apologizes:
 *
 * | Cause | When | Who is sorry |
 * |---|---|---|
 * | spec change | the rule broken was introduced by a chain rules revision (events.ts `breakSince`): the chain was valid under the rules when it was made | the protocol changed under you |
 * | ONOSENDAI bug | a known bug of this client signed the event (events.ts `breakBug`): the plane-bit boarding fixed in PR #225 | ONOSENDAI |
 *
 * A bug takes precedence: if ONOSENDAI signed it wrong, that is the reason,
 * whatever the rules say. Pure; the words are here so the notice, the modal
 * and the tests read the same ones.
 */

import type { ActionEvent } from './events'

export type BreakCause =
  | { kind: 'spec-change'; revision: string }
  | { kind: 'onosendai-bug'; bug: 'plane-bit' }

/** Why a break is not the person's doing, or null when nothing says it is not. */
export function breakCause(a: Pick<ActionEvent, 'breakSince' | 'breakBug'>): BreakCause | null {
  if (a.breakBug) return { kind: 'onosendai-bug', bug: a.breakBug }
  if (a.breakSince) return { kind: 'spec-change', revision: a.breakSince }
  return null
}

/** The apology a break is owed, in full, or null when none is. */
export function apologyFor(a: Pick<ActionEvent, 'breakSince' | 'breakBug'>): string | null {
  const cause = breakCause(a)
  if (!cause) return null
  if (cause.kind === 'onosendai-bug') {
    return 'We are sorry: ONOSENDAI caused this, not you. Until PR #225 fixed it, ONOSENDAI built the coordinate of a boarding from the plane lined up for your next move instead of the plane you were standing in, so this boarding names the right x, y and z in the other plane, a place your chain never reached. Every verifier rejects it, and a signed chain cannot be repaired after the fact, so the only way forward is a respawn. The bug is fixed, and it will not happen again.'
  }
  return `We are sorry. This action was valid under the chain rules when it was signed. The rules changed afterward: chain rules revision ${cause.revision} made this a rule, and under it your chain stops being valid at this action. You did nothing wrong. A signed chain cannot be changed after the fact, so the only way forward is a respawn.`
}

/** The label of the Recent entry a respawn leaves at the end of the broken chain. */
export function endOfChainLabel(lastValidId: string): string {
  return `End of Chain ${lastValidId.slice(0, 8)}`
}
