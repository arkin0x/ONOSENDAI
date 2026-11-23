/**
 * personalLists.test.ts: the lists that are one identity's own (owner ruling,
 * 2026-11-19), through the real identity store: starred places, the View
 * panel's recent places and TARGET follow whoever is signed in. A new
 * identity starts with none of the old one's; switching back finds them
 * again; the lists builds before kept once per device go to the identity
 * signed in when they are first read and stay in localStorage untouched; a
 * full localStorage changes nothing, since nothing here writes it.
 */

import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
let full = false
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { if (full) throw new Error('QuotaExceededError'); mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}

const A = 'aa'.repeat(32)
const B = 'bb'.repeat(32)
const FRIEND = 'cc'.repeat(32)
const OLD_STARS = JSON.stringify([{ input: '1, 2, 3', label: 'home', plane: 0, at: 1 }])
const OLD_RECENT = JSON.stringify([{ input: '4, 5, 6', label: 'the mill', plane: 0 }])
const OLD_TARGETS = JSON.stringify([{ pubkey: FRIEND, name: 'friend' }])
mem.set('onosendai:starred-places', OLD_STARS)
mem.set('onosendai:view-recent', OLD_RECENT)
mem.set('onosendai:targets', OLD_TARGETS)

const { useCyberspace } = await import('../useCyberspace')
const { useStarred, starredList } = await import('../useStarred')
const { recentViewsList } = await import('../recentViewsList')
const { readRecentViews, addRecentView } = await import('../../lib/viewAt')
const { personalListsMade } = await import('../personalLists')
const { startPersonalLists } = await import('../personalStart')

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) for (const l of personalListsMade()) await l.flush()
}
const signIn = async (pubkey: string): Promise<void> => {
  useCyberspace.setState({ identity: { pubkey, npub: '' } })
  await settle()
}
const stars = (): string[] => useStarred.getState().places.map((p) => p.label)
const recents = (): string[] => readRecentViews().map((r) => r.label)
const targets = (): string[] => Object.keys(useCyberspace.getState().targets)

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => { /* storage warnings are expected here */ })
  useCyberspace.setState({ identity: { pubkey: A, npub: '' } })
  startPersonalLists()
  await settle()
})
afterAll(() => { vi.restoreAllMocks() })

describe('personal lists follow the identity', () => {
  it('the identity signed in when the new build first runs adopts the device-wide lists', () => {
    expect(stars()).toEqual(['home'])
    expect(recents()).toEqual(['the mill'])
    expect(targets()).toEqual([FRIEND])
  })

  it('a new identity starts with none of them, and its own changes stay its own', async () => {
    await signIn(B)
    expect(stars()).toEqual([])
    expect(recents()).toEqual([])
    expect(targets()).toEqual([])
    useStarred.getState().add({ position: { x: 9n, y: 9n, z: 9n }, input: '9, 9, 9', label: 'b-star', plane: 0 })
    addRecentView({ input: '8, 8, 8', label: 'b-recent', plane: 0 })
    useCyberspace.getState().addTarget('dd'.repeat(32), 'b-target')
    await settle()
  })

  it('switching back finds the first identity\'s lists as they were', async () => {
    await signIn(A)
    expect(stars()).toEqual(['home'])
    expect(recents()).toEqual(['the mill'])
    expect(targets()).toEqual([FRIEND])
    await signIn(B)
    expect(stars()).toEqual(['b-star'])
    expect(recents()).toEqual(['b-recent'])
    expect(targets()).toEqual(['dd'.repeat(32)])
  })

  it('leaves the old localStorage lists exactly as they were', () => {
    expect(mem.get('onosendai:starred-places')).toBe(OLD_STARS)
    expect(mem.get('onosendai:view-recent')).toBe(OLD_RECENT)
    expect(mem.get('onosendai:targets')).toBe(OLD_TARGETS)
  })

  it('keeps working with localStorage full: nothing here writes it', async () => {
    full = true
    try {
      await signIn(A)
      useStarred.getState().add({ position: { x: 7n, y: 7n, z: 7n }, input: '7, 7, 7', label: 'while full', plane: 0 })
      await settle()
      await signIn(B)
      await signIn(A)
      expect(stars()).toEqual(['while full', 'home'])
    } finally { full = false }
  })

  it('every list registered follows the starter', () => {
    const names = [...personalListsMade()].map((l) => l.name).sort()
    expect(names).toEqual(['starred-places', 'targets', 'view-recent'])
    expect(starredList.owner()).toBe(A)
    expect(recentViewsList.owner()).toBe(A)
  })
})
