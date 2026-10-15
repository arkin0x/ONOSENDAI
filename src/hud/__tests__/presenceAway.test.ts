/**
 * presenceAway.test.ts: "N IN THIS SECTOR" counts your own sector only, so
 * the chip steps aside whenever the place on screen is somewhere else
 * (arkinox, 2026-10-11; one rule for every view path, 2026-10-15, after it
 * stayed up over a hyperspace port in ideaspace).
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

// The store first: PresenceChip imports it, and its import cycle needs the store built.
import { useCyberspace } from '../../store/useCyberspace'
import { awayFromOwnSector, type SectorView } from '../PresenceChip'
import { startCoordRoute } from '../../store/useCoordRoute'
import { exitHyperspaceView, ownHyperspaceView } from '../../store/useHyperspace'
import type { Position } from '../../lib/space'
import { xyzToCoord } from 'cyberspace-core'

const SECTOR = 1n << 30n
const at = (x: bigint, y = 5n, z = 5n): Position => ({ x, y, z })
const home: SectorView = { spectate: null, position: at(5n), headPlane: 0, anchor: at(5n), anchorPlane: 0, cursor: at(5n), plane: 0 }

describe('the predicate', () => {
  it('shows at home: anchor, cursor and position in one sector and plane', () => {
    expect(awayFromOwnSector(home)).toBe(false)
    expect(awayFromOwnSector({ ...home, cursor: at(SECTOR - 1n) })).toBe(false)
  })
  it('steps aside while spectating, wherever the view is', () => {
    expect(awayFromOwnSector({ ...home, spectate: { pubkey: 'x' } })).toBe(true)
  })
  it('steps aside when the scene is anchored in another sector (VIEW, /C/, a stop, an item, a pin, history)', () => {
    expect(awayFromOwnSector({ ...home, anchor: at(SECTOR + 1n) })).toBe(true)
  })
  it('steps aside when the scene is anchored in the other plane, even at the same numbers', () => {
    expect(awayFromOwnSector({ ...home, anchorPlane: 1 })).toBe(true)
  })
  it('steps aside when the cursor is lined up in another sector or plane', () => {
    expect(awayFromOwnSector({ ...home, cursor: at(SECTOR + 1n) })).toBe(true)
    expect(awayFromOwnSector({ ...home, plane: 1 })).toBe(true)
  })
})

describe('every way of looking elsewhere, through the store', () => {
  const away = (): boolean => awayFromOwnSector(useCyberspace.getState())
  const far = (): Position => {
    const p = useCyberspace.getState().position
    return { x: p.x ^ (SECTOR << 4n), y: p.y, z: p.z }
  }
  beforeEach(() => {
    useCyberspace.setState({ spectate: null, exploreIndex: null })
    exitHyperspaceView()
    useCyberspace.getState().clearFocus()
    useCyberspace.getState().cancel()
  })

  it('at your head: shown', () => {
    expect(away()).toBe(false)
  })
  it('a hyperspace stop view (the reported bug: a port in ideaspace, cursor left at your head)', () => {
    const s = useCyberspace.getState()
    s.focusOn(far(), 1, 'BLOCK 534527 · PORT')
    ownHyperspaceView()
    expect(useCyberspace.getState().cursor).toEqual(s.position)
    expect(away()).toBe(true)
  })
  it('a stop view in your own sector but the other plane', () => {
    const s = useCyberspace.getState()
    // The other plane from the one you stand in: a random identity spawns in either.
    s.focusOn({ ...s.position }, s.headPlane === 0 ? 1 : 0, 'BLOCK 1')
    expect(away()).toBe(true)
  })
  it('VIEW at your head is still home; driving it into another sector is not', () => {
    const s = useCyberspace.getState()
    s.viewHere()
    expect(away()).toBe(false)
    s.focusOn(far(), s.headPlane, 'VIEW', undefined, true)
    expect(away()).toBe(true)
  })
  it('a focused item elsewhere', () => {
    useCyberspace.getState().focusItem(far(), useCyberspace.getState().headPlane, 'shard')
    expect(away()).toBe(true)
  })
  it('a /C/ link to somewhere else', () => {
    const p = far()
    const full = xyzToCoord(p.x, p.y, p.z, useCyberspace.getState().headPlane).toString(16).padStart(64, '0')
    startCoordRoute({ pathname: `/C/${full}`, search: '', hash: '' }, { replaceState: () => {} })
    expect(useCyberspace.getState().focus).not.toBeNull()
    expect(away()).toBe(true)
  })
  it('a pin viewed elsewhere', () => {
    const s = useCyberspace.getState()
    s.dropPin(far(), 'pin')
    s.viewPin()
    expect(away()).toBe(true)
  })
  it('spectating someone', () => {
    useCyberspace.setState({ spectate: { pubkey: 'f'.repeat(64) } as never })
    expect(away()).toBe(true)
  })
  it('the cursor moved out of your sector at your head', () => {
    useCyberspace.setState({ cursor: far() })
    expect(away()).toBe(true)
  })
})
