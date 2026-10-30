/**
 * staleFormat.ts - signed, never sent, and in a format the chain rules no
 * longer accept.
 *
 * A tab running the build before the hop proof version 2 cutover could sign
 * hops it did not send: LIVE off, offline, a held chain, or the version gate
 * holding the publisher once the cutover deployed. Those hops carry the
 * version 1 proof hash and no `mn` or `mp`, and they wait in the saved chain.
 * The build after the cutover loads that chain and would publish them, and
 * an unlisted version 1 hop published after the census is invalid for good:
 * the chain freezes at it (strict ruling D2, 2026-10-30). So before anything
 * is sent the unsent events are inspected (lib/chainRulesEpoch.ts, cutover
 * checklist item 1), and the first one in the old format is cut away with
 * every event after it, which names it, directly or through another.
 *
 * Published events are never touched here: they are on the relays already,
 * and the census decides them (spec 5.13).
 */

import { hopProofForm, type NostrEvent } from './events'

export interface StaleFormatCut {
  /** Where the chain is cut: the index of the first unsent event in the old format. */
  at: number
  /** That event and every event after it. */
  removed: NostrEvent[]
  /**
   * The one hop to make again in the new format, when it is all the cut
   * removed; null when the cut took more, which is dropped.
   */
  reprove: NostrEvent | null
}

/** Whether an event is in a hop format this build does not sign: version 1, or only one of `mn` and `mp`. */
export function staleHopFormat(ev: NostrEvent): boolean {
  const form = hopProofForm(ev)
  return form === 'v1' || form === 'partial'
}

/**
 * The cut for a chain in hand, or null when no unsent event is in the old
 * format. `sent` says whether an event is on the relays already.
 */
export function staleFormatCut(events: readonly NostrEvent[], sent: (id: string) => boolean): StaleFormatCut | null {
  const at = events.findIndex((e) => !sent(e.id) && staleHopFormat(e))
  // A spawn is never a hop, so a cut always leaves the chain its spawn.
  if (at < 1) return null
  const removed = events.slice(at)
  return { at, removed, reprove: removed.length === 1 ? removed[0] : null }
}
