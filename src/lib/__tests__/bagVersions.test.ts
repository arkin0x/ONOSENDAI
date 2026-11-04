/**
 * bagVersions.test.ts: what a scan's answer takes off the screen (review of
 * #587). A door that went takes its room's finds with it, and the scan's
 * NIP-09 rule is the found cache's, not a second copy of it.
 */
import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bagDeleted, staleFinds, type FindOfBag } from '../bagVersions'
import { deletedRows } from '../foundCache'
import type { FoundBag } from '../foundDb'
import type { NostrEvent } from '../events'

const sk = generateSecretKey()
const AUTHOR = getPublicKey(sk)
const L = 'a'.repeat(64)
const ADDRESS = `33330:${AUTHOR}:${L}`
const bag = (at: number, note = ''): NostrEvent => finalizeEvent({ kind: 33330, created_at: at, content: note, tags: [['d', L]] }, sk) as NostrEvent
const retract = (at: number, tags: string[][], key = sk): NostrEvent => finalizeEvent({ kind: 5, created_at: at, content: '', tags }, key) as NostrEvent

describe('a door that goes takes its room with it', () => {
  it('drops what stood in the room, and what came out of a chest in it', () => {
    const v1 = bag(100)
    const del = retract(150, [['a', ADDRESS]])
    const finds: Record<string, FindOfBag> = {
      door: { eventId: 'door', author: AUTHOR, lookupId: L, bagId: v1.id, bagAt: 100 },
      inRoom: { eventId: 'inRoom', author: AUTHOR, lookupId: 'r'.repeat(64), bagId: 'x'.repeat(64), bagAt: 100, room: { doorId: 'door' } },
      inChestInRoom: { eventId: 'inChestInRoom', author: AUTHOR, lookupId: 'r'.repeat(64), bagId: 'x'.repeat(64), bagAt: 100, chestId: 'inRoom' },
      elsewhere: { eventId: 'elsewhere', author: AUTHOR, lookupId: 'r'.repeat(64), bagId: 'x'.repeat(64), bagAt: 100, room: { doorId: 'another door' } },
    }
    expect(staleFinds(finds, [], [del], new Set()).sort()).toEqual(['door', 'inChestInRoom', 'inRoom'])
  })

  it('a door still standing keeps its room', () => {
    const v1 = bag(100)
    const finds: Record<string, FindOfBag> = {
      door: { eventId: 'door', author: AUTHOR, lookupId: L, bagId: v1.id, bagAt: 100 },
      inRoom: { eventId: 'inRoom', author: AUTHOR, lookupId: 'r'.repeat(64), bagId: 'x'.repeat(64), bagAt: 100, room: { doorId: 'door' } },
    }
    expect(staleFinds(finds, [v1], [], new Set(['door']))).toEqual([])
  })
})

describe('one deletion rule for the scan and the found cache', () => {
  it('agrees with deletedRows on every shape', () => {
    const other = generateSecretKey()
    const b = bag(300)
    const cases: NostrEvent[][] = [
      [],
      [retract(300, [['a', ADDRESS]])],
      [retract(299, [['a', ADDRESS]])],
      [retract(100, [['e', b.id]])],
      [retract(400, [['a', ADDRESS], ['e', b.id]], other)],
      [{ ...retract(400, [['a', ADDRESS]], other), pubkey: AUTHOR }],
      [retract(400, [['a', `33330:${AUTHOR}:${'b'.repeat(64)}`]])],
    ]
    for (const deletions of cases) {
      const row = { rowKey: 'k', outer: b } as unknown as FoundBag
      expect(bagDeleted(b, deletions)).toBe(deletedRows([row], deletions).length === 1)
    }
    expect(cases.map((d) => bagDeleted(b, d))).toEqual([false, true, false, true, false, false, false])
  })

  it('a find whose bag was deleted by id goes, by an older retraction it stays', () => {
    const b = bag(300)
    const find: Record<string, FindOfBag> = { f: { eventId: 'f', author: AUTHOR, lookupId: L, bagId: b.id, bagAt: 300 } }
    expect(staleFinds(find, [], [retract(100, [['e', b.id]])], new Set())).toEqual(['f'])
    expect(staleFinds(find, [], [retract(299, [['a', ADDRESS]])], new Set())).toEqual([])
  })
})

describe('a holder only re-filed keeps what is in it (review of #593)', () => {
  // The reviewer's probe: the hider changed something else in the door's bag.
  it('a door whose bag has a newer version that still holds it keeps its room', () => {
    const v1 = bag(100, 'door')
    const v2 = bag(200, 'door, plus something new beside it')
    const finds: Record<string, FindOfBag> = {
      door: { eventId: 'door', author: AUTHOR, lookupId: L, bagId: v1.id, bagAt: 100 },
      inRoom: { eventId: 'inRoom', author: AUTHOR, lookupId: 'r'.repeat(64), bagId: 'x'.repeat(64), bagAt: 150, room: { doorId: 'door' } },
    }
    // The door itself goes only to be filed again under v2, by the same scan.
    expect(staleFinds(finds, [v2], [], new Set(['door']))).toEqual(['door'])
  })

  it('a chest whose bag has a newer version that still holds it keeps what came out of it', () => {
    const v1 = bag(100, 'chest')
    const v2 = bag(200, 'chest, plus something new beside it')
    const finds: Record<string, FindOfBag> = {
      chest: { eventId: 'chest', author: AUTHOR, lookupId: L, bagId: v1.id, bagAt: 100 },
      inside: { eventId: 'inside', author: AUTHOR, lookupId: L, bagId: v1.id, bagAt: 100, chestId: 'chest' },
      deeper: { eventId: 'deeper', author: AUTHOR, lookupId: L, bagId: v1.id, bagAt: 100, chestId: 'inside' },
    }
    expect(staleFinds(finds, [v2], [], new Set(['chest']))).toEqual(['chest'])
  })

  it('a newer version that no longer holds the door or the chest takes what is in them', () => {
    const v1 = bag(100, 'door and chest')
    const v2 = bag(200, 'both taken out')
    const finds: Record<string, FindOfBag> = {
      door: { eventId: 'door', author: AUTHOR, lookupId: L, bagId: v1.id, bagAt: 100 },
      inRoom: { eventId: 'inRoom', author: AUTHOR, lookupId: 'r'.repeat(64), bagId: 'x'.repeat(64), bagAt: 150, room: { doorId: 'door' } },
      chest: { eventId: 'chest', author: AUTHOR, lookupId: L, bagId: v1.id, bagAt: 100 },
      inside: { eventId: 'inside', author: AUTHOR, lookupId: L, bagId: v1.id, bagAt: 100, chestId: 'chest' },
    }
    expect(staleFinds(finds, [v2], [], new Set()).sort()).toEqual(['chest', 'door', 'inRoom', 'inside'])
  })
})
