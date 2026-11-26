/**
 * messagesReadStore.test.ts: which hidden messages an identity has read is
 * its own, in IndexedDB under its pubkey (owner ruling, 2026-11-19: all local
 * data per npub in IDB; switching identity never deletes): a new identity
 * finds every seal whole, switching back brings the first identity's broken
 * seals back, a reload keeps them, and no seal is drawn whole before the
 * record is read (a read letter never flashes whole).
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isRead } from '../../lib/messagesRead'

const A = 'aa'.repeat(32)
const B = 'bb'.repeat(32)

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}

type Store = typeof import('../useMessagesRead')

/** A page load: fresh modules over the same database. */
async function load(): Promise<Store> {
  const lists = await import('../personalLists')
  lists.stopHearingOtherTabs()
  vi.resetModules()
  return import('../useMessagesRead')
}

/** Until the record shown is `owner`'s, read. */
async function readyFor(S: Store, owner: string): Promise<void> {
  for (let i = 0; i < 200 && !(S.useMessagesRead.getState().ready && S.useMessagesRead.getState().owner === owner); i++) await new Promise((r) => setTimeout(r, 1))
  expect(S.useMessagesRead.getState()).toMatchObject({ owner, ready: true })
}

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  mem.clear()
})

describe('read messages are kept per identity', () => {
  it('A reads a message; B finds it unread; A gets its record back on switching and on a reload; nothing is deleted', async () => {
    let S = await load()
    const asA = S.messagesReadList.setOwner(A)
    // Not ready until A's record is read: every seal is drawn broken meanwhile, never whole by mistake.
    expect(S.useMessagesRead.getState().ready).toBe(false)
    expect(S.sealBroken(S.useMessagesRead.getState(), 'm1', false)).toBe(true)
    await asA
    await readyFor(S, A)
    expect(S.sealBroken(S.useMessagesRead.getState(), 'm1', false)).toBe(false)
    S.useMessagesRead.getState().markRead('m1')
    await S.messagesReadList.flush()
    expect(isRead(S.useMessagesRead.getState().read, 'm1')).toBe(true)

    await S.messagesReadList.setOwner(B)
    await readyFor(S, B)
    expect(isRead(S.useMessagesRead.getState().read, 'm1')).toBe(false)
    expect(S.sealBroken(S.useMessagesRead.getState(), 'm1', false)).toBe(false)
    // B's own message is read: B wrote it.
    expect(S.sealBroken(S.useMessagesRead.getState(), 'm2', true)).toBe(true)

    await S.messagesReadList.setOwner(A)
    await readyFor(S, A)
    expect(isRead(S.useMessagesRead.getState().read, 'm1')).toBe(true)

    S = await load()
    await S.messagesReadList.setOwner(A)
    await readyFor(S, A)
    expect(isRead(S.useMessagesRead.getState().read, 'm1')).toBe(true)
    // In IndexedDB, not localStorage.
    expect([...mem.keys()].filter((k) => k.includes('messages-read') && !k.includes('adopted'))).toEqual([])
  })

  it('a card opened before the record was read is kept, merged into what is read', async () => {
    let S = await load()
    await S.messagesReadList.setOwner(A)
    await readyFor(S, A)
    S.useMessagesRead.getState().markRead('old')
    await S.messagesReadList.flush()

    S = await load()
    const reading = S.messagesReadList.setOwner(A)
    S.useMessagesRead.getState().markRead('early')
    await reading
    await readyFor(S, A)
    const read = S.useMessagesRead.getState().read
    expect(isRead(read, 'old')).toBe(true)
    expect(isRead(read, 'early')).toBe(true)
  })
})
