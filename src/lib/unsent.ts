/**
 * unsent.ts: the actions of a chain no relay has taken yet, in chain order,
 * kept up to date as the chain grows and its actions are taken, rather than
 * read off the whole chain at every change (owner's phone walk of
 * 2026-11-21: a 2,600-action chain, several such passes per WALK step).
 *
 * The answer for one chain and one published map is kept. Asked again for a
 * chain that is the one kept plus actions added at its end, only the actions
 * that were unsent and the added ones are read, which is the backlog, not the
 * chain. Any other chain is read whole, as before.
 *
 * An action marked 'ok' only ever stays 'ok', except where a fold takes in
 * another tab's save and marks back what no relay has (useCyberspace
 * takeInStored): that calls forgetUnsent, and so must anything else that
 * ever marks an 'ok' action otherwise.
 */
import type { NostrEvent } from './events'

/** What a publish status map holds for one action: anything but 'ok' is not on a relay. */
export type PublishedMap = Readonly<Record<string, string>>

interface Kept { events: readonly NostrEvent[]; published: PublishedMap; unsent: NostrEvent[] }
let kept: Kept | null = null

/** Whether `events` begins with every one of `before`, the same objects in the same order. */
function grownFrom(before: readonly NostrEvent[], events: readonly NostrEvent[]): boolean {
  if (events.length < before.length) return false
  for (let i = 0; i < before.length; i++) if (events[i] !== before[i]) return false
  return true
}

/** The actions of `events` whose status in `published` is not 'ok', in chain order. Do not change the array handed back. */
export function unsentOf(events: readonly NostrEvent[], published: PublishedMap): readonly NostrEvent[] {
  if (kept && kept.events === events && kept.published === published) return kept.unsent
  let unsent: NostrEvent[]
  if (kept && grownFrom(kept.events, events)) {
    unsent = kept.unsent.filter((e) => published[e.id] !== 'ok')
    for (let i = kept.events.length; i < events.length; i++) if (published[events[i].id] !== 'ok') unsent.push(events[i])
  } else {
    unsent = events.filter((e) => published[e.id] !== 'ok')
  }
  kept = { events, published, unsent }
  return unsent
}

/** Drop the kept answer: the next is read off the whole chain. For a change that marks an 'ok' action otherwise. */
export function forgetUnsent(): void {
  kept = null
}
