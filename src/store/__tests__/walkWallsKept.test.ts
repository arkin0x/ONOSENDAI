/**
 * walkWallsKept.test.ts: WALK's walls are built once per change of the world,
 * not on every ask (arkinox, 2026-11-21: WALK stutters on his phone; his
 * diagnostics show the heap climbing 12 MB a second while he walks).
 *
 * Every WALK step, fall and stand asks for the walls (store/walkWalls.ts
 * wallItemsAt), many times a frame, and each ask built the whole world again
 * (useShards worldItems): every hide and every find, each one's place parsed
 * afresh. Here the same world answers with the same lists, and anything that
 * changes it (a find, a hide, a mute, a door closed with CLOSE, a door opened)
 * answers with new ones that say so. No relay is touched (src/test/noNetwork.ts).
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

import { newShard } from 'sno-core/shards'
import type { Hidden } from '../../lib/hidden'
import type { Position } from '../../lib/space'
import { useCyberspace } from '../useCyberspace'
import { rememberOpened, resetOpenedChests } from '../useOpenedChests'
import { resetClosedDoors, writeClosed } from '../closedDoors'
import { useMutes } from '../useMutes'
import { NOTHING_MUTED } from '../../lib/muteList'
import { useShards } from '../useShards'
import { doorWallKey, wallItems, wallItemsAt } from '../walkWalls'

const AT: Position = { x: 1n << 40n, y: 1n << 39n, z: 1n << 38n }
const ME = 'a'.repeat(64)
const HIDER = 'b'.repeat(64)
const LOCK = 'c'.repeat(64)
const DOOR = '1'.repeat(64)
const BLOCK = '3'.repeat(64)

function door(id: string, at: Position = AT): Hidden {
  const inner = { id, pubkey: HIDER, created_at: 1, kind: 3341, tags: [['title', 'Gate'], ['door', '6']], content: 'sealed' }
  return {
    eventId: id, inner, bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: HIDER, at, plane: 1, height: 6, createdAt: 1,
    type: 'chest', chest: { name: id, lockPubkey: LOCK, senderPubkey: 'd'.repeat(64), requires: '', payload: 'sealed' },
  }
}

function block(id: string, at: Position): Hidden {
  const shard = { ...newShard('Block'), id: `shard-${id}` }
  const inner = { id, pubkey: HIDER, created_at: 1, kind: 33331, tags: [], content: '' }
  return { eventId: id, inner, bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: HIDER, at, plane: 1, height: 6, createdAt: 1, type: 'shard', shard }
}

/** Far from the door: none of its walls depend on where this walker stands. */
const AWAY: Position = { x: AT.x + 100_000n, y: AT.y, z: AT.z }

beforeEach(() => {
  localStorage.clear()
  resetOpenedChests()
  resetClosedDoors()
  useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME } })
  useShards.setState({ mine: [], curated: null, discovered: { [DOOR]: door(DOOR), [BLOCK]: block(BLOCK, { x: AT.x + 64n, y: AT.y, z: AT.z }) } })
})

describe('the world WALK reads', () => {
  it('is built once for an unchanged world: every ask gets the same lists', () => {
    const world = useShards.getState().worldItems()
    const drawn = useShards.getState().drawnItems()
    const walls = wallItems(1)
    for (let i = 0; i < 50; i++) {
      expect(useShards.getState().worldItems()).toBe(world)
      expect(useShards.getState().drawnItems()).toBe(drawn)
      expect(wallItems(1)).toBe(walls)
      // Where nothing depends on the walker's spot, the walls are wallItems' own list, uncopied.
      expect(wallItemsAt(1, AWAY)).toBe(walls)
    }
    expect(walls.map((w) => w.key).sort()).toEqual([BLOCK, doorWallKey(DOOR)].sort())
  })

  it('is built again when a find arrives, and has it', () => {
    const before = wallItems(1)
    const NEW = '4'.repeat(64)
    useShards.setState({ discovered: { ...useShards.getState().discovered, [NEW]: block(NEW, { x: AT.x + 128n, y: AT.y, z: AT.z }) } })
    const after = wallItems(1)
    expect(after).not.toBe(before)
    expect(after.map((w) => w.key)).toContain(NEW)
  })

  it('is built again when the hider is muted, and leaves their things out', () => {
    const before = useShards.getState().worldItems()
    expect(before.map((w) => w.key)).toContain(BLOCK)
    useMutes.setState({ muted: { pubkeys: new Set([HIDER]), items: new Set() } })
    try {
      const after = useShards.getState().worldItems()
      expect(after).not.toBe(before)
      expect(after.map((w) => w.key)).not.toContain(BLOCK)
    } finally {
      useMutes.setState({ muted: NOTHING_MUTED })
    }
  })

  it('follows OPEN at once: an opened door leaves the walls, and the next ask says so', () => {
    expect(wallItems(1).map((w) => w.key)).toContain(doorWallKey(DOOR))
    rememberOpened(ME, DOOR, LOCK, [])
    expect(wallItems(1).map((w) => w.key)).not.toContain(doorWallKey(DOOR))
  })

  it('follows CLOSE: a door closed again stands in the walls again', async () => {
    rememberOpened(ME, DOOR, LOCK, [])
    expect(wallItems(1).map((w) => w.key)).not.toContain(doorWallKey(DOOR))
    await writeClosed([{ owner: ME, doorId: DOOR, lock: LOCK, room: '', shut: true }])
    expect(wallItems(1).map((w) => w.key)).toContain(doorWallKey(DOOR))
  })

  it('a walker inside the door slab still gets the door marked as holding them, on a copy', () => {
    // Strictly inside the door's slab (doorWalls.test.ts): one gibson up.
    const at = wallItemsAt(1, { x: AT.x, y: AT.y + 1n, z: AT.z })
    const kept = wallItems(1)
    expect(at.find((w) => w.key === doorWallKey(DOOR))!.inside).toBe(true)
    expect(at).not.toBe(kept)
    // The kept list is never marked: the next walker elsewhere gets it as it was.
    expect(kept.find((w) => w.key === doorWallKey(DOOR))!.inside).toBeUndefined()
    expect(wallItemsAt(1, AWAY)).toBe(kept)
  })
})
