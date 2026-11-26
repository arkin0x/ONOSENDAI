/**
 * useMessagesRead.ts: which hidden messages this identity has read, so the
 * letter's seal in the world and in the lists is whole until it is opened
 * and broken after (lib/messagesRead.ts has the rule).
 *
 * One identity's own, in IndexedDB under its pubkey (store/personalLists.ts;
 * owner ruling, 2026-11-19): a new identity starts with every seal whole,
 * and each finds its own record again when it logs back in. Switching never
 * deletes anything.
 *
 * `ready` is false from a switch until that identity's record has been read.
 * Until then every letter is drawn as read (its seal broken), so a letter
 * already read never flashes a whole seal while the read is on its way; one
 * not yet read seals itself whole a moment later. Nothing here imports the
 * identity store: startPersonalLists (store/personalStart.ts) says whose
 * record it is.
 */

import { create } from 'zustand'
import { EMPTY_READ, cleanRead, isRead, markRead, mergeRead, type MessagesRead } from '../lib/messagesRead'
import { personalList } from './personalLists'

export const MESSAGES_READ_LIST = 'messages-read'

interface MessagesReadState {
  /** Whose record this is. */
  owner: string
  read: MessagesRead
  /** The owner's stored record has been read (or there was none to read). */
  ready: boolean
  /** A message's card was opened. */
  markRead: (id: string) => void
}

/** Bumped by every show: only the newest one's read may say the record is ready. */
let shows = 0

export const useMessagesRead = create<MessagesReadState>((set, get) => ({
  owner: '',
  read: EMPTY_READ,
  ready: false,
  markRead: (id) => {
    const next = markRead(get().read, id)
    if (next === get().read) return
    set({ read: next })
    messagesReadList.save(next)
  },
}))

/**
 * Whether a letter's seal is drawn broken: read, your own, or not yet known
 * (the record still being read). A plain function of the state, for a
 * selector.
 */
export function sealBroken(s: Pick<MessagesReadState, 'read' | 'ready'>, id: string, mine: boolean): boolean {
  return !s.ready || isRead(s.read, id, mine)
}

export const messagesReadList = personalList<MessagesRead>({
  name: MESSAGES_READ_LIST,
  // New with this build: no device-wide record before it to adopt.
  legacy: () => undefined,
  clean: cleanRead,
  empty: EMPTY_READ,
  merge: mergeRead,
  show: (read, owner) => {
    const was = useMessagesRead.getState()
    const switched = was.owner !== owner
    useMessagesRead.setState({ owner, read, ready: switched ? false : was.ready })
    if (!switched && was.ready) return
    // setOwner shows the empty record and then queues the read, both before
    // this microtask: the flush after it resolves once that read is done.
    const mine = ++shows
    queueMicrotask(() => {
      void messagesReadList.flush().then(() => {
        if (mine === shows && useMessagesRead.getState().owner === owner) useMessagesRead.setState({ ready: true })
      })
    })
  },
})
