/**
 * relayVerify.test.ts: the pool's signature check runs Schnorr once per
 * signature, and a repeat is still held to its id (lib/relay.ts verifiedSigs).
 */

import { describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, verifiedSymbol } from 'nostr-tools/pure'

const checks = vi.hoisted(() => ({ n: 0 }))
vi.mock('nostr-tools/pure', async (original) => {
  const real = await original<typeof import('nostr-tools/pure')>()
  return { ...real, verifyEvent: (e: Parameters<typeof real.verifyEvent>[0]) => { checks.n++; return real.verifyEvent(e) } }
})

const { verifyRelayEvent } = await import('../relay')
const { keptBodies } = await import('../verifiedSigs')

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

  it('an event with no signature, or not a string one, is refused, however right its id (review of #405)', () => {
    type Ev = Parameters<typeof verifyRelayEvent>[0]
    const fields = { kind: 3333, created_at: 1_760_000_001, tags: [['A', 'hop']], content: 'forged', pubkey: getPublicKey(generateSecretKey()) }
    const id = getEventHash(fields as Parameters<typeof getEventHash>[0])
    const unsigned = { ...fields, id } as unknown as Ev
    expect(verifyRelayEvent(unsigned)).toBe(false)
    expect((unsigned as unknown as Record<symbol, unknown>)[verifiedSymbol]).not.toBe(true)
    // Again, in case the first refusal left anything behind.
    expect(verifyRelayEvent({ ...fields, id } as unknown as Ev)).toBe(false)
    expect(verifyRelayEvent({ ...fields, id, sig: null } as unknown as Ev)).toBe(false)
    expect(verifyRelayEvent({ ...fields, id, sig: 7 } as unknown as Ev)).toBe(false)
    // A real event, checked once, then sent again with its signature taken away or its id not a string.
    const ev = signed('stripped')
    expect(verifyRelayEvent(copy(ev))).toBe(true)
    const { sig: _gone, ...bare } = copy(ev)
    expect(verifyRelayEvent(bare as unknown as Ev)).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), sig: undefined } as unknown as Ev)).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), id: 42 } as unknown as Ev)).toBe(false)
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

describe('a repeat compared with the fields that were checked, not hashed again (owner\'s phone walk, 2026-11-21)', () => {
  it('a copy of a checked event passes without its id being recomputed', async () => {
    const pure = await import('nostr-tools/pure')
    const ev = signed('x'.repeat(9_000))
    expect(verifyRelayEvent(copy(ev))).toBe(true)
    const spy = vi.spyOn(pure, 'getEventHash')
    for (let i = 0; i < 20; i++) expect(verifyRelayEvent(copy(ev))).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    // The control: a body too big to keep is hashed at every repeat, so the spy does see a hash.
    const big = signed('y'.repeat(250_000))
    expect(verifyRelayEvent(copy(big))).toBe(true)
    expect(verifyRelayEvent(copy(big))).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('keeps bodies within their budget, counting every tag, and the count never drifts', () => {
    const sk = generateSecretKey()
    // Many empty tags are not free: 5,000 tags of one empty value count at least two each.
    const before = keptBodies().chars
    const tagged = copy(finalizeEvent({ kind: 3333, created_at: 1_760_000_002, tags: Array.from({ length: 5_000 }, () => ['']), content: '' }, sk))
    expect(verifyRelayEvent(tagged)).toBe(true)
    expect(keptBodies().chars - before).toBeGreaterThanOrEqual(10_000)
    // About 120,000 counted characters each: a hundred of them pass the 8,000,000 budget, so the oldest go.
    for (let i = 0; i < 100; i++) expect(verifyRelayEvent(signed(`${i}:${'z'.repeat(120_000)}`, sk))).toBe(true)
    const { count, chars } = keptBodies()
    expect(chars).toBeLessThanOrEqual(8_000_000)
    expect(chars).toBeGreaterThan(7_000_000)
    expect(count).toBeLessThan(100)
  })

  it('a copy that differs in any field, a tag, a tag value, or a type, is refused as before', () => {
    const ev = signed('fields')
    expect(verifyRelayEvent(copy(ev))).toBe(true)
    expect(verifyRelayEvent({ ...copy(ev), content: 'fieldz' })).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), kind: 3334 })).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), created_at: String(ev.created_at) } as never)).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), tags: [['A', 'hop'], ['x']] })).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), tags: [['A', 'hip']] })).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), tags: [['A']] })).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), tags: [] })).toBe(false)
    expect(verifyRelayEvent({ ...copy(ev), pubkey: getPublicKey(generateSecretKey()) })).toBe(false)
    // And the real one still passes after all of those.
    expect(verifyRelayEvent(copy(ev))).toBe(true)
  })

  it('changing the event that was checked does not change what a later copy is compared with', () => {
    const ev = signed('kept')
    const first = copy(ev)
    expect(verifyRelayEvent(first)).toBe(true)
    first.tags[0][1] = 'forged'
    first.tags.push(['p', 'x'])
    ;(first as { content: string }).content = 'forged'
    expect(verifyRelayEvent({ ...copy(ev), content: 'forged', tags: [['A', 'forged'], ['p', 'x']] })).toBe(false)
    expect(verifyRelayEvent(copy(ev))).toBe(true)
  })

  it('an object already marked verified is not taken as the fields to compare with', () => {
    const ev = signed('premarked')
    const forged = { ...copy(ev), content: 'forged' } as Record<string | symbol, unknown>
    forged[verifiedSymbol] = true
    // verifyEvent trusts the mark, as nostr-tools always has; what it lets through must not vouch for another copy.
    verifyRelayEvent(forged as never)
    expect(verifyRelayEvent({ ...copy(ev), content: 'forged' })).toBe(false)
    expect(verifyRelayEvent(copy(ev))).toBe(true)
  })
})

describe('an event signed here comes back from the relays without a second check (owner\'s phone walk, 2026-11-21)', () => {
  it('its copies pass with neither a Schnorr check nor a hash', async () => {
    const pure = await import('nostr-tools/pure')
    const { signedHere } = await import('../verifiedSigs')
    const ev = finalizeEvent({ kind: 3333, created_at: 1_760_000_003, tags: [['A', 'hop']], content: 'z'.repeat(9_000) }, generateSecretKey())
    signedHere(ev)
    const before = checks.n
    const spy = vi.spyOn(pure, 'getEventHash')
    for (let i = 0; i < 16; i++) expect(verifyRelayEvent(copy(ev))).toBe(true)
    expect(checks.n).toBe(before)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    // A forged copy under its id and signature is still refused.
    expect(verifyRelayEvent({ ...copy(ev), content: 'forged' })).toBe(false)
  })

  it('the store remembers every event it signs or checks from a signer (useCyberspace signEvent, checkedAnswer)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const text = fs.readFileSync(path.resolve(__dirname, '../../store/useCyberspace.ts'), 'utf8')
    expect(text).toMatch(/const own = await signer\.signEvent\(template\)\n\s*verifiedSigs\.add\([^\n]*\)\n\s*signedHere\(own\)/)
    expect(text).toMatch(/signerHome\(signer\)\n\s*signedHere\(signed\)\n\s*return signed/)
  })
})
