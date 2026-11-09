/**
 * bagFit.test.ts: the bag-aware reference decision, pure (lib/bagFit.ts).
 * A bag is measured exactly without sealing it; the largest of the entries a
 * write is writing goes by reference first; only a shard of the writer's own,
 * signed, is a candidate; and a bag that cannot fit even so is refused.
 */
import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { BAG_SAFE_BYTES, signedBytes } from '../bagSize'
import { bagBytes, growthRefusal, heldBy, planFit, referenceFor, sealFor, sealedLength, withReferences, type FitCandidate } from '../bagFit'
import { encryptForRegion } from '../shardCrypto'
import { CHEST_KIND, DEFAULT_BAG_SETTINGS, KEY_KIND, MESSAGE_KIND, OBJECT_KIND, SHARD_KIND, bagContents, bagTemplate, rumorOf, type BagEntry } from '../hidden'

const sk = generateSecretKey()
const me = getPublicKey(sk)
const key = new Uint8Array(32).fill(7)
const lookupId = 'ab'.repeat(32)
const C = ['C', 'cd'.repeat(32)]
const shard = (bytes: number, signer = sk): BagEntry => finalizeEvent({ kind: SHARD_KIND, created_at: 1_800_000_000, content: 'x'.repeat(bytes), tags: [C, ['-']] }, signer) as BagEntry
const message = (bytes: number): BagEntry => rumorOf({ kind: MESSAGE_KIND, created_at: 1_800_000_000, content: 'm'.repeat(bytes), tags: [C, ['-']] }, me) as BagEntry
const refusedAt = (cap: number) => (es: readonly BagEntry[]): string | null => (bagBytes(es, lookupId, 9, DEFAULT_BAG_SETTINGS) > cap ? 'too large' : null)

describe('measuring a bag without sealing it', () => {
  it('the ciphertext length follows the plaintext, multi-byte text included', async () => {
    for (const text of ['', 'a', 'ab', 'abc', 'é'.repeat(1001), JSON.stringify([shard(5000)])]) {
      expect(sealedLength(text)).toBe((await encryptForRegion(key, text)).length)
    }
  })

  it('bagBytes is the signed size of the bag bagTemplate seals', async () => {
    const entries = [shard(12_000), message(3000), ['a', `${OBJECT_KIND}:${me}:${'0'.repeat(32)}`, 'wss://relay.test', C[1]]]
    const at = 1_800_000_123
    expect(bagBytes(entries, lookupId, 9, DEFAULT_BAG_SETTINGS, undefined, at)).toBe(signedBytes(await bagTemplate(entries, key, lookupId, 9, at)))
  })

  it('growthRefusal: past the cap and larger than before; a shrinking write still goes', () => {
    const big = [message(10)]
    expect(growthRefusal(big, [], BAG_SAFE_BYTES)).toBeNull()
    expect(growthRefusal(big, [], BAG_SAFE_BYTES + 1)).toMatch(/Too large for one bag/)
    expect(growthRefusal(big, [message(20)], BAG_SAFE_BYTES + 1)).toBeNull()
  })
})

describe('which entries go by reference', () => {
  it('only a signed shard of the writer, with its point, is a candidate; its reference names a 33331 at that point', () => {
    const c = referenceFor(shard(100), me, 'd1', 'wss://relay.test')!
    expect(c.ref).toEqual(['a', `${OBJECT_KIND}:${me}:d1`, 'wss://relay.test', C[1]])
    expect(referenceFor(message(100), me, 'd1', '')).toBeNull()
    expect(referenceFor(shard(100, generateSecretKey()), me, 'd1', '')).toBeNull()
    const { sig: _sig, ...unsigned } = shard(100) as Record<string, unknown>
    expect(referenceFor(unsigned as BagEntry, me, 'd1', '')).toBeNull()
    expect(referenceFor(c.ref, me, 'd1', '')).toBeNull()
  })

  it('fits as it is: nothing changes form', () => {
    const entries = [shard(1000), shard(2000)]
    const plan = planFit(entries, entries.flatMap((e, i) => referenceFor(e, me, `d${i}`, '') ?? []), refusedAt(BAG_SAFE_BYTES))
    expect(plan).toEqual({ convert: new Map(), refusal: null })
  })

  it('largest first, and only as many as it takes', () => {
    const entries = [shard(4000), shard(9000), shard(6000)]
    const candidates = entries.map((e, i) => referenceFor(e, me, `d${i}`, '')!) as FitCandidate[]
    const whole = bagBytes(entries, lookupId, 9, DEFAULT_BAG_SETTINGS)
    // Room for everything but about the largest one.
    const plan = planFit(entries, candidates, refusedAt(whole - 9000))
    expect(plan.refusal).toBeNull()
    expect([...plan.convert.keys()]).toEqual([candidates[1].key])
    const written = withReferences(entries, plan.convert)
    expect(written[1]).toEqual(candidates[1].ref)
    expect(written[0]).toBe(entries[0])
    // Tighter: the next largest goes too.
    expect([...planFit(entries, candidates, refusedAt(whole - 14_000)).convert.keys()]).toEqual([candidates[1].key, candidates[2].key])
  })

  it('refused when even every candidate by reference does not fit', () => {
    const entries = [message(20_000), shard(3000)]
    const plan = planFit(entries, [referenceFor(entries[1], me, 'd', '')!], refusedAt(15_000))
    expect(plan.refusal).toBe('too large')
  })
})

describe('sealed entries (spec §7.6 Sealed entries): what may move out, and how it fits', () => {
  const D = '0'.repeat(32)
  const signed = (kind: number, bytes: number, extra: string[][] = []): BagEntry => finalizeEvent({ kind, created_at: 1_800_000_000, content: 'k'.repeat(bytes), tags: [C, ...extra, ['-']] }, sk) as BagEntry
  it('a message, a key item, a chest and a standing shard may; a door, a fresh shard, a stranger’s item, and one smaller than its reference may not', () => {
    const none = new Set<string>()
    expect(sealFor(message(500), me, D, 'wss://r', none)?.form).toBe('sealed')
    expect(sealFor(signed(KEY_KIND, 500), me, D, 'wss://r', none)?.form).toBe('sealed')
    expect(sealFor(signed(CHEST_KIND, 500), me, D, 'wss://r', none)?.form).toBe('sealed')
    expect(sealFor(signed(CHEST_KIND, 500, [['door', '4']]), me, D, 'wss://r', none)).toBeNull()
    const s = shard(500) as { id: string }
    expect(sealFor(s as BagEntry, me, D, 'wss://r', none)).toBeNull()
    expect(sealFor(s as BagEntry, me, D, 'wss://r', new Set([s.id]))?.form).toBe('sealed')
    expect(sealFor(shard(500, generateSecretKey()), me, D, 'wss://r', new Set([(shard(500) as { id: string }).id]))).toBeNull()
    // Any item carries an id and a pubkey, so its reference is smaller; a reference with a very long hint is not.
    expect(sealFor(message(1), me, D, `wss://${'r'.repeat(400)}`, none)).toBeNull()
  })
  it('the reference names the sealed entry’s address, the hint, and the item’s own C; an entry too large for one event stays', () => {
    const c = sealFor(message(500), me, D, 'wss://r', new Set())!
    expect(c.ref).toEqual(['a', `33335:${me}:${D}`, 'wss://r', C[1]])
    expect(sealFor(message(BAG_SAFE_BYTES), me, D, 'wss://r', new Set())).toBeNull()
  })
  it('a bag of messages past a cap fits once its largest move out, largest first; contents count what they hold', () => {
    const es = [message(100), message(9_000), message(4_000), message(9_500)]
    const candidates = es.flatMap((e, i) => sealFor(e, me, i.toString(16).padStart(32, '0'), 'wss://r', new Set()) ?? [])
    const cap = bagBytes(es, lookupId, 9, DEFAULT_BAG_SETTINGS) - 9_000
    const plan = planFit(es, candidates, refusedAt(cap))
    expect(plan.refusal).toBeNull()
    expect([...plan.convert.values()].map((c) => c.bytes)).toEqual([JSON.stringify(es[3]).length])
    const written = withReferences(es, plan.convert)
    expect(bagContents(written, heldBy(plan.convert.values())).message).toBe(4)
    expect(bagContents(written).message).toBe(3)
  })
})

