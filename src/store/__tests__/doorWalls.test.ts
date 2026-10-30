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
import { rememberOpened, resetOpenedChests } from '../useOpenedChests'
import { useShards } from '../useShards'
import { doorWallKey, stepLimit, wallItems } from '../walkWalls'

const AT: Position = { x: 1n << 40n, y: 1n << 39n, z: 1n << 38n }
const ME = 'a'.repeat(64)
const HIDER = 'b'.repeat(64)

function chest(id: string, tags: string[][]): Hidden {
  const inner = { id, pubkey: HIDER, created_at: 1, kind: 3341, tags, content: 'sealed' }
  return {
    eventId: id, inner, bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: HIDER, at: AT, plane: 1, height: 6, createdAt: 1,
    type: 'chest', chest: { name: id, lockPubkey: 'c'.repeat(64), senderPubkey: 'd'.repeat(64), requires: '', payload: 'sealed' },
  }
}

const DOOR = '1'.repeat(64)
const CHEST = '2'.repeat(64)
/** In front of the door's outer face (+z), in the opening, a gibson above the sill. */
const FRONT: Position = { x: AT.x, y: AT.y + 1n, z: AT.z + 3n }

beforeEach(() => {
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
    rememberOpened(ME, DOOR, [])
    expect(wallItems(1)).toEqual([])
    expect(stepLimit(FRONT, 'z', -1, 10n, wallItems(1)).reach).toBe(10n)
  })

  it('stays shut for you when someone else on this device opened it', () => {
    rememberOpened('9'.repeat(64), DOOR, [])
    expect(wallItems(1).map((w) => w.key)).toEqual([doorWallKey(DOOR)])
  })
})
