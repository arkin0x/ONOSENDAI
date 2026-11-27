/**
 * useHiddenState.ts: a hidden thing's state in the world, NEW, UNREAD or READ
 * (lib/hiddenLook hiddenState), the same rule for a letter, an item's token
 * and a sound (owner ruling, 2026-11-27: read and new states on all four).
 *
 * READ is opened: a message's card, an item's card or a sound's card opened,
 * or a sound heard playing, kept per identity in the opened record
 * (store/useMessagesRead, by lineage where there is one, so a moved thing
 * stays opened). Your own are read. NEW is a find NEARBY has not shown you
 * yet (store/nearbyNew) and not yet opened; opening its card takes it off
 * NEARBY's +N too (store/nearbyNew watchNearbyOpen). Until the opened record
 * is read back nothing shows as new or unread, so a letter never shows a
 * whole seal it then breaks.
 */

import { hiddenState, type HiddenState } from '../lib/hiddenLook'
import { readId } from '../lib/messagesRead'
import { useNearbyNew } from '../store/nearbyNew'
import { sealBroken, useMessagesRead } from '../store/useMessagesRead'

export function useHiddenState(item: { key: string; lineage?: string }, mine: boolean): HiddenState {
  const read = useMessagesRead((s) => sealBroken(s, readId(item), mine))
  const fresh = useNearbyNew()
  return hiddenState({ mine, read, fresh: fresh.has(item.key) })
}
