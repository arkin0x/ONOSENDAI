/**
 * agentDmDb.ts: the decrypted conversations with your agents, kept in
 * IndexedDB per identity (arkinox, 2026-10-12: "I want every decrypted and
 * sent message between me and my agent to remain in local IndexedDB so that
 * they load instantly when I open my agent chat. We shouldn't have to
 * decrypt messages ever again once they're decrypted once.").
 *
 * THE TRADE-OFF (arkinox, 2026-10-12): the plaintext of these private
 * messages now rests on this device, in IndexedDB. Anyone with the unlocked
 * device, or a copy of the browser's data (a profile export, a backup), can
 * read them without any key. Before this they lived in memory for a session
 * and the relays held only gift wraps. CLEAR HISTORY in TALK deletes one
 * conversation's stored messages from this device.
 *
 * Two stores, one row per thing per identity, each indexed by `owner` so an
 * identity's rows come back in one read and another identity's never do:
 *
 * | Store | Key | Holds |
 * |---|---|---|
 * | opened | owner:wrap id | every wrap this identity decrypted here, kept or dropped: never decrypted again. No plaintext. |
 * | items | owner:rumor id | a message or a reaction between you and one agent, with the agent, by `byConversation` [owner, agent] |
 *
 * A wrap that opened to someone else's message (not between you and one of
 * your agents) is noted in `opened` and nothing of it is kept, as before.
 * The same promise wrapper as the other databases (lib/idb.ts); nothing here
 * knows about zustand, which store/useAgentDms.ts owns.
 */

import { openDatabase, request } from './idb'
import type { DmMessage, DmReaction } from './dm'

export const AGENT_DM_DB = 'onosendai:agent-dms'
export const DB_VERSION = 1
export const OPENED_STORE = 'opened'
export const ITEMS_STORE = 'items'
export const BY_OWNER = 'byOwner'
export const BY_CONVERSATION = 'byConversation'

/** How long opening may take before the store gives up and keeps the conversation in memory for the session. */
export const OPEN_TIMEOUT_MS = 8000

/** A wrap decrypted on this device: its id and its created_at. */
export interface OpenedRow { rowKey: string; owner: string; wrapId: string; at: number }

/** A message or a reaction, kept per identity and per agent. */
export type ItemRow =
  | { rowKey: string; owner: string; agent: string; kind: 'message'; message: DmMessage }
  | { rowKey: string; owner: string; agent: string; kind: 'reaction'; reaction: DmReaction }

export const openedRow = (owner: string, wrapId: string, at: number): OpenedRow => ({ rowKey: `${owner}:${wrapId}`, owner, wrapId, at })

export const messageRow = (owner: string, agent: string, message: DmMessage): ItemRow => ({ rowKey: `${owner}:${message.id}`, owner, agent, kind: 'message', message })

export const reactionRow = (owner: string, agent: string, reaction: DmReaction): ItemRow => ({ rowKey: `${owner}:${reaction.id}`, owner, agent, kind: 'reaction', reaction })

export function openAgentDmDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(AGENT_DM_DB, DB_VERSION, [
    [OPENED_STORE, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }]],
    [ITEMS_STORE, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }, { name: BY_CONVERSATION, keyPath: ['owner', 'agent'] }]],
  ])
  // As inventoryDb.ts does: a blocked upgrade or a browser that never answers
  // must not hold the conversation, and a late connection is closed.
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

function isMessage(v: unknown): v is DmMessage {
  const m = v as DmMessage | null
  return !!m && typeof m.id === 'string' && typeof m.from === 'string' && typeof m.text === 'string' && typeof m.at === 'number'
}

function isReaction(v: unknown): v is DmReaction {
  const r = v as DmReaction | null
  return !!r && typeof r.id === 'string' && typeof r.from === 'string' && typeof r.target === 'string' && typeof r.content === 'string' && typeof r.at === 'number'
}

/** Whether a stored value is an item this app can show, for `owner`. */
export function isItemRow(v: unknown, owner: string): v is ItemRow {
  const it = v as ItemRow | null
  if (!it || typeof it !== 'object' || it.owner !== owner || typeof it.agent !== 'string') return false
  return it.kind === 'message' ? isMessage(it.message) : it.kind === 'reaction' ? isReaction(it.reaction) : false
}

/** What one identity has here: the wraps it opened and its kept items. */
export interface Stored { opened: string[]; items: ItemRow[] }

export async function readStored(db: IDBDatabase, owner: string): Promise<Stored> {
  const tx = db.transaction([OPENED_STORE, ITEMS_STORE], 'readonly')
  const [opened, items] = await Promise.all([
    request(tx.objectStore(OPENED_STORE).index(BY_OWNER).getAll(owner)) as Promise<unknown[]>,
    request(tx.objectStore(ITEMS_STORE).index(BY_OWNER).getAll(owner)) as Promise<unknown[]>,
  ])
  return {
    opened: opened.filter((o): o is OpenedRow => !!o && (o as OpenedRow).owner === owner && typeof (o as OpenedRow).wrapId === 'string').map((o) => o.wrapId),
    items: items.filter((i): i is ItemRow => isItemRow(i, owner)),
  }
}

/** Keep opened wraps and items in one transaction, so a wrap is never noted opened without what it held. */
export function writeStored(db: IDBDatabase, opened: OpenedRow[], items: ItemRow[]): Promise<void> {
  if (!opened.length && !items.length) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([OPENED_STORE, ITEMS_STORE], 'readwrite')
    for (const o of opened) tx.objectStore(OPENED_STORE).put(o)
    for (const i of items) tx.objectStore(ITEMS_STORE).put(i)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/**
 * Delete one conversation's items (CLEAR HISTORY). The opened wraps stay
 * noted, with no plaintext in them, so the cleared messages are not decrypted
 * and stored again from the relays on this device.
 */
export function deleteConversation(db: IDBDatabase, owner: string, agent: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ITEMS_STORE, 'readwrite')
    const os = tx.objectStore(ITEMS_STORE)
    const keys = os.index(BY_CONVERSATION).getAllKeys([owner, agent])
    keys.onsuccess = () => { for (const k of keys.result) os.delete(k) }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
  })
}
