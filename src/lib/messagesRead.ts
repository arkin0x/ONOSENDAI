/**
 * messagesRead.ts: which hidden messages this identity has read, so a letter
 * keeps its seal whole until it is opened and shows it broken after (owner,
 * 2026-11-26: "love the broken seal for read").
 *
 * A message is read once its card has been opened. The record is one
 * identity's own (owner ruling, 2026-11-19: all local data in IndexedDB keyed
 * by npub; switching identity never deletes), kept by store/useMessagesRead.ts
 * as a personal list (store/personalLists.ts): the ids read, newest first,
 * capped. A message is known by its lineage where it has one, so a letter its
 * author moved is still the one you read (readId).
 *
 * Your own messages are read: you wrote them (isRead `mine`).
 *
 * Pure: nothing here reads a store, the clock or IndexedDB.
 */

/** How many read messages are remembered. The oldest drop off first. */
export const READ_IDS_MAX = 2000

export interface MessagesRead {
  /** Ids read, newest first. */
  ids: string[]
}

export const EMPTY_READ: MessagesRead = { ids: [] }

/** What a message is remembered by: its lineage, which a move keeps, else its own id. */
export function readId(item: { key: string; lineage?: string }): string {
  return item.lineage || item.key
}

/** What was read back, as this app can use it: anything malformed is dropped, never thrown. */
export function cleanRead(raw: unknown): MessagesRead {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { ids?: unknown }
  const ids = Array.isArray(r.ids) ? r.ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
  return { ids: [...new Set(ids)].slice(0, READ_IDS_MAX) }
}

/** Two records as one, losing nothing either read: `early`'s first. */
export function mergeRead(stored: MessagesRead, early: MessagesRead): MessagesRead {
  return { ids: [...new Set([...early.ids, ...stored.ids])].slice(0, READ_IDS_MAX) }
}

/** Whether a message is read: opened before, or your own. */
export function isRead(read: MessagesRead, id: string, mine = false): boolean {
  return mine || read.ids.includes(id)
}

/** A message's card was opened: it is read. The same record when it already was, so a caller can skip the write. */
export function markRead(read: MessagesRead, id: string): MessagesRead {
  if (!id || read.ids[0] === id) return read
  if (read.ids.includes(id)) return read
  return { ids: [id, ...read.ids].slice(0, READ_IDS_MAX) }
}
