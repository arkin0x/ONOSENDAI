/**
 * locks.ts: the lock of a region or a room (DECK-0004 §3.8, draft; conjunction
 * seals design 2026-11-09 §5.3, slice 1).
 *
 * Every bag key has a lock. A bag key is a region's location key (spec §7.2)
 * or a room key (DECK-0004 §3.7.2). Its lock is a public key a chest or a door
 * can be sealed to, exactly as it is sealed to an item's public key today
 * (DECK-0004 §3.2), so "opens for whoever has been near block 100" works on
 * every existing chest and door code path:
 *
 *   lock_secret = SHA-256( UTF-8("cyberspace:lock") || bag_key )
 *                 read as a 256-bit big-endian integer, a secp256k1 secret key
 *   lock        = its BIP-340 x-only public key, 64 lowercase hex
 *
 * 15 + 32 = 47 bytes in. When the hash is zero or not below the curve order
 * (about one chance in 2^128) that region or room has no lock, and nothing is
 * sealed to it: lockOf returns null. It is never reduced mod n, and the secret
 * is never negated for an odd y: NIP-44's conversation key reads only x.
 *
 * region_n has no plane bit (spec §4.7), so the dataspace and ideaspace
 * regions with the same X, Y, Z and height share one key and one lock.
 *
 * Why not the bag key itself: the bag key is an AES key, and the same 32 bytes
 * as an elliptic-curve secret would reuse one key in two algorithms. The prefix
 * keeps them apart, as "cyberspace:door" does for a room key.
 *
 * Pure and small on purpose: if the spec's final derivation differs, this file
 * is the one place to change. No relay, no store.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from './events'

/** The domain prefix of a lock secret (§3.8): 15 ASCII bytes. */
export const LOCK_KDF_PREFIX = 'cyberspace:lock'

/** The order of secp256k1's group. */
const CURVE_ORDER = secp256k1.Point.CURVE().n

/** A lock: the secret that opens what is sealed to it, and the public key it is sealed to. */
export interface Lock {
  /** The lock secret, 64 lowercase hex: what a holder opens a chest or door with. */
  secretHex: string
  /** The lock, the x-only public key, 64 lowercase hex: a chest's or door's `lock` tag. */
  pubkey: string
}

/** The 47 bytes hashed for a lock secret: the prefix, then the bag key. */
export function lockPreimage(bagKey: Uint8Array): Uint8Array {
  if (bagKey.length !== 32) throw new Error('A lock needs a 32-byte bag key.')
  const prefix = new TextEncoder().encode(LOCK_KDF_PREFIX)
  const input = new Uint8Array(prefix.length + 32)
  input.set(prefix, 0)
  input.set(bagKey, prefix.length)
  return input
}

/** The lock secret of a bag key, or null when the hash is not a valid secret key (zero, or not below the curve order). */
export function lockSecret(bagKey: Uint8Array): Uint8Array | null {
  const h = sha256(lockPreimage(bagKey))
  return isLockSecret(h) ? h : null
}

/** Whether 32 bytes, read big-endian, are a valid secret key: above zero and below the curve order. Never reduced mod n. */
export function isLockSecret(h: Uint8Array): boolean {
  if (h.length !== 32) return false
  const n = BigInt(`0x${bytesToHex(h)}`)
  return n > 0n && n < CURVE_ORDER
}

/** The lock of a bag key (a region's location key or a room key), or null when it has none. */
export function lockOf(bagKey: Uint8Array): Lock | null {
  const secret = lockSecret(bagKey)
  if (!secret) return null
  return { secretHex: bytesToHex(secret), pubkey: bytesToHex(schnorr.getPublicKey(secret)) }
}

/** lockOf, for a bag key as 64 hex characters. */
export function lockOfHex(bagKeyHex: string): Lock | null {
  if (!/^[0-9a-f]{64}$/i.test(bagKeyHex)) return null
  return lockOf(hexToBytes(bagKeyHex.toLowerCase()))
}
