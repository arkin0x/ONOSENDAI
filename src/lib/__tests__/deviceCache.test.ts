/**
 * deviceCache.test.ts: the lists that sat in localStorage are kept in
 * IndexedDB (arkinox, 2026-11-17: "i dont want to use local storage if we
 * can avoid it, it fills up too fast"). An older build's key is moved once:
 * written here, read back, and only then removed from localStorage; a record
 * already kept stands; and the stores read what is kept at start, newest
 * winning, without bringing back what was cleared. fake-indexeddb; no network.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}
if (typeof (globalThis as { window?: unknown }).window === 'undefined') (globalThis as { window?: unknown }).window = globalThis

const PK = 'ab'.repeat(32)
const profile = (at: number, name: string, id = 'cd'.repeat(32)) => ({ pubkey: PK, name, picture: null, about: null, nip05: null, at, id })

beforeEach(() => {
  vi.resetModules()
  mem.clear()
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
})

describe('moving off localStorage', () => {
  it('copies the old value, reads it back, then removes the old key', async () => {
    mem.set('old:key', JSON.stringify({ a: 1 }))
    const c = await import('../deviceCache')
    expect(c.takeLocal('old:key', 'k')).toEqual({ a: 1 })
    await c.lastMove
    expect(await c.readCached('k')).toEqual({ a: 1 })
    expect(mem.has('old:key')).toBe(false)
  })

  it('a record already kept stands; the old key still goes', async () => {
    const c = await import('../deviceCache')
    await c.writeCached('k', { newer: true })
    mem.set('old:key', JSON.stringify({ older: true }))
    c.takeLocal('old:key', 'k')
    await c.lastMove
    expect(await c.readCached('k')).toEqual({ newer: true })
    expect(mem.has('old:key')).toBe(false)
  })

  it('without IndexedDB the old key is left where it is', async () => {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = undefined
    mem.set('old:key', JSON.stringify([1, 2]))
    const c = await import('../deviceCache')
    expect(c.takeLocal('old:key', 'k')).toEqual([1, 2])
    await c.lastMove
    expect(mem.get('old:key')).toBe('[1,2]')
  })

  it('a write that fails leaves the old key for next time', async () => {
    mem.set('old:key', JSON.stringify([1]))
    // A database that will not open: private mode, a blocked upgrade, a full disk.
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('blocked') } }
    const c = await import('../deviceCache')
    c.takeLocal('old:key', 'k')
    await c.lastMove
    expect(mem.has('old:key')).toBe(true)
  })
})

describe('the profiles', () => {
  it('an older build\'s profiles move over and are on the first frame', async () => {
    mem.set('onosendai:profiles', JSON.stringify({ [PK]: profile(900, 'kept') }))
    const { useProfiles, PROFILES_CACHE_KEY } = await import('../../store/useProfiles')
    expect(useProfiles.getState().profiles[PK]?.name).toBe('kept')
    const c = await import('../deviceCache')
    await c.lastMove
    expect(mem.has('onosendai:profiles')).toBe(false)
    expect((await c.readCached(PROFILES_CACHE_KEY) as Record<string, { name: string }>)[PK].name).toBe('kept')
  })

  it('kept profiles are read in at start; a newer one in hand is never replaced by an older kept one', async () => {
    const c = await import('../deviceCache')
    await c.writeCached('profiles', { [PK]: profile(900, 'kept'), ['ef'.repeat(32)]: { ...profile(800, 'other'), pubkey: 'ef'.repeat(32) } })
    vi.resetModules()
    const { useProfiles, profilesHydrated } = await import('../../store/useProfiles')
    useProfiles.setState({ profiles: { [PK]: profile(1000, 'fresh', 'ee'.repeat(32)) } })
    await profilesHydrated
    expect(useProfiles.getState().profiles[PK]?.name).toBe('fresh')
    expect(useProfiles.getState().profiles['ef'.repeat(32)]?.name).toBe('other')
  })

  it('nothing is written to localStorage', async () => {
    vi.useFakeTimers()
    const { useProfiles } = await import('../../store/useProfiles')
    useProfiles.getState().remember({ kind: 0, pubkey: PK, created_at: 1000, id: 'ee'.repeat(32), tags: [], content: JSON.stringify({ name: 'n' }), sig: '' } as never)
    vi.advanceTimersByTime(5000)
    vi.useRealTimers()
    expect(mem.has('onosendai:profiles')).toBe(false)
  })
})

describe('the chat lines', () => {
  const line = (id: string, at: number) => ({ id, from: 'f'.repeat(64), text: id, at, region: 'r', height: 12, mine: false })

  it('kept lines are read in under the ones already here, in time order, with no unread', async () => {
    const c = await import('../deviceCache')
    await c.writeCached('chat', [line('a', 10), line('b', 20)])
    vi.resetModules()
    const { useChat, chatHydrated } = await import('../../store/useChat')
    useChat.setState({ lines: [line('c', 30)] })
    await chatHydrated
    expect(useChat.getState().lines.map((l) => l.id)).toEqual(['a', 'b', 'c'])
    expect(useChat.getState().unread).toBe(0)
  })

  it('a CLEAR before they are read keeps them cleared', async () => {
    const c = await import('../deviceCache')
    await c.writeCached('chat', [line('a', 10)])
    vi.resetModules()
    const { useChat, chatHydrated } = await import('../../store/useChat')
    useChat.getState().clear()
    await chatHydrated
    expect(useChat.getState().lines).toEqual([])
  })
})
