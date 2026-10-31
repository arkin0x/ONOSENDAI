/**
 * doorWalls.test.ts: a door you have not opened stands in WALK's way as its
 * closed look, and OPEN takes it out of the walls at once (chest and door
 * design, R11: "a locked door blocks per its model's collision until
 * opened"; the ceremony ruling: "WALK lets you through immediately"). A
 * chest never joins the walls here, and another identity's opening opens
 * nothing for you. No relay is touched (src/test/noNetwork.ts).
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
import { openedByHand, openedContents, rememberOpened, resetOpenedChests, useOpenedChests } from '../useOpenedChests'
import { useShards } from '../useShards'
import { doorWallKey, stepLimit, wallItems, wallItemsAt } from '../walkWalls'

const AT: Position = { x: 1n << 40n, y: 1n << 39n, z: 1n << 38n }
const ME = 'a'.repeat(64)
const HIDER = 'b'.repeat(64)

function chest(id: string, tags: string[][]): Hidden {
  const inner = { id, pubkey: HIDER, created_at: 1, kind: 3341, tags, content: 'sealed' }
  return {
    eventId: id, inner, bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: HIDER, at: AT, plane: 1, height: 6, createdAt: 1,
    type: 'chest', chest: { name: id, lockPubkey: LOCK, senderPubkey: 'd'.repeat(64), requires: '', payload: 'sealed' },
  }
}

const DOOR = '1'.repeat(64)
/** The lock every chest here is sealed to. */
const LOCK = 'c'.repeat(64)
const CHEST = '2'.repeat(64)
/** In front of the door's outer face (+z), in the opening, a gibson above the sill. */
const FRONT: Position = { x: AT.x, y: AT.y + 1n, z: AT.z + 3n }

beforeEach(() => {
  localStorage.removeItem('onosendai:chests-opened')
  resetOpenedChests()
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME } })
  useShards.setState({ mine: [], discovered: { [DOOR]: chest(DOOR, [['title', 'Gate'], ['door', '6']]), [CHEST]: chest(CHEST, [['title', 'Box']]) } })
})

describe('a door in WALK', () => {
  it('stands in the walls as its closed look, and a chest does not', () => {
    const items = wallItems(1)
    expect(items.map((w) => w.key)).toEqual([doorWallKey(DOOR)])
    expect(items[0].shard.name).toMatch(/door/)
    expect(wallItems(0)).toEqual([])
  })

  it('stops a step through the doorway while closed', () => {
    expect(stepLimit(FRONT, 'z', -1, 10n, wallItems(1)).reach).toBeLessThan(10n)
  })

  it('lets you through at once once you open it', () => {
    rememberOpened(ME, DOOR, LOCK, [])
    expect(wallItems(1)).toEqual([])
    expect(stepLimit(FRONT, 'z', -1, 10n, wallItems(1)).reach).toBe(10n)
  })

  it('stays shut for you when someone else on this device opened it', () => {
    rememberOpened('9'.repeat(64), DOOR, LOCK, [])
    expect(wallItems(1).map((w) => w.key)).toEqual([doorWallKey(DOOR)])
  })

  it('stays open after a reload however it was opened, a signer\u2019s door too (review of #532)', () => {
    rememberOpened(ME, DOOR, LOCK, [])
    // A reload: the session forgets what was inside; the ids opened by hand are kept.
    resetOpenedChests()
    expect(wallItems(1)).toEqual([])
  })
})

describe('a new lock (R10: "earlier openers lose the room from then on")', () => {
  const relocked = (lock: string): void => {
    const was = useShards.getState().discovered[DOOR]
    useShards.setState({ discovered: { ...useShards.getState().discovered, [DOOR]: { ...was, chest: { ...was.chest!, lockPubkey: lock } } } })
  }
  const NEW = '7'.repeat(64)

  it('closes it again for whoever opened it under the old one, after a reload too', () => {
    rememberOpened(ME, DOOR, LOCK, [])
    relocked(NEW)
    expect(wallItems(1).map((w) => w.key)).toEqual([doorWallKey(DOOR)])
    expect(openedByHand(ME, DOOR, NEW)).toBe(false)
    expect(openedContents(useOpenedChests.getState().opened, ME, DOOR, NEW)).toBeNull()
    resetOpenedChests()
    expect(wallItems(1).map((w) => w.key)).toEqual([doorWallKey(DOOR)])
  })

  it('opened again under the new one, it is open under that one only', () => {
    rememberOpened(ME, DOOR, LOCK, [])
    relocked(NEW)
    rememberOpened(ME, DOOR, NEW, [])
    expect(wallItems(1)).toEqual([])
    expect(openedByHand(ME, DOOR, LOCK)).toBe(false)
    expect(JSON.parse(localStorage.getItem('onosendai:chests-opened')!)[ME]).toEqual([`${DOOR}:${NEW}`])
  })

  it('an opening kept before locks were kept stays open: its id names its lock', () => {
    localStorage.setItem('onosendai:chests-opened', JSON.stringify({ [ME]: [DOOR] }))
    resetOpenedChests()
    expect(wallItems(1)).toEqual([])
  })
})

describe('a walker inside a closed door (review of #532)', () => {
  const P = (dx: bigint, dy: bigint, dz: bigint): Position => ({ x: AT.x + dx, y: AT.y + dy, z: AT.z + dz })
  const SIX = [['x', 1], ['x', -1], ['y', 1], ['y', -1], ['z', 1], ['z', -1]] as const
  // Strictly inside the DOOR slab (x -1..1, y 0..3, z -0.14..0.64 in cyberspace): one and two gibsons up.
  const INSIDE = [P(0n, 1n, 0n), P(0n, 2n, 0n)]

  it('was held on every side; now they step out every way but across the door', () => {
    for (const at of INSIDE) {
      // Without the walker's place the door is a wall, and a wall all round them.
      const before = SIX.map(([a, d]) => stepLimit(at, a, d, 5n, wallItems(1)).reach)
      expect(before.some((r) => r === 0n)).toBe(true)
      const after = Object.fromEntries(SIX.map(([a, d]) => [`${d > 0 ? '+' : '-'}${a}`, stepLimit(at, a, d, 5n, wallItemsAt(1, at)).reach]))
      // Out the side they are on (the slab's middle is at z 0.25), sideways, up and down.
      expect(after).toMatchObject({ '+x': 5n, '-x': 5n, '+y': 5n, '-y': 5n, '-z': 5n })
      // Never through it.
      expect(after['+z']).toBe(0n)
    }
  })

  it('a walker outside it is still stopped by it', () => {
    expect(stepLimit(FRONT, 'z', -1, 10n, wallItemsAt(1, FRONT)).reach).toBeLessThan(10n)
  })
})

describe('no way through a closed door with no frame (review of the ceremony)', () => {
  const P = (dx: bigint, dy: bigint, dz: bigint): Position => ({ x: AT.x + dx, y: AT.y + dy, z: AT.z + dz })
  const step = (at: Position, axis: 'x' | 'y' | 'z', dir: 1 | -1, n = 1n): bigint => stepLimit(at, axis, dir, n, wallItemsAt(1, at)).reach
  /** Walk one gibson a press, as WALK does, asking the walls at each place: where it stops. */
  const walk = (from: Position, axis: 'x' | 'y' | 'z', dir: 1 | -1, n: number): Position => {
    let at = from
    for (let i = 0; i < n && step(at, axis, dir) > 0n; i++) at = { ...at, [axis]: at[axis] + BigInt(dir) }
    return at
  }

  it('no step crosses the slab\u2019s middle anywhere on it, from in front or behind, its edges included', () => {
    for (const y of [0n, 1n, 2n, 3n]) for (const x of [-1n, 0n, 1n]) {
      // z 1 is in front of the middle (z 0.25), z 0 behind it, inside the slab.
      expect(step(P(x, y, 1n), 'z', -1)).toBe(0n)
      expect(step(P(x, y, 0n), 'z', 1)).toBe(0n)
    }
  })

  it('beside, above and below it, you walk round it', () => {
    for (const [x, y] of [[-2n, 1n], [2n, 1n], [0n, -1n], [0n, 4n]] as const) {
      expect(step(P(x, y, 1n), 'z', -1)).toBe(1n)
      expect(step(P(x, y, 0n), 'z', 1)).toBe(1n)
    }
  })

  it('in from the side or from above, held on the side you came in on', () => {
    for (const y of [1n, 2n]) {
      // The reviewer's probe: these walked the whole slab and out the far side.
      expect(walk(P(4n, y, 0n), 'x', -1, 9).x).toBeGreaterThan(AT.x - 1n)
      expect(walk(P(-4n, y, 0n), 'x', 1, 9).x).toBeLessThan(AT.x + 1n)
    }
    expect(walk(P(0n, 6n, 0n), 'y', -1, 9).y).toBeGreaterThan(AT.y)
    // Off the slab, round its edge and into it: then out the back, never the front.
    const inside = walk(walk(P(3n, 1n, 1n), 'x', -1, 3), 'z', -1, 4)
    expect(inside.z).toBe(AT.z + 1n)
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
