/**
 * locks.test.ts: the lock of a region or a room (DECK-0004 §3.8, draft;
 * arkin0x/cyberspace#93). The spec's golden vectors, the same values cross-
 * checked with @noble directly, the validity rule, and a chest and a door
 * sealed to a region's lock opening with its key and with no other.
 */
import { describe, expect, it } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes, type NostrEvent } from '../events'
import { isLockSecret, LOCK_KDF_PREFIX, lockOf, lockOfHex, lockPreimage, lockSecret } from '../locks'
import { openWithSecret, openerFor, readContents, sealEntries } from '../chests'
import { chestItemOf, messageInnerTemplate } from '../hidden'
import { doorSecretWithKey, newDoorSecret, roomEntries, roomKey } from '../doors'
import vectors from './locksVectors.json'

describe('the derivation, against the spec vectors (cyberspace#93)', () => {
  for (const name of ['region', 'region_height_5', 'room'] as const) {
    it(`${name}: preimage, lock secret and lock`, () => {
      const v = vectors[name] as { preimage: string; lock_secret: string; lock: string; location_key?: string; room_key?: string }
      const key = hexToBytes(v.room_key ?? v.location_key!)
      expect(bytesToHex(lockPreimage(key))).toBe(v.preimage)
      expect(lockOfHex(bytesToHex(key))).toEqual({ secretHex: v.lock_secret, pubkey: v.lock })
    })
  }

  it('the h4 region and the room give the coordinator’s values', () => {
    expect(lockOfHex('78d749966d5bd372baccaa7f72cc844af5ffed9ad4f4415bc95330f63aefe37a')).toEqual({ secretHex: 'dd5ac16b2c785b35f32d1db9ba05ff985bfab7371c53aca7602b36b79477ce5d', pubkey: 'aca9d6fa2946087f2d8ae0d66d4156b15aaac8b4b3faa68b21dfc14a03b173d5' })
    expect(lockOfHex('f2f2c2c83702a57d35a7cd01a6ff158818442c08336d82225bfaa57d89676491')?.pubkey).toBe('24bd8076a3714248ee856dd201625a29f065b1d52a71d789ce5ae9f512a10a22')
  })

  it('the room vector’s room key is the door formula over its location key and door secret', () => {
    expect(bytesToHex(roomKey(hexToBytes(vectors.room.location_key), hexToBytes(vectors.room.door_secret)))).toBe(vectors.room.room_key)
  })
})

describe('golden values of this module, cross-checked', () => {
  // Also checked against a pure-Python secp256k1 written for this PR (hashlib, no noble).
  const golden: Array<[string, string, string]> = [
    ['b4cb40e2137415935f96f55783bd9ce9702584583a4e4981f2418a9d50888aa6', '974c5937ce9c6984eec75247e859be67fa3de158a3bc7b68304be0c18008bd34', 'd2d365293f9d2ac25994e1b058bd0ca9416cff6b6b0f1cf177ee36549ee3b782'],
    ['00'.repeat(32), 'c96d86566ee73242a3db5ebafbaa1f9630736eb440e780e95863944d812c7da1', '9bd8f9d5ab1082b816c90ba1d401ac2797742c6a169a9ae852f5d0718bf9c85d'],
    ['ff'.repeat(32), '9b4b529d75599f5d68e1fb4f61aa4d2f14e133da2d298f1400eac0c2c0cb8925', 'a5c29ad0cff7cdaf7437c84121494139781d2c6ab6efb68a1ae623c8632bebe1'],
  ]
  for (const [key, secret, lock] of golden) {
    it(`bag key ${key.slice(0, 8)}…`, () => {
      expect(lockOfHex(key)).toEqual({ secretHex: secret, pubkey: lock })
      // Independently: 15 prefix bytes then the key, hashed, then noble's x-only public key.
      const pre = new Uint8Array([...new TextEncoder().encode('cyberspace:lock'), ...hexToBytes(key)])
      expect(pre.length).toBe(47)
      const h = sha256(pre)
      expect(bytesToHex(h)).toBe(secret)
      expect(bytesToHex(schnorr.getPublicKey(h))).toBe(lock)
    })
  }

  it('the prefix is 15 ASCII bytes', () => {
    expect(new TextEncoder().encode(LOCK_KDF_PREFIX).length).toBe(15)
  })

  it('a bag key must be 32 bytes', () => {
    expect(() => lockOf(new Uint8Array(31))).toThrow()
    expect(lockOfHex('nothex')).toBeNull()
  })
})

describe('validity: never reduced, never negated', () => {
  const n = secp256k1.Point.CURVE().n
  const be = (v: bigint): Uint8Array => hexToBytes(v.toString(16).padStart(64, '0'))
  it('zero, n and above are no secret; 1 and n-1 are', () => {
    expect(isLockSecret(be(0n))).toBe(false)
    expect(isLockSecret(be(n))).toBe(false)
    expect(isLockSecret(be(n + 1n))).toBe(false)
    expect(isLockSecret(hexToBytes('ff'.repeat(32)))).toBe(false)
    expect(isLockSecret(be(1n))).toBe(true)
    expect(isLockSecret(be(n - 1n))).toBe(true)
  })

  it('the secret is the hash itself, even when its public key has an odd y', () => {
    // Find a bag key whose lock point has odd y, and check the secret was left alone.
    for (let i = 0; i < 64; i++) {
      const key = sha256(new Uint8Array([i]))
      const s = lockSecret(key)!
      const odd = secp256k1.getPublicKey(s, true)[0] === 3
      if (!odd) continue
      expect(bytesToHex(s)).toBe(bytesToHex(sha256(lockPreimage(key))))
      // And it still opens what is sealed to its x-only lock.
      const lock = lockOf(key)!
      const sealed = sealEntries([], lock.pubkey)
      expect(openWithSecret({ senderPubkey: sealed.senderPubkey, payload: sealed.payload }, lock.secretHex)).toEqual([])
      return
    }
    throw new Error('no odd-y lock in 64 tries')
  })
})

describe('the spec’s chest sealed to the h4 region’s lock', () => {
  it('opens with the lock secret and reads its contents', () => {
    const event = vectors.chest.event as NostrEvent
    const chest = chestItemOf(event)!
    expect(chest.lockPubkey).toBe(vectors.region.lock)
    const entries = openWithSecret(chest, vectors.chest.opens_with_lock_secret)
    expect(JSON.stringify(entries)).toBe(vectors.chest.plaintext)
  })
})

describe('the spec’s door sealed to the h4 region’s lock, end to end (cyberspace#93 730eec9)', () => {
  it('region key, lock, door secret, room key, room lookup id', () => {
    const v = vectors.door
    const event = v.event as NostrEvent
    const door = chestItemOf(event)!
    // The region key gives the lock the door is sealed to.
    const lock = lockOfHex(vectors.region.location_key)!
    expect(door.lockPubkey).toBe(lock.pubkey)
    expect(lock.secretHex).toBe(v.opens_with_lock_secret)
    // The lock secret opens it, to its one room entry.
    const secret = doorSecretWithKey(door, lock.secretHex)
    expect(secret).toBe(v.door_secret)
    // Its own room is the region of its height holding its C: that region's key, not the lock's.
    const key = roomKey(hexToBytes(v.door_region.location_key), hexToBytes(secret!))
    expect(bytesToHex(key)).toBe(v.room_key)
    expect(bytesToHex(sha256(key))).toBe(v.room_lookup_id)
  })
})

describe('seal and open with a region key', () => {
  const regionKey = hexToBytes(vectors.region.location_key)
  const sk = generateSecretKey()
  const message = finalizeEvent(messageInnerTemplate('behind the grate', { x: 1n, y: 2n, z: 3n }, 0, 1), sk) as NostrEvent

  it('a chest sealed to a region’s lock opens with that region’s key', () => {
    const lock = lockOf(regionKey)!
    const sealed = sealEntries([message], lock.pubkey)
    const chest = { name: 'Grate', lockPubkey: lock.pubkey, senderPubkey: sealed.senderPubkey, requires: 'the key of a place', payload: sealed.payload }
    // The reader derives the lock from the key it carries: one lookup.
    const carried = lockOf(regionKey)!
    const opener = openerFor(chest, [], 'me', (l) => (l === carried.pubkey ? { id: 'lock:region:x', itemPubkey: carried.pubkey, secretHex: carried.secretHex } : undefined))
    expect(opener?.by).toBe('key')
    const read = readContents(openWithSecret(chest, opener!.by === 'key' ? opener!.key.secretHex : ''), message.pubkey)
    expect(read[0].body.text).toBe('behind the grate')
  })

  it('a door sealed to a region’s lock gives up its secret to that key', () => {
    const lock = lockOf(regionKey)!
    const secret = newDoorSecret()
    const sealed = sealEntries(roomEntries(secret) as never, lock.pubkey)
    expect(doorSecretWithKey({ senderPubkey: sealed.senderPubkey, payload: sealed.payload }, lock.secretHex)).toBe(secret)
  })

  it('another region’s key does not open it, and is not offered', () => {
    const lock = lockOf(regionKey)!
    const other = lockOfHex(vectors.region_height_5.location_key)!
    const sealed = sealEntries([message], lock.pubkey)
    const chest = { name: 'Grate', lockPubkey: lock.pubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
    expect(openerFor(chest, [], 'me', (l) => (l === other.pubkey ? { id: 'lock:region:y', itemPubkey: other.pubkey, secretHex: other.secretHex } : undefined))).toBeNull()
    expect(() => openWithSecret(chest, other.secretHex)).toThrow()
  })

  it('an item lock still opens as before, ahead of the keyring', () => {
    const item = generateSecretKey()
    const itemPub = bytesToHex(schnorr.getPublicKey(item))
    const sealed = sealEntries([message], itemPub)
    const chest = { name: 'Old', lockPubkey: itemPub, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
    const opener = openerFor(chest, [{ id: 'row', itemPubkey: itemPub, secretHex: bytesToHex(item) }], 'me', () => undefined)
    expect(opener).toEqual({ by: 'key', key: { id: 'row', itemPubkey: itemPub, secretHex: bytesToHex(item) } })
  })
})
