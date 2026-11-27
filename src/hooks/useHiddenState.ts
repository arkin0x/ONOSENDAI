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

import { useEffect } from 'react'
import { hiddenState, type HiddenState } from '../lib/hiddenLook'
import { readId } from '../lib/messagesRead'
import { clearNearbyNew, useNearbyNew } from '../store/nearbyNew'
import { useCyberspace } from '../store/useCyberspace'
import { sealBroken, useMessagesRead } from '../store/useMessagesRead'

export function useHiddenState(item: { key: string; lineage?: string }, mine: boolean): HiddenState {
  const read = useMessagesRead((s) => sealBroken(s, readId(item), mine))
  const fresh = useNearbyNew()
  return hiddenState({ mine, read, fresh: fresh.has(item.key) })
}

/** The hidden things whose card opening reads them: a message, an item (kind key) and a sound. */
export function opensAsHidden(type: string): boolean {
  return type === 'message' || type === 'key' || type === 'audio'
}

/**
 * An item's card is open (hud/SecretModal): a message, an item or a sound
 * opened is no longer NEW, here or on NEARBY's +N; an item's or a sound's
 * card marks it READ, as a letter's card does (hud/LetterCard), unless it is
 * your own. A chest or a door keeps NEARBY's own rule (store/nearbyNew) and
 * is not marked.
 */
export function useMarkOpened(item: { key: string; lineage?: string; type: string; author?: string } | null): void {
  const me = useCyberspace((s) => s.identity.pubkey)
  const hidden = !!item && opensAsHidden(item.type)
  const openedKey = hidden ? item.key : null
  const openedId = hidden ? readId(item) : null
  const marksRead = hidden && item.type !== 'message' && item.author !== me
  useEffect(() => {
    if (!openedKey || !openedId) return
    if (marksRead) useMessagesRead.getState().markRead(openedId)
    if (me) clearNearbyNew(me, [openedKey])
  }, [openedKey, openedId, marksRead, me])
}
