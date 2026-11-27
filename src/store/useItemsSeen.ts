/**
 * useItemsSeen.ts: which held items this identity has looked at, so the
 * ITEMS grids can mark the rest NEW (lib/itemsSeen.ts has the rule).
 *
 * One identity's own, in IndexedDB under its pubkey (store/personalLists.ts;
 * owner ruling, 2026-11-19): a new identity starts with nothing seen since
 * NEW began, and each finds its own record again when it logs back in.
 *
 * `ready` is false from a switch until that identity's record has been read,
 * and the grids draw no NEW mark meanwhile, so an item already seen never
 * blinks NEW while the read is on its way. Nothing here imports the identity
 * store: startPersonalLists (store/personalStart.ts) says whose record it is.
 */

import { create } from 'zustand'
import type { HeldItem } from '../lib/inventory'
import { EMPTY_SEEN, cleanSeen, mergeSeen, seeItem, seeKind, type ItemsSeen, type SeenKind } from '../lib/itemsSeen'
import { personalList } from './personalLists'

export const ITEMS_SEEN_LIST = 'items-seen'

interface ItemsSeenState {
  /** Whose record this is. */
  owner: string
  seen: ItemsSeen
  /** The owner's stored record has been read (or there was none to read). */
  ready: boolean
  /** The list of `kind` was opened showing these items (for BLUEPRINTS, lib/itemsSeen blueprintSeenAs of each card). */
  markKind: (kind: SeenKind, items: ReadonlyArray<Pick<HeldItem, 'id' | 'at'>>) => void
  /** An item's card was opened. */
  markItem: (item: Pick<HeldItem, 'id' | 'type' | 'at'>) => void
}

/** Bumped by every show: only the newest one's read may say the record is ready. */
let shows = 0

export const useItemsSeen = create<ItemsSeenState>((set, get) => ({
  owner: '',
  seen: EMPTY_SEEN,
  ready: false,
  markKind: (kind, items) => {
    const next = seeKind(get().seen, kind, items)
    if (next === get().seen) return
    set({ seen: next })
    itemsSeenList.save(next)
  },
  markItem: (item) => {
    const next = seeItem(get().seen, item)
    if (next === get().seen) return
    set({ seen: next })
    itemsSeenList.save(next)
  },
}))

export const itemsSeenList = personalList<ItemsSeen>({
  name: ITEMS_SEEN_LIST,
  // New with this build: no device-wide record before it to adopt.
  legacy: () => undefined,
  clean: cleanSeen,
  empty: EMPTY_SEEN,
  merge: mergeSeen,
  show: (seen, owner) => {
    const was = useItemsSeen.getState()
    const switched = was.owner !== owner
    useItemsSeen.setState({ owner, seen, ready: switched ? false : was.ready })
    if (!switched && was.ready) return
    // setOwner shows the empty record and then queues the read, both before
    // this microtask: the flush after it resolves once that read is done.
    const mine = ++shows
    queueMicrotask(() => {
      void itemsSeenList.flush().then(() => {
        if (mine === shows && useItemsSeen.getState().owner === owner) useItemsSeen.setState({ ready: true })
      })
    })
  },
})
