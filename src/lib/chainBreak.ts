/**
 * chainBreak.ts - what to say about a broken chain, and to whom it is owed.
 *
 * arkinox, 2026-10-07 (Q3): an invalid chain stands at its last valid
 * position, frozen until a respawn, and the person is told which event broke
 * it and why. Two causes are not the person's doing, and for those the
 * client says so and apologizes, but only where it is true:
 *
 * | Cause | When it is owed | What it says |
 * |---|---|---|
 * | spec change | the rule broken took effect after the event was signed (events.ts `breakSince`, a RuleChange with its effective time) | the action was valid when signed; the rule took effect on that day, by spec PR #44 or by arkinox's ruling |
 * | added validation | the same, for a check the rules gained on what was already there (sector tags, Q9) | the rules gained additional validation after it was signed |
 * | ONOSENDAI bug | a known bug signed the event, and it was signed before the fix shipped (events.ts `breakBug`; the plane-bit boarding, fixed in PR #225 at PLANE_BIT_FIX_AT) | ONOSENDAI caused it |
 *
 * An event signed after the rule took effect, or after the fix shipped, gets
 * the reason and no apology: the rule was there to be followed. A bug takes
 * precedence over a spec change: if ONOSENDAI signed it wrong, that is the
 * reason, whatever the rules say. Pure; the words are here so the notice,
 * the modal and the tests read the same ones.
 */

import { PLANE_BIT_FIX_AT, type ActionEvent, type RuleChange } from './events'

export type BreakCause =
  | { kind: 'spec-change'; rule: RuleChange }
  | { kind: 'onosendai-bug'; bug: 'plane-bit' }

type Broken = Pick<ActionEvent, 'breakSince' | 'breakBug' | 'createdAt'>

/** Why a break is not the person's doing, or null when nothing says it is not. */
export function breakCause(a: Broken): BreakCause | null {
  if (a.breakBug === 'plane-bit' && a.createdAt < PLANE_BIT_FIX_AT) return { kind: 'onosendai-bug', bug: a.breakBug }
  if (a.breakSince && a.createdAt < a.breakSince.effectiveAt) return { kind: 'spec-change', rule: a.breakSince }
  return null
}

/** How a rule came to be, in words: "on 2026-10-07, by arkinox's ruling of that day ...". */
function cameAbout(rule: RuleChange): string {
  return rule.by === 'spec-44'
    ? `on ${rule.since}, when spec PR #44 brought virtual brackets into chain rules revision ${rule.revision}`
    : `on ${rule.since}, by arkinox's ruling of that day, folded into chain rules revision ${rule.revision} (the spec errata is pending)`
}

/** The one-line heading over an apology. */
export function apologyHeading(cause: BreakCause): string {
  if (cause.kind === 'onosendai-bug') return 'ONOSENDAI caused this.'
  return cause.rule.kind === 'validation'
    ? 'The rules gained additional validation after this was signed.'
    : 'The rules changed after this was signed.'
}

/** The apology a break is owed, in full, or null when none is. */
export function apologyFor(a: Broken): string | null {
  const cause = breakCause(a)
  if (!cause) return null
  if (cause.kind === 'onosendai-bug') {
    return 'We are sorry: ONOSENDAI caused this, not you. Until PR #225 fixed it on 2026-10-07, ONOSENDAI built the coordinate of a boarding from the plane lined up for your next move instead of the plane you were standing in, so this boarding names the right x, y and z in the other plane, a place your chain never reached. Every verifier rejects it, and a signed chain cannot be repaired after the fact, so the only way forward is a respawn. The bug is fixed, and it will not happen again.'
  }
  const { rule } = cause
  if (rule.kind === 'validation') {
    return `We are sorry. When this action was signed, nothing checked what it is now checked for: the chain rules gained additional validation ${cameAbout(rule)}, and this action does not pass it. You did nothing wrong. A signed chain cannot be changed after the fact, so the only way forward is a respawn.`
  }
  return `We are sorry. This action was valid under the chain rules when it was signed. The rule it breaks took effect ${cameAbout(rule)}, after this action was signed, and under it your chain stops being valid here. You did nothing wrong. A signed chain cannot be changed after the fact, so the only way forward is a respawn.`
}

/** The label of the Recent entry a respawn leaves at the end of the broken chain. */
export function endOfChainLabel(lastValidId: string): string {
  return `End of Chain ${lastValidId.slice(0, 8)}`
}
