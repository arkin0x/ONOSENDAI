/**
 * starred.test.ts: the Starred Places list (lib/starred.ts, useStarred.ts).
 *
 * A page load is a fresh copy of the store module over the same IndexedDB
 * and localStorage, signed in as an identity (starredList.setOwner), so
 * persistence is checked by loading the module again. The list is each
 * identity's own (owner ruling, 2026-11-19); the list builds before kept in
 * localStorage once per device goes to the identity signed in when it is
 * first read, and is left where it was.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_STARRED, NICKNAME_MAX, STARRED_KEY, addPlace, placeName, removePlace, type StarSpot, type StarredPlace } from '../../lib/starred'

const mem = new Map<string, string>()
const working = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}
const broken = {
  getItem: () => { throw new Error('SecurityError: storage is disabled') },
  setItem: () => { throw new Error('QuotaExceededError') },
  removeItem: () => { throw new Error('SecurityError') },
  clear: () => { throw new Error('SecurityError') },
}
const g = globalThis as { localStorage?: unknown }

const ME = 'ee'.repeat(32)
const OTHER = 'dd'.repeat(32)

type Mod = typeof import('../useStarred')
let current: Mod | null = null
/** A page load signed in as `owner`: what the last one wrote is on disk first. */
async function load(owner = ME): Promise<Mod['useStarred']> {
  await current?.starredList.flush()
  vi.resetModules()
  current = await import('../useStarred')
  await current.starredList.setOwner(owner)
  return current.useStarred
}

const spot = (x: bigint, plane: 0 | 1 = 0, label = `${x}, 2, 3`): StarSpot => ({
  position: { x, y: 2n, z: 3n }, plane, label, input: `${x}, 2, 3`,
})

describe('Starred Places', () => {
  beforeEach(() => {
    mem.clear(); g.localStorage = working; current = null
    ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
    vi.spyOn(console, 'warn').mockImplementation(() => { /* the tests check what happened */ })
  })
  afterEach(() => { g.localStorage = working; vi.restoreAllMocks() })

  it('adds a place at the top with when it was starred and the zoom', async () => {
    const S = await load()
    S.getState().add(spot(1n), 40)
    S.getState().add(spot(2n))
    const [top, next] = S.getState().places
    expect(top.input).toBe('2, 2, 3')
    expect(next).toMatchObject({ input: '1, 2, 3', plane: 0, label: '1, 2, 3', scaleExp: 40 })
    expect(typeof next.at).toBe('number')
  })

  it('keeps one entry per place: starring it again moves it to the top', async () => {
    const S = await load()
    S.getState().add(spot(1n))
    S.getState().add(spot(2n))
    S.getState().add(spot(1n, 0, 'RENAMED'))
    expect(S.getState().places.map((p) => p.input)).toEqual(['1, 2, 3', '2, 2, 3'])
    expect(S.getState().places[0].label).toBe('RENAMED')
  })

  it('treats the same axes in the other plane as a different place', async () => {
    const S = await load()
    S.getState().add(spot(1n, 0))
    S.getState().add(spot(1n, 1))
    expect(S.getState().places).toHaveLength(2)
  })

  it('removes by text and plane, leaving the rest', async () => {
    const S = await load()
    S.getState().add(spot(1n, 0))
    S.getState().add(spot(1n, 1))
    S.getState().remove({ input: '1, 2, 3', plane: 0 })
    expect(S.getState().places.map((p) => p.plane)).toEqual([1])
  })

  it('toggles: a starred place is removed, an unstarred one added', async () => {
    const S = await load()
    expect(S.getState().toggle(spot(5n))).toBe('added')
    expect(S.getState().places).toHaveLength(1)
    expect(S.getState().toggle(spot(5n))).toBe('removed')
    expect(S.getState().places).toHaveLength(0)
  })

  it('persists across a reload, under the identity signed in, and never writes the old device-wide key', async () => {
    const S = await load()
    S.getState().add(spot(7n), 33)
    const again = await load()
    expect(again.getState().places).toMatchObject([{ input: '7, 2, 3', plane: 0, scaleExp: 33 }])
    expect(mem.has(STARRED_KEY)).toBe(false)
    again.getState().remove({ input: '7, 2, 3', plane: 0 })
    expect((await load()).getState().places).toEqual([])
  })

  it('a new identity starts with none, and each finds its own again (the switch the owner asked for)', async () => {
    const S = await load(ME)
    S.getState().add(spot(1n))
    await current!.starredList.setOwner(OTHER)
    expect(S.getState().places).toEqual([])
    S.getState().add(spot(2n))
    await current!.starredList.setOwner(ME)
    expect(S.getState().places.map((p) => p.input)).toEqual(['1, 2, 3'])
    expect((await load(OTHER)).getState().places.map((p) => p.input)).toEqual(['2, 2, 3'])
  })

  it('a star made while a switch is still reading is kept for the identity it was made for', async () => {
    const S = await load(ME)
    S.getState().add(spot(1n))
    const switching = current!.starredList.setOwner(OTHER)
    S.getState().add(spot(3n))
    await switching
    expect(S.getState().places.map((p) => p.input)).toEqual(['3, 2, 3'])
    expect((await load(ME)).getState().places.map((p) => p.input)).toEqual(['1, 2, 3'])
    expect((await load(OTHER)).getState().places.map((p) => p.input)).toEqual(['3, 2, 3'])
  })

  it('the list kept once per device goes to the identity signed in when first read, once, and stays in localStorage', async () => {
    const old = JSON.stringify([{ input: '1, 2, 3', label: 'home', plane: 0, at: 1 }])
    mem.set(STARRED_KEY, old)
    expect((await load(ME)).getState().places.map((p) => p.label)).toEqual(['home'])
    expect((await load(OTHER)).getState().places).toEqual([])
    expect((await load(ME)).getState().places.map((p) => p.label)).toEqual(['home'])
    expect(mem.get(STARRED_KEY)).toBe(old)
  })

  it('a move interrupted before the database took it is made again on the next load, from the untouched original', async () => {
    mem.set(STARRED_KEY, JSON.stringify([{ input: '1, 2, 3', label: 'home', plane: 0, at: 1 }]))
    const db = await import('../../lib/personalDb')
    vi.resetModules()
    vi.doMock('../../lib/personalDb', async () => ({ ...db, adopt: () => Promise.reject(new Error('AbortError: the page closed')) }))
    const failed = await import('../useStarred')
    await failed.starredList.setOwner(ME)
    vi.doUnmock('../../lib/personalDb')
    current = null
    expect((await load(ME)).getState().places.map((p) => p.label)).toEqual(['home'])
  })

  it('drops malformed rows and unreadable JSON instead of failing', async () => {
    mem.set(STARRED_KEY, JSON.stringify([{ input: '1, 2, 3', label: 'ok', plane: 0, at: 1 }, { input: 5 }, null, { input: 'x', label: 'y', plane: 3, at: 1 }]))
    expect((await load()).getState().places.map((p) => p.label)).toEqual(['ok'])
    ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
    current = null
    mem.set(STARRED_KEY, '{not json')
    expect((await load()).getState().places).toEqual([])
  })

  it('works for the visit when storage cannot be read or written', async () => {
    g.localStorage = broken
    const S = await load()
    expect(S.getState().places).toEqual([])
    expect(() => S.getState().add(spot(9n))).not.toThrow()
    expect(S.getState().places).toHaveLength(1)
    expect(() => S.getState().remove({ input: '9, 2, 3', plane: 0 })).not.toThrow()
    expect(S.getState().places).toHaveLength(0)
  })

  it('works when there is no storage at all', async () => {
    g.localStorage = undefined
    const S = await load()
    expect(() => S.getState().add(spot(9n))).not.toThrow()
    expect(S.getState().places).toHaveLength(1)
  })

  it('renames a place: trimmed, spaces folded, capped, persisted; empty takes the nickname away', async () => {
    const S = await load()
    S.getState().add(spot(4n))
    S.getState().rename({ input: '4, 2, 3', plane: 0 }, '   the   old\n mill  ')
    expect(S.getState().places[0].nickname).toBe('the old mill')
    expect(placeName(S.getState().places[0])).toBe('the old mill')
    expect((await load()).getState().places[0].nickname).toBe('the old mill')
    const S2 = await load()
    S2.getState().rename({ input: '4, 2, 3', plane: 0 }, 'x'.repeat(NICKNAME_MAX + 20))
    expect(S2.getState().places[0].nickname).toHaveLength(NICKNAME_MAX)
    S2.getState().rename({ input: '4, 2, 3', plane: 0 }, '   ')
    expect(S2.getState().places[0].nickname).toBeUndefined()
    expect(placeName(S2.getState().places[0])).toBe('4, 2, 3')
  })

  it('drops a stored nickname that is not text', async () => {
    mem.set(STARRED_KEY, JSON.stringify([{ input: '1, 2, 3', label: 'a', plane: 0, at: 1, nickname: 5 }, { input: '2, 2, 3', label: 'b', plane: 0, at: 1, nickname: 'home' }]))
    expect((await load()).getState().places.map((p) => p.nickname)).toEqual(['home'])
  })

  it('says "Added" only when the nickname field closes, under the nickname when one was saved', async () => {
    const S = await load()
    const { useToast } = await import('../useToast')
    useToast.getState().dismiss()
    S.getState().add(spot(6n))
    S.getState().beginNaming({ input: '6, 2, 3', plane: 0 })
    expect(S.getState().naming).toEqual({ input: '6, 2, 3', plane: 0 })
    expect(useToast.getState().toast).toBeNull()
    S.getState().finishNaming('  Rooftop ')
    expect(S.getState().naming).toBeNull()
    expect(S.getState().places[0].nickname).toBe('Rooftop')
    expect(useToast.getState().toast).toMatchObject({ label: 'Added to your Starred Places in the View panel', meta: 'Rooftop', mark: 'star' })
  })

  it('keeps the place starred under its own label when the nickname is skipped', async () => {
    const S = await load()
    const { useToast } = await import('../useToast')
    S.getState().add(spot(8n, 0, 'PARIS'))
    S.getState().beginNaming({ input: '8, 2, 3', plane: 0 })
    S.getState().finishNaming(null)
    expect(S.getState().places).toHaveLength(1)
    expect(S.getState().places[0].nickname).toBeUndefined()
    expect(useToast.getState().toast).toMatchObject({ meta: 'PARIS' })
    // A second close does nothing: the field is already gone.
    useToast.getState().dismiss()
    S.getState().finishNaming('late')
    expect(useToast.getState().toast).toBeNull()
    expect(S.getState().places[0].nickname).toBeUndefined()
  })

  it('closes the field and the card of a place that is removed', async () => {
    const S = await load()
    S.getState().add(spot(3n))
    S.getState().beginNaming({ input: '3, 2, 3', plane: 0 })
    S.getState().select({ input: '3, 2, 3', plane: 0 })
    S.getState().remove({ input: '3, 2, 3', plane: 0 })
    expect(S.getState().naming).toBeNull()
    expect(S.getState().selected).toBeNull()
  })

  it('keeps at most MAX_STARRED, dropping the oldest', () => {
    let list: StarredPlace[] = []
    for (let i = 0; i < MAX_STARRED + 5; i++) list = addPlace(list, { input: `${i}, 0, 0`, label: `${i}`, plane: 0, at: i })
    expect(list).toHaveLength(MAX_STARRED)
    expect(list[0].input).toBe(`${MAX_STARRED + 4}, 0, 0`)
    expect(removePlace(list, { input: '4, 0, 0', plane: 0 })).toHaveLength(MAX_STARRED)
  })
})
