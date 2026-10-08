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
 * | spec change | the rule broken took effect after the event was signed (events.ts `breakSince`, a RuleChange with its effective time) | the action was valid when signed; the rule took effect on that day, by spec PR #44, by arkinox's ruling (since written into the spec by PR #46), or by PR #46 merging |
 * | added validation | the same, for a check the rules gained on what was already there (sector tags, Q9; one A tag, Q5; each sector tag once, spec PR #46) | the rules gained additional validation after it was signed |
 * | ONOSENDAI bug, plane bit | a plane-bit boarding signed before PR #225 shipped, plus a day for tabs still running the old bundle (PLANE_BIT_APOLOGY_UNTIL) | ONOSENDAI caused it |
 * | ONOSENDAI offered it | a zero-length ride carrying ONOSENDAI's client tag, signed after the 2026-10-07 ruling: ONOSENDAI kept offering them until this change deployed | ONOSENDAI caused it, offering a ride it had not been updated to refuse |
 *
 * An event signed after the rule took effect, by anyone but ONOSENDAI's own
 * old build, gets the reason and no apology: the rule was there to be
 * followed. The plane-bit bug comes first: if ONOSENDAI signed it wrong,
 * that is the reason, whatever the rules say. A zero-length ride signed
 * before the ruling is owed the spec-change apology, which is the truer one;
 * after it, the ONOSENDAI one. Pure; the words are here so the notice, the
 * modal and the tests read the same ones.
 */

import { FORK_RULE_WORDS, PLANE_BIT_APOLOGY_UNTIL, type ActionEvent, type RuleChange } from './events'

/**
 * The words the broken-chain notice, its modal and its chip use for a
 * break. A fork stands at the spawn coordinate, not at a last valid
 * position (spec §3.2, §8.7.3 rule 4), and its rule is said once: the
 * notice names the two branches, and "Why" is the rule.
 */
export function brokenWords(broken: { index: number; action: Pick<ActionEvent, 'fork' | 'breaks'> }): { title: string; chip: string; chipMeta: string; why: string } {
  if (broken.action.fork) {
    return { title: 'Your chain forked: you stand at your spawn coordinate', chip: 'CHAIN FORKED', chipMeta: 'AT YOUR SPAWN COORDINATE · TAP FOR WHY AND RESPAWN', why: FORK_RULE_WORDS }
  }
  return { title: 'Frozen at your last valid position', chip: `CHAIN BROKEN AT ROW ${broken.index}`, chipMeta: 'FROZEN AT YOUR LAST VALID POSITION · TAP FOR WHY AND RESPAWN', why: broken.action.breaks ?? 'it breaks a chain rule' }
}

export type BreakCause =
  | { kind: 'spec-change'; rule: RuleChange }
  | { kind: 'onosendai-bug'; bug: 'plane-bit' | 'zero-length-offered' }

type Broken = Pick<ActionEvent, 'breakSince' | 'breakBug' | 'createdAt'>

/** Why a break is not the person's doing, or null when nothing says it is not. */
export function breakCause(a: Broken): BreakCause | null {
  if (a.breakBug === 'plane-bit' && a.createdAt < PLANE_BIT_APOLOGY_UNTIL) return { kind: 'onosendai-bug', bug: 'plane-bit' }
  if (a.breakSince && a.createdAt < a.breakSince.effectiveAt) return { kind: 'spec-change', rule: a.breakSince }
  if (a.breakBug === 'zero-length-offered') return { kind: 'onosendai-bug', bug: 'zero-length-offered' }
  return null
}

/** How a rule came to be, in words: "on 2026-10-07, by arkinox's ruling of that day ...". */
function cameAbout(rule: RuleChange): string {
  if (rule.by === 'spec-44') return `on ${rule.since}, when spec PR #44 brought virtual brackets into chain rules revision ${rule.revision}`
  if (rule.by === 'spec-46') return `on ${rule.since}, when spec PR #46 merged with arkinox's clarifications in it, into chain rules revision ${rule.revision}`
  return `on ${rule.since}, by arkinox's ruling of that day, folded into chain rules revision ${rule.revision}${rule.spec ? ` and ${rule.spec}` : ''}`
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
  if (cause.kind === 'onosendai-bug' && cause.bug === 'zero-length-offered') {
    return 'We are sorry: ONOSENDAI caused this, not you. Zero-length rides stopped being valid with arkinox\'s ruling of 2026-10-07, but the ONOSENDAI you rode with had not been updated yet, so it still offered this ride and signed it for you. Every verifier now rejects it, and a signed chain cannot be repaired after the fact, so the only way forward is a respawn. ONOSENDAI no longer offers a ride to the block it starts from.'
  }
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
