/**
 * modeOrder.test.ts - the MODES list (store/modeOrder.ts; owner, 2026-11-24):
 * what an order makes of the pad (start, second button, ring), moving a
 * mode, switching one off and the guards on that, a list from another
 * version merged against this one's modes, and the list kept per identity
 * in the kv store (IndexedDB, localStorage before it hydrates).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})
vi.mock('../../lib/relay', async (orig) => ({ ...(await orig() as object), publish: vi.fn(async () => ({ ok: true, accepted: [] })), publishMany: vi.fn(async () => ({ ok: true, accepted: [] })), query: vi.fn(async () => []) }))

import { useCyberspace } from '../useCyberspace'
import { useTutorial } from '../useTutorial'
import { useTv } from '../useTv'
import { useDemo } from '../useDemo'
import { kvGet, movesToKv } from '../../lib/kvStore'
import { setHudChoice, useNewcomer } from '../../newcomer/useNewcomer'
import {
  TEACHING_MODES, canSwitchOff, customModesApply, DEFAULT_MODE_ORDER, DEFAULT_MODES, effectiveModes, MODES, MODES_PREFIX, mergeModes, modeRoles,
  moveModeBy, moveModeTo, nextInRing, readModes, resetModes, rolesOf, setModeOn, storedModes, updateModes, useModes,
  type ModeId, type ModeSettings,
} from '../modeOrder'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const as = (pubkey: string): void => useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey } })

beforeEach(() => {
  localStorage.clear()
  useModes.setState({ pubkey: null, saved: null, back: null, lastRing: null })
  useTutorial.setState({ active: false })
  useTv.setState({ on: false })
  useDemo.setState({ active: false })
  useNewcomer.setState({ record: { seen: [] } })
  as(A)
})

describe('the default list is today\'s pad, with TERRAIN after WALK', () => {
  it('HOP, WALK, TERRAIN, VIEW, BUILD, SCAN, all on: start in HOP, WALK the second button, the ring HOP, TERRAIN, VIEW, BUILD, SCAN', () => {
    expect(DEFAULT_MODE_ORDER).toEqual(['hop', 'walk', 'terrain', 'view', 'build', 'scan'])
    expect(MODES.map((m) => m.id)).toEqual(DEFAULT_MODE_ORDER)
    expect(rolesOf(DEFAULT_MODES)).toEqual({ start: 'hop', second: 'walk', ring: ['hop', 'terrain', 'view', 'build', 'scan'] })
    expect(storedModes()).toEqual(DEFAULT_MODES)
    expect(modeRoles()).toEqual(rolesOf(DEFAULT_MODES))
  })

  it('the ring goes round in order, back to the first', () => {
    expect(nextInRing(DEFAULT_MODES, 'hop')).toBe('terrain')
    expect(nextInRing(DEFAULT_MODES, 'terrain')).toBe('view')
    expect(nextInRing(DEFAULT_MODES, 'view')).toBe('build')
    expect(nextInRing(DEFAULT_MODES, 'build')).toBe('scan')
    expect(nextInRing(DEFAULT_MODES, 'scan')).toBe('hop')
  })
})

describe('reordering', () => {
  it('the owner\'s example: WALK first and BUILD second', () => {
    let s: ModeSettings = DEFAULT_MODES
    s = moveModeTo(s, 'walk', 0)
    s = moveModeTo(s, 'build', 1)
    expect(s.order).toEqual(['walk', 'build', 'hop', 'terrain', 'view', 'scan'])
    expect(rolesOf(s)).toEqual({ start: 'walk', second: 'build', ring: ['walk', 'hop', 'terrain', 'view', 'scan'] })
    expect(nextInRing(s, 'scan')).toBe('walk')
  })

  it('up and down a place at a time, clamped at the ends, the same list back when nothing moves', () => {
    const s = moveModeBy(DEFAULT_MODES, 'scan', -1)
    expect(s.order).toEqual(['hop', 'walk', 'terrain', 'view', 'scan', 'build'])
    expect(moveModeBy(DEFAULT_MODES, 'hop', -1)).toBe(DEFAULT_MODES)
    expect(moveModeBy(DEFAULT_MODES, 'scan', 1)).toBe(DEFAULT_MODES)
    expect(moveModeTo(DEFAULT_MODES, 'walk', 99).order).toEqual(['hop', 'terrain', 'view', 'build', 'scan', 'walk'])
  })
})

describe('switching modes off', () => {
  it('an off mode leaves the ring and the second button, and stays in the list', () => {
    const s = setModeOn(DEFAULT_MODES, 'view', false)
    expect(s.order).toEqual(DEFAULT_MODE_ORDER)
    expect(rolesOf(s).ring).toEqual(['hop', 'terrain', 'build', 'scan'])
    expect(nextInRing(s, 'terrain')).toBe('build')
  })

  it('the second button off: the next mode on is the second button', () => {
    const s = setModeOn(DEFAULT_MODES, 'walk', false)
    expect(rolesOf(s)).toEqual({ start: 'hop', second: 'terrain', ring: ['hop', 'view', 'build', 'scan'] })
  })

  it('only one mode on: no second button, and the ring is that mode', () => {
    let s: ModeSettings = DEFAULT_MODES
    for (const id of ['walk', 'terrain', 'view', 'build', 'scan'] as const) s = setModeOn(s, id, false)
    expect(rolesOf(s)).toEqual({ start: 'hop', second: null, ring: ['hop'] })
    expect(nextInRing(s, 'hop')).toBe('hop')
  })

  it('the first mode cannot be switched off, so one is always on', () => {
    expect(canSwitchOff(DEFAULT_MODES, 'hop')).toBe(false)
    expect(setModeOn(DEFAULT_MODES, 'hop', false)).toBe(DEFAULT_MODES)
    let s: ModeSettings = DEFAULT_MODES
    for (const id of DEFAULT_MODE_ORDER) s = setModeOn(s, id, false)
    expect(s.off).not.toContain('hop')
    expect(rolesOf(s).ring).toEqual(['hop'])
  })

  it('an off mode moved to the top is switched on', () => {
    const s = moveModeTo(setModeOn(DEFAULT_MODES, 'build', false), 'build', 0)
    expect(s.order[0]).toBe('build')
    expect(s.off).toEqual([])
  })

  it('from a mode off the ring, the ring goes on from its place in the list', () => {
    const s = setModeOn(DEFAULT_MODES, 'build', false)
    expect(nextInRing(s, 'build')).toBe('scan')
    expect(nextInRing(setModeOn(s, 'scan', false), 'build')).toBe('hop')
  })
})

describe('a list from another version', () => {
  it('a mode added since joins at its default place; one this version lacks is dropped', () => {
    // Saved before SCAN existed, with WALK first; and a mode from a later version.
    const s = mergeModes({ order: ['walk', 'hop', 'view', 'teleport', 'build'], off: ['view', 'teleport'] })
    expect(s.order).toEqual(['walk', 'terrain', 'hop', 'view', 'build', 'scan'])
    expect(s.off).toEqual(['view'])
  })

  it('a missing mode with nothing above it in the default list goes to the top; duplicates keep the first', () => {
    expect(mergeModes({ order: ['view', 'walk', 'view', 'scan', 'build'] }).order).toEqual(['hop', 'view', 'walk', 'terrain', 'scan', 'build'])
  })

  it('a future default list merges a stored one the same way', () => {
    const future: ModeId[] = ['hop', 'walk', 'view', 'build', 'scan']
    expect(mergeModes({ order: ['scan', 'hop'] }, future).order).toEqual(['scan', 'hop', 'walk', 'view', 'build'])
  })

  it('anything that is not a list reads as the default; an off first mode is switched on', () => {
    expect(mergeModes(null)).toEqual(DEFAULT_MODES)
    expect(mergeModes('junk')).toEqual(DEFAULT_MODES)
    expect(mergeModes({ order: 'hop' }).order).toEqual(DEFAULT_MODE_ORDER)
    expect(mergeModes({ order: ['scan', 'hop', 'walk', 'view', 'build'], off: ['scan', 'walk'] })).toEqual({ order: ['scan', 'hop', 'walk', 'terrain', 'view', 'build'], off: ['walk'] })
  })

  it('a stored record that does not parse is the default', () => {
    localStorage.setItem(MODES_PREFIX + A, '{not json')
    expect(readModes(A)).toBeNull()
    expect(storedModes()).toEqual(DEFAULT_MODES)
  })
})

describe('kept per identity', () => {
  it('lives in the kv store under the pubkey, and comes back for that identity only', () => {
    expect(movesToKv(MODES_PREFIX + A)).toBe(true)
    updateModes((s) => moveModeTo(s, 'walk', 0))
    expect(JSON.parse(kvGet(MODES_PREFIX + A)!)).toMatchObject({ order: ['walk', 'hop', 'terrain', 'view', 'build', 'scan'], off: [] })
    expect(storedModes().order[0]).toBe('walk')

    // Another identity starts with the default list, and keeps its own.
    as(B)
    expect(storedModes()).toEqual(DEFAULT_MODES)
    updateModes((s) => setModeOn(s, 'scan', false))
    expect(storedModes().off).toEqual(['scan'])

    // Back to the first: its list is as it left it; switching deleted nothing.
    as(A)
    expect(storedModes().order[0]).toBe('walk')
    expect(storedModes().off).toEqual([])
    expect(readModes(B)!.off).toEqual(['scan'])
  })

  it('RESET TO DEFAULT keeps no record, so a later default reaches it', () => {
    updateModes((s) => moveModeTo(s, 'scan', 0))
    expect(kvGet(MODES_PREFIX + A)).not.toBeNull()
    resetModes()
    expect(kvGet(MODES_PREFIX + A)).toBeNull()
    expect(storedModes()).toEqual(DEFAULT_MODES)
    // Moving back to the default order by hand keeps no record either.
    updateModes((s) => moveModeTo(s, 'walk', 5))
    updateModes((s) => moveModeTo(s, 'walk', 1))
    expect(kvGet(MODES_PREFIX + A)).toBeNull()
  })
})

describe('who gets the list', () => {
  beforeEach(() => { updateModes((s) => moveModeTo(moveModeTo(s, 'walk', 0), 'build', 1)) })

  it('the player, with nothing else on', () => {
    expect(customModesApply()).toBe(true)
    expect(modeRoles()).toEqual({ start: 'walk', second: 'build', ring: ['walk', 'hop', 'terrain', 'view', 'scan'] })
  })

  it('the newcomer view keeps the default pad, and the list applies once it ends', () => {
    useNewcomer.setState({ record: { stage: 'newcomer', seen: [] } })
    expect(customModesApply()).toBe(false)
    expect(effectiveModes()).toEqual(TEACHING_MODES)
    // Finished or skipped: graduated.
    useNewcomer.setState({ record: { stage: 'graduated', seen: [] } })
    expect(customModesApply()).toBe(true)
    expect(modeRoles().start).toBe('walk')
  })

  it('Settings > Interface: Newcomer view keeps the default pad too', () => {
    setHudChoice('newcomer')
    expect(effectiveModes()).toEqual(TEACHING_MODES)
    setHudChoice('everything')
    expect(modeRoles().start).toBe('walk')
  })

  it('a tour run, the /demo tour and Cyberspace TV use the default pad', () => {
    useTutorial.setState({ active: true })
    expect(effectiveModes()).toEqual(TEACHING_MODES)
    useTutorial.setState({ active: false })
    useTv.setState({ on: true })
    expect(effectiveModes()).toEqual(TEACHING_MODES)
    useTv.setState({ on: false })
    useDemo.setState({ active: true })
    expect(effectiveModes()).toEqual(TEACHING_MODES)
    useDemo.setState({ active: false })
    expect(modeRoles().start).toBe('walk')
  })
})

describe('newcomers meet TERRAIN only once the tour is done', () => {
  it('the teaching pad is the default list with TERRAIN off: the ring HOP, VIEW, BUILD, SCAN, WALK second', () => {
    expect(TEACHING_MODES.off).toEqual(['terrain'])
    expect(rolesOf(TEACHING_MODES)).toEqual({ start: 'hop', second: 'walk', ring: ['hop', 'view', 'build', 'scan'] })
    useNewcomer.setState({ record: { stage: 'newcomer', seen: [] } })
    expect(modeRoles().ring).not.toContain('terrain')
    useNewcomer.setState({ record: { stage: 'graduated', seen: [] } })
    resetModes()
    expect(modeRoles().ring).toContain('terrain')
  })
})
