/**
 * crewPanel.test.tsx - TERRAIN's Crew in the bag (terrain/CrewPanel.tsx;
 * owner, 2026-11-25: "the layout is awful ... get rid of the control hints
 * on the inventory bag modal").
 *
 * - The bag lists no keys any more.
 * - Both lists, one row per person: MUTUAL for someone in both, ADD BACK for
 *   someone who lets you build on theirs but is not in yours, and friendly
 *   words when a list is empty.
 * - Taking someone off is never one tap: the row's button opens a confirm
 *   that says what happens, KEEP leaves them in, TAKE OFF takes them off.
 * - The picker: what was typed finds people you follow by name or npub, a
 *   pasted npub stands on its own, and you are never offered.
 * - Esc closes the picker or the confirm before the bag.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
    key: () => null,
    get length() { return mem.size },
  }
}

const calls = vi.hoisted(() => ({ added: [] as string[], removed: [] as string[] }))
vi.mock('../../store/terrainShare', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../store/terrainShare')>()
  return {
    ...real,
    addCrew: vi.fn(async (pk: string) => { calls.added.push(pk); real.useShare.setState({ crew: [...real.useShare.getState().crew, pk] }); return true }),
    removeCrew: vi.fn(async (pk: string) => { calls.removed.push(pk); real.useShare.setState({ crew: real.useShare.getState().crew.filter((p) => p !== pk) }); return true }),
  }
})
vi.mock('../../lib/contacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/contacts')>()),
  followsOf: vi.fn(async () => []),
}))

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { nip19 } from 'nostr-tools'
import { mount, textOf } from '../../test/elementRoot'
import { useShare } from '../../store/terrainShare'
import type { Profile } from '../../store/useProfiles'
import { CREW_REMOVE_WHAT, CrewLayer, CrewPanel, PICKER_SHOWN, closeCrewLayer, crewInput, crewLabel, pickerMatches, useCrewLayer } from '../CrewPanel'

const A = 'a1'.repeat(32)
const B = 'b2'.repeat(32)
const C = 'c3'.repeat(32)
const ME = 'ee'.repeat(32)
const profile = (pubkey: string, name: string): Profile => ({ pubkey, name, picture: null, about: null, nip05: null, at: 1 })

beforeEach(() => {
  calls.added.length = 0
  calls.removed.length = 0
  useShare.setState({ crew: [], crewOf: [] })
  useCrewLayer.setState({ open: null })
})
afterEach(() => { useCrewLayer.setState({ open: null }) })

describe('the bag', () => {
  it('lists no keys: each is printed on its own button', () => {
    const view = readFileSync(resolve(__dirname, '../TerrainView.tsx'), 'utf8')
    const sheet = view.slice(view.indexOf('function InventorySheet'), view.indexOf('/** The status line'))
    expect(sheet).not.toMatch(/terrain-sheet__keys|<dl\b|W A S D|SPACE|RIGHT CLICK/)
    expect(sheet).toMatch(/<CrewPanel \/>/)
    expect(sheet).toMatch(/<CrewLayer \/>/)
    expect(readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')).not.toMatch(/terrain-sheet__keys/)
  })

  it('closes the picker or the confirm on Esc before the bag', () => {
    const view = readFileSync(resolve(__dirname, '../TerrainView.tsx'), 'utf8')
    expect(view).toMatch(/if \(st\.sheet\) \{ take\(\); if \(!closeCrewLayer\(\)\) st\.setSheet\(false\) \}/)
    expect(closeCrewLayer()).toBe(false)
    useCrewLayer.setState({ open: { kind: 'add' } })
    expect(closeCrewLayer()).toBe(true)
    expect(useCrewLayer.getState().open).toBeNull()
  })
})

describe('the two lists', () => {
  it('says how to begin when both are empty', async () => {
    const m = await mount(createElement(CrewPanel))
    expect(m.says('YOUR CREW')).toBe(true)
    expect(m.says('CREWS YOU’RE IN')).toBe(true)
    expect(m.says('Nobody yet.')).toBe(true)
    expect(m.says('ADD TO CREW on their player card')).toBe(true)
    expect(m.says('Nobody has added you yet.')).toBe(true)
    expect(m.buttons('ADD TO YOUR CREW')).toHaveLength(1)
    await m.unmount()
  })

  it('marks MUTUAL in both, offers ADD BACK to someone not in yours, and no one-tap remove', async () => {
    useShare.setState({ crew: [A, B], crewOf: [B, C] })
    const m = await mount(createElement(CrewPanel))
    const rows = m.all().filter((h) => h.type === 'li')
    expect(rows).toHaveLength(4)
    // A: yours only; B: both ways (twice: once per list); C: lets you build on theirs.
    expect(rows.filter((r) => textOf(r).includes('MUTUAL'))).toHaveLength(2)
    expect(m.buttons('ADD BACK')).toHaveLength(1)
    // Each of yours has one button, and it only opens the confirm.
    const offs = m.all().filter((h) => h.type === 'button' && h.props['aria-label'] === 'Take off your crew…')
    expect(offs).toHaveLength(2)
    ;(offs[0].props.onClick as () => void)()
    expect(calls.removed).toEqual([])
    expect(useCrewLayer.getState().open).toEqual({ kind: 'remove', pubkey: A })
    await m.press('ADD BACK')
    expect(calls.added).toEqual([C])
    await m.unmount()
  })
})

describe('taking someone off', () => {
  it('asks first, says what happens, and KEEP leaves them in', async () => {
    useShare.setState({ crew: [A], crewOf: [] })
    useCrewLayer.setState({ open: { kind: 'remove', pubkey: A } })
    const m = await mount(createElement(CrewLayer))
    expect(m.says(CREW_REMOVE_WHAT)).toBe(true)
    expect(m.all().some((h) => h.type === 'button' && String(h.props.className).includes('modal-close'))).toBe(true)
    await m.press('KEEP')
    expect(calls.removed).toEqual([])
    expect(useShare.getState().crew).toEqual([A])
    expect(useCrewLayer.getState().open).toBeNull()
    await m.unmount()
  })

  it('TAKE OFF takes them off and closes', async () => {
    useShare.setState({ crew: [A], crewOf: [] })
    useCrewLayer.setState({ open: { kind: 'remove', pubkey: A } })
    const m = await mount(createElement(CrewLayer))
    await m.press('TAKE OFF')
    expect(calls.removed).toEqual([A])
    expect(useCrewLayer.getState().open).toBeNull()
    await m.unmount()
  })
})

describe('the picker', () => {
  const profiles = { [A]: profile(A, 'Alice'), [B]: profile(B, 'Bob'), [C]: null }

  it('lists the people you follow, never you, at most PICKER_SHOWN', () => {
    expect(pickerMatches('', [A, ME, B, C], profiles, ME)).toEqual({ direct: null, list: [A, B, C] })
    const many = Array.from({ length: PICKER_SHOWN + 10 }, (_, i) => i.toString(16).padStart(64, '0'))
    expect(pickerMatches('', many, {}, ME).list).toHaveLength(PICKER_SHOWN)
  })

  it('finds by name, whatever the case, and by npub', () => {
    expect(pickerMatches('ali', [A, B, C], profiles, ME).list).toEqual([A])
    expect(pickerMatches('BO', [A, B, C], profiles, ME).list).toEqual([B])
    const npubC = nip19.npubEncode(C)
    expect(pickerMatches(npubC.slice(0, 16), [A, B, C], profiles, ME).list).toEqual([C])
    expect(pickerMatches('zed', [A, B, C], profiles, ME).list).toEqual([])
  })

  it('takes a pasted npub or hex on its own, but never yours', () => {
    expect(pickerMatches(nip19.npubEncode(C), [A], profiles, ME)).toEqual({ direct: C, list: [] })
    expect(pickerMatches(`  ${C}  `, [A], profiles, ME)).toEqual({ direct: C, list: [] })
    expect(pickerMatches(nip19.npubEncode(ME), [A], profiles, ME)).toEqual({ direct: null, list: [] })
    expect(crewInput('npub1nope')).toBeNull()
  })

  it('names a person by their profile, else a short npub', () => {
    expect(crewLabel(A, profiles[A])).toBe('Alice')
    const short = crewLabel(C, null)
    expect(short.startsWith('npub1')).toBe(true)
    expect(short).toContain('…')
    expect(short.length).toBeLessThan(20)
  })

  it('opens with the shared ✕ and a search box, and says so when you follow nobody', async () => {
    useCrewLayer.setState({ open: { kind: 'add' } })
    const m = await mount(createElement(CrewLayer))
    expect(m.all().some((h) => h.type === 'input' && h.props['aria-label'] === 'Search by name, or paste an npub')).toBe(true)
    expect(m.all().filter((h) => h.type === 'button' && String(h.props.className).includes('modal-close'))).toHaveLength(1)
    expect(m.says('You don’t follow anyone yet.')).toBe(true)
    await m.unmount()
  })
})

describe('the copy', () => {
  it('has no em dashes', () => {
    const src = readFileSync(resolve(__dirname, '../CrewPanel.tsx'), 'utf8')
    expect(src).not.toContain('—')
  })
})
