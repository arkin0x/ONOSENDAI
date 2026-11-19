/**
 * personalListsUnit.test.ts: store/personalLists.ts on its own, with a list
 * of words, for the ways a change could be lost (review of #827): a change
 * made before the read answered and then a switch; a failed read; a change
 * made while the merged list was being written; a reread landing over a
 * newer change; no IndexedDB at all.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const A = 'aa'.repeat(32)
const B = 'bb'.repeat(32)

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}

type Lists = typeof import('../personalLists')
type Db = typeof import('../../lib/personalDb')

let shown: { value: string[]; owner: string } = { value: [], owner: '' }
const union = (stored: string[], early: string[]): string[] => [...early, ...stored.filter((w) => !early.includes(w))]

let instance = 0
/** A page load. Earlier loads' modules stay alive and hear this one's BroadcastChannel, as other tabs would, so only the newest draws into `shown`. */
async function fresh(mockDb?: (db: Db) => Partial<Db>): Promise<{ L: Lists; list: import('../personalLists').PersonalList<string[]> }> {
  const me = ++instance
  vi.resetModules()
  if (mockDb) {
    const real = await import('../../lib/personalDb')
    vi.doMock('../../lib/personalDb', () => ({ ...real, ...mockDb(real) }))
  }
  const L = await import('../personalLists')
  const list = L.personalList<string[]>({
    name: 'words',
    legacy: () => undefined,
    clean: (raw) => (Array.isArray(raw) ? raw.filter((w): w is string => typeof w === 'string') : []),
    empty: [],
    merge: union,
    show: (value, owner) => { if (me === instance) shown = { value, owner } },
  })
  return { L, list }
}

/** What the database holds for `owner`, read by a fresh module. */
async function stored(owner: string): Promise<unknown> {
  vi.doUnmock('../../lib/personalDb')
  vi.resetModules()
  const db = await import('../../lib/personalDb')
  const d = await db.openPersonalDb()
  const v = await db.readList(d, owner, 'words')
  d.close()
  return v
}

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  mem.clear()
  shown = { value: [], owner: '' }
  vi.spyOn(console, 'warn').mockImplementation(() => { /* checked by outcome */ })
})
afterEach(() => { vi.doUnmock('../../lib/personalDb'); vi.restoreAllMocks() })

describe('personal lists never lose a change', () => {
  it('a change made before A\'s list was read, then a switch to B, is written for A', async () => {
    const { list } = await fresh()
    const first = list.setOwner(A)
    list.save(['a-early'])
    const second = list.setOwner(B)
    await first; await second; await list.flush()
    expect(shown).toEqual({ value: [], owner: B })
    expect(await stored(A)).toEqual(['a-early'])
  })

  it('a failed read leaves changes held, and the next change reads again and writes them all', async () => {
    let fail = true
    const { list } = await fresh((real) => ({ adopt: (...args: Parameters<Db['adopt']>) => (fail ? Promise.reject(new Error('read failed')) : real.adopt(...args)) }))
    await list.setOwner(A)
    list.save(['one'])
    await list.flush()
    fail = false
    list.save(['two', 'one'])
    await list.flush()
    expect(shown.value).toEqual(['two', 'one'])
    expect(await stored(A)).toEqual(['two', 'one'])
  })

  it('a change made while the merged list is being written is not lost', async () => {
    let onWrite: (() => void) | null = null
    const { list } = await fresh((real) => ({
      writeList: async (...args: Parameters<Db['writeList']>) => { const hook = onWrite; onWrite = null; hook?.(); return real.writeList(...args) },
    }))
    const reading = list.setOwner(A)
    list.save(['first'])
    onWrite = () => list.save(['second', 'first'])
    await reading; await list.flush()
    expect(shown.value).toEqual(['second', 'first'])
    expect(await stored(A)).toEqual(['second', 'first'])
  })

  it('a reread from another tab does not draw an older list over a newer change', async () => {
    const { list } = await fresh()
    await list.setOwner(A)
    list.save(['5'])
    await list.flush()
    const again = list.reread()
    list.save(['6', '5'])
    shown = { value: ['6', '5'], owner: A }
    await again; await list.flush()
    expect(shown.value).toEqual(['6', '5'])
    expect(await stored(A)).toEqual(['6', '5'])
  })

  it('with no IndexedDB, each identity\'s list lasts in localStorage, and moves into IndexedDB when it opens', async () => {
    // C: no earlier test's page holds C, so none of them hears this one's changes (they each have their own fake database, which real tabs never do).
    const C = 'cc'.repeat(32)
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('blocked') } }
    const first = await fresh()
    await first.list.setOwner(C)
    first.list.save(['kept'])
    await first.list.flush()
    await first.list.setOwner(B)
    expect(shown.value).toEqual([])
    await first.list.setOwner(C)
    expect(shown.value).toEqual(['kept'])
    expect(mem.has(`onosendai:personal:${C}:words`)).toBe(true)

    ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
    const second = await fresh()
    await second.list.setOwner(C)
    expect(shown.value).toEqual(['kept'])
    expect(await stored(C)).toEqual(['kept'])
    expect(mem.has(`onosendai:personal:${C}:words`)).toBe(false)
  })
})
