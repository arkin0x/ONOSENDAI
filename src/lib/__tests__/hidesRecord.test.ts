/**
 * hidesRecord.test.ts: the private record of your hides (owner ruling,
 * 2026-11-15): sealed and opened, merged, and split to fit a relay.
 * Every key here is generated for the test.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { v2 as nip44 } from 'nostr-tools/nip44'
import {
  HIDES_KIND,
  MAX_SHARD_CHARS,
  MAX_TOMBSTONES,
  decodeShard,
  emptyRecord,
  encodeShard,
  mergeRecords,
  newRecordKey,
  newestShards,
  openShard,
  planShards,
  pruneGone,
  sameRecord,
  sealShard,
  shardContent,
  shardIndexOf,
  shardPart,
  shardTemplate,
  validEntry,
  type HideEntry,
  type HidesRecord,
} from '../hidesRecord'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '../events'

/** A hash, as real lookup ids, keys and envelope ids are. */
function hex(n: number, salt = 0): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${salt}:${n}`)))
}

function entry(n: number, t = 1_700_000_000 + n, extra: Partial<HideEntry> = {}): HideEntry {
  return {
    l: hex(n), k: hex(n, 1), h: 12 + (n % 8), p: (n % 2) as 0 | 1,
    x: String(123456789012345678901n + BigInt(n) * 7919n), y: String(98765432109876543210n + BigInt(n)), z: String(5555555555555555555n * BigInt(n + 1)),
    n: `shard number ${n}`, c: 1 + (n % 5), t, ...extra,
  }
}

function recordOf(entries: HideEntry[], gone: Record<string, number> = {}): HidesRecord {
  return { e: Object.fromEntries(entries.map((e) => [e.l, e])), x: gone }
}

describe('sealing and opening', () => {
  it('a shard round-trips through deflate, NIP-44 under the record key, and the self-wrapped key', () => {
    const sk = generateSecretKey()
    const me = getPublicKey(sk)
    const rec = recordOf([entry(1), entry(2, undefined, { r: hex(9, 3) })], { [hex(77)]: 1_700_000_500 })
    const key = newRecordKey()
    // Wrapped from you to you: what a signer's nip44Encrypt(me, ...) does.
    const self = nip44.utils.getConversationKey(sk, me)
    const wrapped = nip44.encrypt(bytesToHex(key), self)
    const content = sealShard(encodeShard(rec, 0, 1), key, wrapped)
    // Nothing readable in what leaves the device.
    expect(content).not.toContain(hex(1))
    expect(content).not.toContain('shard number')
    const parts = shardContent(content)!
    const unwrapped = hexToBytes(nip44.decrypt(parts.wrapped, self))
    const back = decodeShard(openShard(parts.body, unwrapped))
    expect(back.i).toBe(0)
    expect(back.k).toBe(1)
    expect(sameRecord(back.rec, rec)).toBe(true)
  })

  it('stays shut to another key, and to another person', () => {
    const key = newRecordKey()
    const content = sealShard(encodeShard(recordOf([entry(1)]), 0, 1), key, 'w')
    expect(() => openShard(shardContent(content)!.body, newRecordKey())).toThrow()
    const other = generateSecretKey()
    const me = getPublicKey(generateSecretKey())
    const wrapped = nip44.encrypt(bytesToHex(key), nip44.utils.getConversationKey(generateSecretKey(), me))
    expect(() => nip44.decrypt(wrapped, nip44.utils.getConversationKey(other, me))).toThrow()
  })

  it('drops a malformed entry alone', () => {
    expect(validEntry({ ...entry(1), k: 'nothex' })).toBeNull()
    expect(validEntry({ ...entry(1), p: 2 })).toBeNull()
    expect(validEntry({ ...entry(1), x: '1e9' })).toBeNull()
    expect(validEntry({ ...entry(1), n: 'x'.repeat(500) })?.n).toHaveLength(48)
    const text = encodeShard(recordOf([entry(1)]), 0, 1)
    const back = decodeShard(text)
    expect(Object.keys(back.rec.e)).toEqual([hex(1)])
  })

  it('the event: kind 30078, only a d tag, read back by its d', () => {
    const t = shardTemplate(3, 'x', 1)
    expect(t.kind).toBe(HIDES_KIND)
    expect(t.tags).toEqual([['d', 'onosendai/hides/3']])
    expect(shardIndexOf(t)).toBe(3)
    expect(shardIndexOf({ kind: HIDES_KIND, tags: [['d', 'other/app']] })).toBe(-1)
    const sk = generateSecretKey()
    const me = getPublicKey(sk)
    const a = finalizeEvent(shardTemplate(0, 'a', 10), sk)
    const b = finalizeEvent(shardTemplate(0, 'b', 11), sk)
    const theirs = finalizeEvent(shardTemplate(0, 'c', 99), generateSecretKey())
    expect(newestShards([a, b, theirs], me).get(0)?.id).toBe(b.id)
  })
})

describe('merging: union, never replace', () => {
  it('keeps everything either side holds', () => {
    const m = mergeRecords(recordOf([entry(1), entry(2)]), recordOf([entry(2), entry(3)]))
    expect(Object.keys(m.e).sort()).toEqual([hex(1), hex(2), hex(3)].sort())
  })

  it('never drops an entry because the other side lacks it', () => {
    const local = recordOf([entry(1), entry(2), entry(3)])
    const m = mergeRecords(emptyRecord(), local)
    expect(sameRecord(m, local)).toBe(true)
  })

  it('a newer tombstone stands over an entry; a newer entry over a tombstone; an entry wins a tie', () => {
    const e = entry(1, 100)
    expect(mergeRecords(recordOf([e]), recordOf([], { [e.l]: 101 })).e[e.l]).toBeUndefined()
    expect(mergeRecords(recordOf([e]), recordOf([], { [e.l]: 101 })).x[e.l]).toBe(101)
    expect(mergeRecords(recordOf([entry(1, 102)]), recordOf([], { [e.l]: 101 })).e[e.l]?.t).toBe(102)
    expect(mergeRecords(recordOf([e]), recordOf([], { [e.l]: 100 })).e[e.l]).toBeDefined()
  })

  it('is the same whichever side is which, and merging twice changes nothing', () => {
    const a = recordOf([entry(1, 5), entry(2, 9, { n: 'a' })], { [hex(3)]: 7 })
    const b = recordOf([entry(2, 9, { n: 'b' }), entry(3, 6)], { [hex(1)]: 4 })
    const ab = mergeRecords(a, b)
    expect(sameRecord(ab, mergeRecords(b, a))).toBe(true)
    expect(sameRecord(mergeRecords(ab, a), ab)).toBe(true)
    // The newer entry for 2 is a tie in time, settled the same way both ways.
    expect(ab.e[hex(2)].n).toBe(mergeRecords(b, a).e[hex(2)].n)
    expect(ab.x[hex(3)]).toBe(7)
    expect(ab.e[hex(1)]).toBeDefined()
  })

  it('keeps tombstones bounded: the newest, and none too old', () => {
    const gone: Record<string, number> = {}
    for (let i = 0; i < MAX_TOMBSTONES + 50; i++) gone[hex(i)] = 1_000_000 + i
    const kept = pruneGone(gone)
    expect(Object.keys(kept)).toHaveLength(MAX_TOMBSTONES)
    expect(kept[hex(0)]).toBeUndefined()
    expect(kept[hex(MAX_TOMBSTONES + 49)]).toBeDefined()
    expect(Object.keys(pruneGone({ [hex(1)]: 0, [hex(2)]: 2_000_000_000 }, 2_000_000_000))).toEqual([hex(2)])
  })
})

describe('size: under the relays\' limits', () => {
  function measure(n: number): { k: number; largest: number; total: number } {
    const sk = generateSecretKey()
    const rec = recordOf(Array.from({ length: n }, (_, i) => entry(i)))
    const plan = planShards(rec)
    const key = newRecordKey()
    // A wrapped key the size a signer gives.
    const wrapped = nip44.encrypt(bytesToHex(key), nip44.utils.getConversationKey(sk, getPublicKey(sk)))
    const sizes = plan.texts.map((t, i) => JSON.stringify(finalizeEvent(shardTemplate(i, sealShard(t, key, wrapped), 1_700_000_000), sk)).length)
    return { k: plan.k, largest: Math.max(...sizes), total: sizes.reduce((a, b) => a + b, 0) }
  }

  it('100 hides: one event, well under 64 KB', () => {
    const m = measure(100)
    console.info(`[hides] 100 hides: ${m.k} shard(s), largest event ${m.largest} B, total ${m.total} B`)
    expect(m.k).toBe(1)
    expect(m.largest).toBeLessThan(64 * 1024)
  })

  it('500 hides: every event under 64 KB', () => {
    const m = measure(500)
    console.info(`[hides] 500 hides: ${m.k} shard(s), largest event ${m.largest} B, total ${m.total} B`)
    expect(m.largest).toBeLessThan(64 * 1024)
  })

  it('2,000 hides split across shards, each under the limit, and read back whole', () => {
    const rec = recordOf(Array.from({ length: 2000 }, (_, i) => entry(i)))
    const plan = planShards(rec)
    expect(plan.k).toBeGreaterThan(1)
    for (const t of plan.texts) expect(t.length).toBeLessThanOrEqual(MAX_SHARD_CHARS)
    let back = emptyRecord()
    for (const t of plan.texts) back = mergeRecords(back, decodeShard(t).rec)
    expect(sameRecord(back, rec)).toBe(true)
  })

  it('a bag goes in one shard, so a new hide changes one shard', () => {
    const rec = recordOf(Array.from({ length: 2000 }, (_, i) => entry(i)))
    const k = planShards(rec).k
    const more = mergeRecords(rec, recordOf([entry(5000)]))
    const changed = Array.from({ length: k }, (_, i) => i).filter((i) => !sameRecord(shardPart(rec, i, k), shardPart(more, i, k)))
    expect(changed).toHaveLength(1)
  })

  it('never fewer shards than the relay\'s copy used', () => {
    expect(planShards(recordOf([entry(1)]), 4).k).toBe(4)
  })
})
