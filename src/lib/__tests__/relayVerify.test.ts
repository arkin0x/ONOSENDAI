/**
 * relayVerify.test.ts: the pool's signature check runs Schnorr once per
 * signature, and a repeat is still held to its id (lib/relay.ts verifiedSigs).
 */

import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const checks = vi.hoisted(() => ({ n: 0 }))
vi.mock('nostr-tools/pure', async (original) => {
  const real = await original<typeof import('nostr-tools/pure')>()
  return { ...real, verifyEvent: (e: Parameters<typeof real.verifyEvent>[0]) => { checks.n++; return real.verifyEvent(e) } }
})

const { verifyRelayEvent } = await import('../relay')

/** A fresh copy, as a second subscription's JSON.parse hands it over. */
const copy = <T>(e: T): T => JSON.parse(JSON.stringify(e)) as T

function signed(content: string, sk = generateSecretKey()) {
  return copy(finalizeEvent({ kind: 3333, created_at: 1_760_000_000, tags: [['A', 'hop']], content }, sk))
}

describe('verifyRelayEvent', () => {
  it('checks a signature once: the same event again passes without a second Schnorr check', () => {
    const ev = signed('once')
    const before = checks.n
    expect(verifyRelayEvent(copy(ev))).toBe(true)
    expect(checks.n).toBe(before + 1)
    expect(verifyRelayEvent(copy(ev))).toBe(true)
    expect(verifyRelayEvent(copy(ev))).toBe(true)
    expect(checks.n).toBe(before + 1)
  })

  it('a repeat whose fields no longer hash to its id is refused, whatever was checked before', () => {
    const ev = signed('original')
    expect(verifyRelayEvent(copy(ev))).toBe(true)
    expect(verifyRelayEvent({ ...copy(ev), content: 'forged' })).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), pubkey: getPublicKey(generateSecretKey()) })).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), created_at: ev.created_at + 1 })).toBe(false)
  })

  it('a bad signature is never remembered: every copy is checked and refused', () => {
    const ev = signed('bad')
    const bad = { ...copy(ev), sig: ev.sig.slice(0, -2) + (ev.sig.endsWith('00') ? '11' : '00') }
    const before = checks.n
    expect(verifyRelayEvent(copy(bad))).toBe(false)
    expect(verifyRelayEvent(copy(bad))).toBe(false)
    expect(checks.n).toBe(before + 2)
    // The good one is still good afterwards.
    expect(verifyRelayEvent(copy(ev))).toBe(true)
  })

  it('another signature over the same id is checked in full', () => {
    const sk = generateSecretKey()
    const a = signed('same', sk)
    const b = signed('same', sk)
    // Schnorr signing is randomised: same id, different signature.
    expect(b.id).toBe(a.id)
    expect(b.sig).not.toBe(a.sig)
    expect(verifyRelayEvent(copy(a))).toBe(true)
    const before = checks.n
    expect(verifyRelayEvent(copy(b))).toBe(true)
    expect(checks.n).toBe(before + 1)
  })
})
