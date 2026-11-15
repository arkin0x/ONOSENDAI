/**
 * deployHintPrefs.test.ts - the deploy bar's three hint switches kept on this
 * device (arkinox, 2026-11-15): all ON for a player who never touched them,
 * then what they set, read back after a reload; a broken saved value reads as
 * the defaults. The store side is in deployHints.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  relaySet: () => ['wss://relay.test'],
}))

import { DEFAULT_HINT_PREFS, HINT_PREFS_KEY, hintPrefsOf, loadHintPrefs, saveHintPrefs, withHintPrefs } from '../deployHintPrefs'
import { DEFAULT_BAG_SETTINGS } from '../../lib/hidden'
import { SECTOR_HINT } from '../../lib/hint'

beforeEach(() => localStorage.clear())

describe('the saved switches', () => {
  it('a fresh device: all three on', () => {
    expect(loadHintPrefs()).toEqual({ height: true, sector: true, contents: true })
    expect(DEFAULT_HINT_PREFS).toEqual({ height: true, sector: true, contents: true })
  })

  it('a change is saved and read back; the others keep theirs', () => {
    saveHintPrefs({ sector: false })
    expect(loadHintPrefs()).toEqual({ height: true, sector: false, contents: true })
    saveHintPrefs({ height: false })
    expect(loadHintPrefs()).toEqual({ height: false, sector: false, contents: true })
  })

  it('a broken or partial saved value reads as the defaults where it is broken', () => {
    localStorage.setItem(HINT_PREFS_KEY, '{nope')
    expect(loadHintPrefs()).toEqual(DEFAULT_HINT_PREFS)
    localStorage.setItem(HINT_PREFS_KEY, JSON.stringify({ height: false, sector: 'yes' }))
    expect(loadHintPrefs()).toEqual({ height: false, sector: true, contents: true })
  })

  it('only the three switches count as a change', () => {
    expect(hintPrefsOf({ riddle: 'x', money: true })).toEqual({})
    expect(hintPrefsOf({ hint: null, heightTag: true, contents: false })).toEqual({ sector: false, height: true, contents: false })
  })

  it('applied to a bag: ON keeps a finer box another client wrote, OFF takes it off; the riddle stays the bag\'s', () => {
    const box: [number, number, number] = [20, 20, 20]
    const bag = { ...DEFAULT_BAG_SETTINGS, hint: box, riddle: 'theirs' }
    expect(withHintPrefs(bag, 6, DEFAULT_HINT_PREFS)).toEqual({ bag: { ...bag, contents: true }, held: false })
    expect(withHintPrefs(bag, 6, { height: false, sector: false, contents: false }).bag).toEqual({ ...bag, heightTag: false, hint: null, contents: false })
    // Above 30 the sector is too small: off, and held to come back on.
    expect(withHintPrefs(DEFAULT_BAG_SETTINGS, 35, DEFAULT_HINT_PREFS)).toEqual({ bag: { ...DEFAULT_BAG_SETTINGS, contents: true }, held: true })
    expect(withHintPrefs(DEFAULT_BAG_SETTINGS, 6, DEFAULT_HINT_PREFS).bag.hint).toEqual(SECTOR_HINT)
  })
})

describe('across a reload', () => {
  it('a fresh store starts the deploy bar from the saved switches', async () => {
    const before = (await import('../useShards')).useShards
    before.getState().startDeployMessage('x')
    before.getState().setDeployBag({ heightTag: false, contents: false })
    expect(JSON.parse(localStorage.getItem(HINT_PREFS_KEY)!)).toEqual({ height: false, sector: true, contents: false })
    vi.resetModules()
    const after = (await import('../useShards')).useShards
    expect(after).not.toBe(before)
    after.getState().startDeployMessage('after reload')
    expect(after.getState().deployBag).toMatchObject({ heightTag: false, hint: SECTOR_HINT, contents: false })
  })
})
