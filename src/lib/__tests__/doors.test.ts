/**
 * doors.test.ts: a door and its room on the wire (DECK-0004 §3.7, cyberspace
 * PR #82, held). The room key and lookup id against a vector computed apart
 * (Python hashlib over the 79 bytes), the room entry, the door's height
 * rules (a reader drops a door higher than its bag, or not lower than the
 * room it is in), the room's region, and the `door` contents word.
 */
import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from '../events'
import { sealEntries } from '../chests'
import { CONTENTS_KINDS, bagContents, bagContentsTags, type BagEntry } from '../hidden'
import { DOOR_KDF_PREFIX, ROOM_BAG_SETTINGS, doorRefusal, doorSecretOf, doorSecretWithKey, inRoom, newDoorSecret, regionBase, roomEntries, roomKey, roomLookupId, roomOf } from '../doors'

describe('the room key (§3.7.2)', () => {
  it('is SHA-256 of the 15-byte prefix, the location key and the door secret, 79 bytes in', () => {
    expect(new TextEncoder().encode(DOOR_KDF_PREFIX)).toHaveLength(15)
    const key = roomKey(new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22))
    expect(bytesToHex(key)).toBe('6faeb1a50795c9be34dd8b6b20ec85d9da24690f1f1db29a52573ecbabb28032')
    expect(roomLookupId(key)).toBe('1c787332002a882d5f40c326390e228a672e04a11786d098b65a4a144d6b59ce')
  })

  it('needs both factors: another place or another secret is another room', () => {
    const a = roomKey(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2))
    expect(bytesToHex(roomKey(new Uint8Array(32).fill(3), new Uint8Array(32).fill(2)))).not.toBe(bytesToHex(a))
    expect(bytesToHex(roomKey(new Uint8Array(32).fill(1), new Uint8Array(32).fill(4)))).not.toBe(bytesToHex(a))
    expect(() => roomKey(new Uint8Array(31), new Uint8Array(32))).toThrow()
  })

  it('a room bag says nothing in public: no height, hint, contents or riddle', () => {
    expect(ROOM_BAG_SETTINGS).toEqual({ heightTag: false, hint: null, riddle: '', contents: false, money: false })
  })
})

describe('the room entry (§3.7.1)', () => {
  it('a door’s plaintext is one room entry, sealed and opened like a chest', () => {
    const secret = newDoorSecret()
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    const lockSk = generateSecretKey()
    const sealed = sealEntries(roomEntries(secret) as BagEntry[], getPublicKey(lockSk))
    expect(doorSecretWithKey(sealed, bytesToHex(lockSk))).toBe(secret)
  })

  it('takes the first well-formed room entry and ignores everything else', () => {
    const a = 'a'.repeat(64), b = 'b'.repeat(64)
    expect(doorSecretOf(JSON.stringify([['room', 'nope'], { kind: 1 }, ['room', a], ['room', b]]))).toBe(a)
    expect(doorSecretOf(JSON.stringify([['room', 'A'.repeat(64)]]))).toBeNull()
    expect(doorSecretOf('{"room":1}')).toBeNull()
    expect(doorSecretOf('not json')).toBeNull()
  })
})

describe('where a door may stand (§3.7.1)', () => {
  it('no higher than its bag; inside a room, lower than the room', () => {
    expect(doorRefusal([['door', '4']], 4, null)).toBeNull()
    expect(doorRefusal([['door', '5']], 4, null)).toMatch(/higher than the bag/)
    expect(doorRefusal([['door', '3']], 4, 4)).toBeNull()
    expect(doorRefusal([['door', '4']], 4, 4)).toMatch(/lower than the room/)
    expect(doorRefusal([['door', 'x']], 4, null)).toMatch(/not a height/)
    expect(doorRefusal([['title', 'chest']], 1, 1)).toBeNull()
  })

  it('its room is the aligned region of its height holding it, and a door locks one height', () => {
    const at = { x: 0x1234n, y: 0x5678n, z: 0x9abcn }
    expect(regionBase(at, 4)).toEqual({ x: 0x1230n, y: 0x5670n, z: 0x9ab0n })
    expect(inRoom(at, 4, { x: 0x123fn, y: 0x567fn, z: 0x9abfn })).toBe(true)
    expect(inRoom(at, 4, { x: 0x1240n, y: 0x5670n, z: 0x9ab0n })).toBe(false)
    expect(roomOf(at, 0, 4)).toBe(roomOf({ x: 0x123fn, y: 0x5670n, z: 0x9ab0n }, 0, 4))
    expect(roomOf(at, 0, 4)).not.toBe(roomOf(at, 1, 4))
    expect(roomOf(at, 0, 4)).not.toBe(roomOf(at, 0, 5))
  })
})

describe('the `door` contents word (spec §7.7, #82)', () => {
  const chest = (tags: string[][]): BagEntry => ({ id: '1'.repeat(64), pubkey: 'a'.repeat(64), created_at: 1, kind: 3341, tags, content: 'x', sig: 'f'.repeat(128) })
  it('a door counts as door, never as chest, written after audio', () => {
    const c = bagContents([chest([['door', '4']]), chest([]), chest([['door', '4']])])
    expect(c.door).toBe(2)
    expect(c.chest).toBe(1)
    expect(CONTENTS_KINDS.at(-1)).toBe('door')
    expect(bagContentsTags([chest([['door', '4']])], { contents: true, money: false })).toEqual([['contents', 'door', '1']])
  })
})
