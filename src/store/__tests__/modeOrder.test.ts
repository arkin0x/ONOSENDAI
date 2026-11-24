/**
 * modeOrder.test.ts - the MODES list (store/modeOrder.ts; owner, 2026-11-24):
 * what an order makes of the pad (the toggle slot first, then the ring with
 * the default mode first), moving a mode (trading places with the toggle
 * slot), switching one off and the guards on that, a list from another
 * version merged against this one's modes, a list kept before the toggle
 * slot read as the same pad, and the list kept per identity in the kv store
 * (IndexedDB, localStorage before it hydrates).
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
  TEACHING_MODES, canSwitchOff, customModesApply, DEFAULT_AT, DEFAULT_MODE_ORDER, DEFAULT_MODES, effectiveModes, fromV1, MODES, MODES_PREFIX, mergeModes, modeRoles,
  moveModeBy, moveModeTo, nextInRing, readModes, resetModes, rolesOf, setModeOn, storedModes, TOGGLE_AT, updateModes, useModes,
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

describe('the default list is today\'s pad, with TERRAIN in the ring after HOP', () => {
  it('WALK in the toggle slot, then HOP, TERRAIN, VIEW, BUILD, SCAN, all on: start in HOP, WALK the second button, the ring HOP, TERRAIN, VIEW, BUILD, SCAN', () => {
    expect(DEFAULT_MODE_ORDER).toEqual(['walk', 'hop', 'terrain', 'view', 'build', 'scan'])
    expect(DEFAULT_MODE_ORDER[TOGGLE_AT]).toBe('walk')
    expect(DEFAULT_MODE_ORDER[DEFAULT_AT]).toBe('hop')
    expect([...DEFAULT_MODE_ORDER].sort()).toEqual(MODES.map((m) => m.id).sort())
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

  it('the toggle\'s mode is its own slot, never in the ring as well', () => {
    expect(rolesOf(DEFAULT_MODES).ring).not.toContain('walk')
    expect(nextInRing(DEFAULT_MODES, 'walk')).toBe('hop')
  })
})

describe('reordering', () => {
  it('the owner\'s example: WALK the default mode and BUILD the toggle', () => {
    let s: ModeSettings = DEFAULT_MODES
    s = moveModeTo(s, 'build', TOGGLE_AT)
    expect(s.order).toEqual(['build', 'hop', 'terrain', 'view', 'walk', 'scan'])
    s = moveModeTo(s, 'walk', DEFAULT_AT)
    expect(s.order).toEqual(['build', 'walk', 'hop', 'terrain', 'view', 'scan'])
    expect(rolesOf(s)).toEqual({ start: 'walk', second: 'build', ring: ['walk', 'hop', 'terrain', 'view', 'scan'] })
    expect(nextInRing(s, 'scan')).toBe('walk')
  })

  it('a mode moved into the toggle slot trades places with the toggle\'s mode', () => {
    const s = moveModeTo(DEFAULT_MODES, 'scan', TOGGLE_AT)
    expect(s.order).toEqual(['scan', 'hop', 'terrain', 'view', 'build', 'walk'])
    expect(rolesOf(s)).toEqual({ start: 'hop', second: 'scan', ring: ['hop', 'terrain', 'view', 'build', 'walk'] })
  })

  it('the toggle\'s mode moved down trades with the mode where it lands; the rest of the ring keeps its order', () => {
    expect(moveModeTo(DEFAULT_MODES, 'walk', 4).order).toEqual(['build', 'hop', 'terrain', 'view', 'walk', 'scan'])
    expect(moveModeTo(DEFAULT_MODES, 'walk', DEFAULT_AT).order).toEqual(['hop', 'walk', 'terrain', 'view', 'build', 'scan'])
  })

  it('within the ring a mode slides and the others make room', () => {
    const s = moveModeTo(DEFAULT_MODES, 'scan', DEFAULT_AT)
    expect(s.order).toEqual(['walk', 'scan', 'hop', 'terrain', 'view', 'build'])
    expect(rolesOf(s).start).toBe('scan')
  })

  it('up and down a place at a time, across the rule too, clamped at the ends, the same list back when nothing moves', () => {
    expect(moveModeBy(DEFAULT_MODES, 'scan', -1).order).toEqual(['walk', 'hop', 'terrain', 'view', 'scan', 'build'])
    // The default mode up trades with the toggle; the toggle down trades with the default mode.
    expect(moveModeBy(DEFAULT_MODES, 'hop', -1).order).toEqual(['hop', 'walk', 'terrain', 'view', 'build', 'scan'])
    expect(moveModeBy(DEFAULT_MODES, 'walk', 1).order).toEqual(['hop', 'walk', 'terrain', 'view', 'build', 'scan'])
    expect(moveModeBy(DEFAULT_MODES, 'walk', -1)).toBe(DEFAULT_MODES)
    expect(moveModeBy(DEFAULT_MODES, 'scan', 1)).toBe(DEFAULT_MODES)
    expect(moveModeTo(DEFAULT_MODES, 'hop', 99).order).toEqual(['walk', 'terrain', 'view', 'build', 'scan', 'hop'])
  })
})

describe('switching modes off', () => {
  it('an off mode leaves the ring, and stays in the list', () => {
    const s = setModeOn(DEFAULT_MODES, 'view', false)
    expect(s.order).toEqual(DEFAULT_MODE_ORDER)
    expect(rolesOf(s).ring).toEqual(['hop', 'terrain', 'build', 'scan'])
    expect(nextInRing(s, 'terrain')).toBe('build')
  })

  it('the toggle off: no second button, and the ring as it was', () => {
    const s = setModeOn(DEFAULT_MODES, 'walk', false)
    expect(canSwitchOff(DEFAULT_MODES, 'walk')).toBe(true)
    expect(rolesOf(s)).toEqual({ start: 'hop', second: null, ring: ['hop', 'terrain', 'view', 'build', 'scan'] })
  })

  it('only the default mode on: no second button, and the ring is that mode', () => {
    let s: ModeSettings = DEFAULT_MODES
    for (const id of ['walk', 'terrain', 'view', 'build', 'scan'] as const) s = setModeOn(s, id, false)
    expect(rolesOf(s)).toEqual({ start: 'hop', second: null, ring: ['hop'] })
    expect(nextInRing(s, 'hop')).toBe('hop')
  })

  it('the default mode cannot be switched off, so the ring always has one', () => {
    expect(canSwitchOff(DEFAULT_MODES, 'hop')).toBe(false)
    expect(setModeOn(DEFAULT_MODES, 'hop', false)).toBe(DEFAULT_MODES)
    let s: ModeSettings = DEFAULT_MODES
    for (const id of DEFAULT_MODE_ORDER) s = setModeOn(s, id, false)
    expect(s.off).not.toContain('hop')
    expect(rolesOf(s).ring).toEqual(['hop'])
  })

  it('an off mode moved to the default place is switched on; one moved into the toggle slot stays off', () => {
    const s = moveModeTo(setModeOn(DEFAULT_MODES, 'build', false), 'build', DEFAULT_AT)
    expect(s.order[DEFAULT_AT]).toBe('build')
    expect(s.off).toEqual([])
    const t = moveModeTo(setModeOn(DEFAULT_MODES, 'build', false), 'build', TOGGLE_AT)
    expect(t.order[TOGGLE_AT]).toBe('build')
    expect(rolesOf(t).second).toBeNull()
    // The default mode up into the slot leaves the old toggle the default, switched on.
    const u = moveModeBy(setModeOn(DEFAULT_MODES, 'walk', false), 'hop', -1)
    expect(u).toEqual({ order: ['hop', 'walk', 'terrain', 'view', 'build', 'scan'], off: [] })
  })

  it('from a mode off the ring, the ring goes on from its place in the list', () => {
    const s = setModeOn(DEFAULT_MODES, 'build', false)
    expect(nextInRing(s, 'build')).toBe('scan')
    expect(nextInRing(setModeOn(s, 'scan', false), 'build')).toBe('hop')
  })
})

describe('a list from another version', () => {
  it('a mode added since joins at its default place, never the toggle slot or the default place; one this version lacks is dropped', () => {
    // Saved before SCAN existed, BUILD the toggle; and a mode from a later version.
    const s = mergeModes({ order: ['build', 'walk', 'hop', 'view', 'teleport'], off: ['view', 'teleport'] })
    // TERRAIN, added since too, joins after HOP, its neighbour above in the default ring.
    expect(s.order).toEqual(['build', 'walk', 'hop', 'terrain', 'view', 'scan'])
    expect(s.off).toEqual(['view'])
    // A mode whose default neighbour is the toggle's joins below the default mode, which stays.
    const future: ModeId[] = ['walk', 'hop', 'scan', 'view', 'build']
    expect(mergeModes({ v: 2, order: ['hop', 'walk', 'view', 'build'] }, future).order).toEqual(['hop', 'walk', 'scan', 'view', 'build'])
  })

  it('duplicates keep the first; a list that is missing everything builds the default', () => {
    expect(mergeModes({ order: ['view', 'hop', 'view', 'scan', 'build'] }).order).toEqual(['view', 'hop', 'terrain', 'walk', 'scan', 'build'])
    expect(mergeModes({ order: [] })).toEqual(DEFAULT_MODES)
  })

  it('anything that is not a list reads as the default; an off default mode is switched on', () => {
    expect(mergeModes(null)).toEqual(DEFAULT_MODES)
    expect(mergeModes('junk')).toEqual(DEFAULT_MODES)
    expect(mergeModes({ order: 'hop' }).order).toEqual(DEFAULT_MODE_ORDER)
    expect(mergeModes({ order: ['scan', 'hop', 'walk', 'view', 'build'], off: ['scan', 'hop', 'walk'] })).toEqual({ order: ['scan', 'hop', 'terrain', 'walk', 'view', 'build'], off: ['scan', 'walk'] })
  })

  it('a stored record that does not parse is the default', () => {
    localStorage.setItem(MODES_PREFIX + A, '{not json')
    expect(readModes(A)).toBeNull()
    expect(storedModes()).toEqual(DEFAULT_MODES)
  })
})

describe('a list kept before the toggle slot (v1, PR #915): the same pad', () => {
  /** A v1 record as #915 wrote it, read back. */
  const v1 = (order: ModeId[], off: ModeId[] = []): ModeSettings | null => {
    localStorage.setItem(MODES_PREFIX + A, JSON.stringify({ v: 1, order, off }))
    return readModes(A)
  }
  /** The pad a v1 list made, by #915's rule: the first mode the start, the first mode on after it the second button. */
  const v1Roles = (order: ModeId[], off: ModeId[] = []) => {
    const on = order.filter((id, i) => i === 0 || !off.includes(id))
    const second = on[1] ?? null
    return { start: order[0], second, ring: on.filter((id) => id !== second) }
  }
  /** The same pad with TERRAIN, which v1 never knew, on in the ring after HOP (after the default mode when HOP is the toggle). */
  const withTerrain = (r: { start: ModeId; second: ModeId | null; ring: ModeId[] }) => {
    const ring = [...r.ring]
    const at = ring.indexOf('hop')
    ring.splice(at < 0 ? 1 : at + 1, 0, 'terrain')
    return { ...r, ring }
  }

  it('the old first place is the default mode, the old second the toggle', () => {
    const s = v1(['walk', 'build', 'hop', 'view', 'scan'])!
    expect(s.order).toEqual(['build', 'walk', 'hop', 'terrain', 'view', 'scan'])
    expect(rolesOf(s)).toEqual({ start: 'walk', second: 'build', ring: ['walk', 'hop', 'terrain', 'view', 'scan'] })
  })

  it('the old default list is the new default list', () => {
    expect(v1(['hop', 'walk', 'view', 'build', 'scan'])).toEqual(DEFAULT_MODES)
    expect(fromV1({ order: ['hop', 'walk', 'view', 'build', 'scan'], off: [] })).toEqual(DEFAULT_MODES)
  })

  it('an old second place switched off: the next mode on was the second button, and is the toggle now', () => {
    const s = v1(['hop', 'walk', 'view', 'build', 'scan'], ['walk'])!
    expect(s.order).toEqual(['view', 'hop', 'terrain', 'walk', 'build', 'scan'])
    expect(rolesOf(s)).toEqual(withTerrain(v1Roles(['hop', 'walk', 'view', 'build', 'scan'], ['walk'])))
  })

  it('only one mode on: there was no second button, and there is none now', () => {
    const order: ModeId[] = ['scan', 'hop', 'walk', 'view', 'build']
    const off: ModeId[] = ['hop', 'walk', 'view', 'build']
    const s = v1(order, off)!
    expect(s.order[TOGGLE_AT]).toBe('hop')
    // TERRAIN, which v1 did not know, joins the ring on.
    expect(rolesOf(s)).toEqual({ start: 'scan', second: null, ring: ['scan', 'terrain'] })
  })

  it('every v1 list makes the pad it made before', () => {
    const lists: Array<[ModeId[], ModeId[]]> = [
      [['hop', 'walk', 'view', 'build', 'scan'], ['view']],
      [['view', 'hop', 'walk', 'build', 'scan'], []],
      [['hop', 'scan', 'view', 'build', 'walk'], ['build']],
      [['walk', 'build', 'scan', 'view', 'hop'], ['build', 'view']],
      [['build', 'walk', 'hop', 'view', 'scan'], ['walk', 'hop', 'scan']],
    ]
    // The same start, second button and ring; TERRAIN, which v1 never knew, joins the ring on.
    for (const [order, off] of lists) {
      const r = rolesOf(v1(order, off)!)
      expect({ ...r, ring: r.ring.filter((m) => m !== 'terrain') }, order.join()).toEqual(v1Roles(order, off))
      expect(r.ring, order.join()).toContain('terrain')
    }
  })

  it('a mode added since v1 never takes the old second button or the start', () => {
    // A later version with TERRAIN after WALK: only the modes v1 knew decide the toggle and the start.
    const later = ['walk', 'terrain', 'hop', 'view', 'build', 'scan'] as ModeId[]
    const a = fromV1({ order: ['walk', 'hop', 'view', 'build', 'scan'], off: [] }, later)
    expect(a.order).toEqual(['hop', 'walk', 'terrain', 'view', 'build', 'scan'])
    expect(rolesOf(a)).toMatchObject({ start: 'walk', second: 'hop' })
    const b = fromV1({ order: ['hop', 'walk', 'view', 'build', 'scan'], off: ['walk'] }, later)
    expect(rolesOf(b)).toMatchObject({ start: 'hop', second: 'view' })
    expect(b.order).toEqual(['view', 'hop', 'walk', 'terrain', 'build', 'scan'])
  })

  it('a later version reads as this one, never as v1', () => {
    localStorage.setItem(MODES_PREFIX + A, JSON.stringify({ v: 3, order: ['build', 'walk', 'hop', 'view', 'scan'], off: [] }))
    expect(readModes(A)!.order).toEqual(['build', 'walk', 'hop', 'terrain', 'view', 'scan'])
  })

  it('a record with no version is read as v1; the next change writes v2', () => {
    localStorage.setItem(MODES_PREFIX + A, JSON.stringify({ order: ['walk', 'build', 'hop', 'view', 'scan'], off: [] }))
    expect(storedModes().order).toEqual(['build', 'walk', 'hop', 'terrain', 'view', 'scan'])
    updateModes((s) => setModeOn(s, 'scan', false))
    expect(JSON.parse(kvGet(MODES_PREFIX + A)!)).toEqual({ v: 2, order: ['build', 'walk', 'hop', 'terrain', 'view', 'scan'], off: ['scan'] })
    expect(readModes(A)).toEqual({ order: ['build', 'walk', 'hop', 'terrain', 'view', 'scan'], off: ['scan'] })
  })
})

describe('kept per identity', () => {
  it('lives in the kv store under the pubkey, and comes back for that identity only', () => {
    expect(movesToKv(MODES_PREFIX + A)).toBe(true)
    updateModes((s) => moveModeTo(s, 'hop', TOGGLE_AT))
    expect(JSON.parse(kvGet(MODES_PREFIX + A)!)).toEqual({ v: 2, order: ['hop', 'walk', 'terrain', 'view', 'build', 'scan'], off: [] })
    expect(storedModes().order[DEFAULT_AT]).toBe('walk')

    // Another identity starts with the default list, and keeps its own.
    as(B)
    expect(storedModes()).toEqual(DEFAULT_MODES)
    updateModes((s) => setModeOn(s, 'scan', false))
    expect(storedModes().off).toEqual(['scan'])

    // Back to the first: its list is as it left it; switching deleted nothing.
    as(A)
    expect(storedModes().order[DEFAULT_AT]).toBe('walk')
    expect(storedModes().off).toEqual([])
    expect(readModes(B)!.off).toEqual(['scan'])
  })

  it('RESET TO DEFAULT keeps no record, so a later default reaches it', () => {
    updateModes((s) => moveModeTo(s, 'scan', TOGGLE_AT))
    expect(kvGet(MODES_PREFIX + A)).not.toBeNull()
    resetModes()
    expect(kvGet(MODES_PREFIX + A)).toBeNull()
    expect(storedModes()).toEqual(DEFAULT_MODES)
    // Moving back to the default order by hand keeps no record either.
    updateModes((s) => moveModeTo(s, 'view', 5))
    updateModes((s) => moveModeTo(s, 'view', 3))
    expect(kvGet(MODES_PREFIX + A)).toBeNull()
  })
})

describe('who gets the list', () => {
  beforeEach(() => { updateModes(() => ({ order: ['build', 'walk', 'hop', 'view', 'scan'], off: [] })) })

  it('the player, with nothing else on', () => {
    expect(customModesApply()).toBe(true)
    expect(modeRoles()).toEqual({ start: 'walk', second: 'build', ring: ['walk', 'hop', 'view', 'scan'] })
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
