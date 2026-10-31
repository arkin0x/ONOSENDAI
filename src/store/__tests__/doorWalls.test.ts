/**
 * doorWalls.test.ts: a door you have not opened stands in WALK's way as its
 * closed look, and OPEN takes it out of the walls at once (chest and door
 * design, R11: "a locked door blocks per its model's collision until
 * opened"; the ceremony ruling: "WALK lets you through immediately"). A
 * chest's look is a wall at all times (DECK-0004 §3.6 Walkers, spec #82),
 * and another identity's opening opens nothing for you. No relay is touched (src/test/noNetwork.ts).
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
vi.mock('../../lib/contacts', () => ({ GENERAL_RELAYS: [], followsOf: async () => [], fetchContacts: async () => [] }))

import type { Hidden } from '../../lib/hidden'
import type { Position } from '../../lib/space'
import { useCyberspace } from '../useCyberspace'
import { rememberOpened, resetOpenedChests } from '../useOpenedChests'
import { useShards } from '../useShards'
import { doorWallKey, stepLimit, wallItems, wallItemsAt } from '../walkWalls'

const AT: Position = { x: 1n << 40n, y: 1n << 39n, z: 1n << 38n }
const ME = 'a'.repeat(64)
const HIDER = 'b'.repeat(64)

function chest(id: string, tags: string[][], at: Position = AT): Hidden {
  const inner = { id, pubkey: HIDER, created_at: 1, kind: 3341, tags, content: 'sealed' }
  return {
    eventId: id, inner, bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: HIDER, at, plane: 1, height: 6, createdAt: 1,
    type: 'chest', chest: { name: id, lockPubkey: 'c'.repeat(64), senderPubkey: 'd'.repeat(64), requires: '', payload: 'sealed' },
  }
}

const DOOR = '1'.repeat(64)
const CHEST = '2'.repeat(64)
/** The chest stands well away from the door, so each test reads one of them. */
const CHEST_AT: Position = { x: AT.x + 4096n, y: AT.y, z: AT.z }
const doorWalls = (plane: number): string[] => wallItems(plane).map((w) => w.key).filter((k) => k === doorWallKey(DOOR))
/** In front of the door's outer face (+z), in the opening, a gibson above the sill. */
const FRONT: Position = { x: AT.x, y: AT.y + 1n, z: AT.z + 3n }

beforeEach(() => {
  localStorage.removeItem('onosendai:chests-opened')
  resetOpenedChests()
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME } })
  useShards.setState({ mine: [], discovered: { [DOOR]: chest(DOOR, [['title', 'Gate'], ['door', '6']]), [CHEST]: chest(CHEST, [['title', 'Box']], CHEST_AT) } })
})

describe('a door in WALK', () => {
  it('stands in the walls as its closed look, and a chest as its look too (spec #82: a chest\u2019s look always)', () => {
    const items = wallItems(1)
    expect(items.map((w) => w.key).sort()).toEqual([doorWallKey(DOOR), doorWallKey(CHEST)].sort())
    expect(items.find((w) => w.key === doorWallKey(DOOR))!.shard.name).toMatch(/door/)
    expect(items.find((w) => w.key === doorWallKey(CHEST))!.shard.name).toMatch(/Treasure/)
    expect(wallItems(0)).toEqual([])
  })

  it('a chest stays a wall once opened: its open look is solid too', () => {
    rememberOpened(ME, CHEST, [])
    expect(wallItems(1).find((w) => w.key === doorWallKey(CHEST))!.shard.name).toMatch(/open/)
  })

  it('stops a step through the doorway while closed', () => {
    expect(stepLimit(FRONT, 'z', -1, 10n, wallItems(1)).reach).toBeLessThan(10n)
  })

  it('lets you through at once once you open it', () => {
    rememberOpened(ME, DOOR, [])
    expect(doorWalls(1)).toEqual([])
    expect(stepLimit(FRONT, 'z', -1, 10n, wallItems(1)).reach).toBe(10n)
  })

  it('stays shut for you when someone else on this device opened it', () => {
    rememberOpened('9'.repeat(64), DOOR, [])
    expect(doorWalls(1)).toEqual([doorWallKey(DOOR)])
  })

  it('stays open after a reload however it was opened, a signer\u2019s door too (review of #532)', () => {
    rememberOpened(ME, DOOR, [])
    // A reload: the session forgets what was inside; the ids opened by hand are kept.
    resetOpenedChests()
    expect(doorWalls(1)).toEqual([])
  })
})

describe('a walker inside a closed door (review of #532)', () => {
  const inside = (dy: bigint): Position => ({ x: AT.x, y: AT.y + dy, z: AT.z })
  // The probe's heights: on the sill, and one and two gibsons above it.
  const SIX = [['x', 1], ['x', -1], ['y', 1], ['y', -1], ['z', 1], ['z', -1]] as const

  it('was held on every side; now the door holding them is not a wall to them, and they step out', () => {
    for (const dy of [0n, 1n, 2n]) {
      const P = inside(dy)
      // Without the walker's place the door is a wall, and a wall all round them.
      const before = SIX.map(([a, d]) => stepLimit(P, a, d, 5n, wallItems(1)).reach)
      expect(before.some((r) => r === 0n)).toBe(true)
      const after = SIX.map(([a, d]) => stepLimit(P, a, d, 5n, wallItemsAt(1, P)).reach)
      expect(after.every((r) => r > 0n)).toBe(true)
    }
  })

  it('a walker outside it is still stopped by it', () => {
    expect(stepLimit(FRONT, 'z', -1, 10n, wallItemsAt(1, FRONT)).reach).toBeLessThan(10n)
  })
})

describe('a door is a wall where it is drawn (review of #532)', () => {
  it('whole, not cut at a small bag\u2019s region, as it is drawn', () => {
    // A height-1 bag: a 2-gibson region, and the door 3 tall in it. Two gibsons
    // up is out of the region, where the drawn door still stands.
    useShards.setState({ discovered: { [DOOR]: { ...chest(DOOR, [['title', 'Gate'], ['door', '1']]), height: 1 } } })
    const high: Position = { x: AT.x, y: AT.y + 2n, z: AT.z + 3n }
    expect(stepLimit(high, 'z', -1, 10n, wallItemsAt(1, high)).reach).toBeLessThan(10n)
  })
})
