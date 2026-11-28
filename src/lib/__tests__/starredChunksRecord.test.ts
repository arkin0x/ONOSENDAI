/**
 * starredChunksRecord.test.ts: the private record of your saved chunks (owner,
 * 2026-11-28): merged with tombstones, newest edit winning per part, sealed
 * with only the `d` tag public and no coordinate in the clear. Every key here
 * is generated for the test.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { v2 as nip44 } from 'nostr-tools/nip44'
import {
  MAX_RECORD_CHARS, MAX_ROWS, MAX_STARRED_CHUNKS, STARRED_D, STARRED_KIND, cleanNote, decodeRecord, emptyRecord, encodeRecord, mergeRecords, newRecordKey,
  newestRecord, openRecord, planRecord, recordContent, recordTemplate, sameRecord, sealRecord, validEntry,
  type ChunkSnapshot, type StarEntry, type StarredRecord,
} from '../starredChunksRecord'
import { bytesToHex, type NostrEvent } from '../events'
import { chunkKey } from '../terrain/coords'

const key = (i: number, plane = 0): string => chunkKey({ x: 0x1234567890abcdef12340n + BigInt(i) * 32n, y: 0xfedcba0987654321fed80n, z: 0x0f0f0f0f0f0f0f0f0f0e0n, plane })
const snap = (glow: number): ChunkSnapshot => ({ g: 'volcanic', k: 14, m: 11.2, r: [[42, glow, 0, 1], [7, 40, 3, 0], [1, 9000, 12, 1]], d: '07'.repeat(24) + '00'.repeat(8), v: 1795799000 })
const entry = (i: number, t: number, extra: Partial<StarEntry> = {}): StarEntry => ({ c: key(i), a: t, t, s: snap(2), st: t, ...extra })
const rec = (e: StarEntry[], x: Array<[string, number]> = []): StarredRecord => ({ e: Object.fromEntries(e.map((v) => [v.c, v])), x: Object.fromEntries(x) })

describe('merging', () => {
  it('is a union by chunk key: nothing either side holds is dropped', () => {
    const a = rec([entry(1, 100)])
    const b = rec([entry(2, 200)])
    const m = mergeRecords(a, b)
    expect(Object.keys(m.e).sort()).toEqual([key(1), key(2)].sort())
  })

  it('a tombstone newer than the entry removes it everywhere; an older one does not; an entry wins a tie', () => {
    const e = entry(1, 100)
    expect(mergeRecords(rec([e]), rec([], [[key(1), 150]])).e[key(1)]).toBeUndefined()
    expect(mergeRecords(rec([e]), rec([], [[key(1), 150]])).x[key(1)]).toBe(150)
    expect(mergeRecords(rec([e]), rec([], [[key(1), 50]])).e[key(1)]).toEqual(e)
    expect(mergeRecords(rec([e]), rec([], [[key(1), 100]])).e[key(1)]).toEqual(e)
    // Starred again after the removal: the new star stands.
    expect(mergeRecords(rec([entry(1, 200)]), rec([], [[key(1), 150]])).e[key(1)]?.a).toBe(200)
  })

  it('inside an entry the note and the snapshot each go by their own time: a rename here and a fresh card there both survive', () => {
    const renamed = entry(1, 100, { n: 'Glowcore cave', nt: 300, t: 300 })
    const counted = entry(1, 100, { s: snap(1), st: 400 })
    for (const m of [mergeRecords(rec([renamed]), rec([counted])), mergeRecords(rec([counted]), rec([renamed]))]) {
      expect(m.e[key(1)].n).toBe('Glowcore cave')
      expect(m.e[key(1)].s?.r[0]).toEqual([42, 1, 0, 1])
      // A card counted again is not an edit of the entry: its time stays the rename's.
      expect(m.e[key(1)].t).toBe(300)
    }
    // A cleared note (empty, newer) beats an older one.
    const cleared = entry(1, 100, { nt: 500, t: 500 })
    expect(mergeRecords(rec([renamed]), rec([cleared])).e[key(1)].n).toBeUndefined()
  })

  it('a card counted again on a device that missed a removal never brings the chunk back', () => {
    // Removed on the phone at 200; the desktop, not yet told, mines there at 300 and counts the card again.
    const phone = rec([], [[key(1), 200]])
    const desktop = rec([entry(1, 100, { s: snap(1), st: 300 })])
    expect(mergeRecords(phone, desktop).e[key(1)]).toBeUndefined()
    expect(validEntry({ ...entry(1, 100), st: 300 })?.t).toBe(100)
  })

  it('is commutative, associative and idempotent', () => {
    const a = rec([entry(1, 100), entry(2, 100, { n: 'a', nt: 120, t: 120 })], [[key(3), 90]])
    const b = rec([entry(2, 100, { n: 'b', nt: 130, t: 130 }), entry(3, 80)], [[key(1), 150]])
    const c = rec([entry(4, 300)], [[key(2), 125]])
    expect(sameRecord(mergeRecords(a, b), mergeRecords(b, a))).toBe(true)
    expect(sameRecord(mergeRecords(mergeRecords(a, b), c), mergeRecords(a, mergeRecords(b, c)))).toBe(true)
    const ab = mergeRecords(a, b)
    expect(sameRecord(mergeRecords(ab, ab), ab)).toBe(true)
    // key 2's newest note (130) is newer than its tombstone (125): it stays, as b named it.
    expect(ab.e[key(2)].n).toBe('b')
    expect(ab.e[key(1)]).toBeUndefined()
  })
})

describe('reading', () => {
  it('drops malformed entries one by one and cleans notes', () => {
    expect(validEntry({ c: 'not a key', a: 1, t: 1 })).toBeNull()
    expect(validEntry({ c: key(1), a: -1, t: 1 })).toBeNull()
    // A corner that is not on the chunk grid is not a chunk.
    expect(validEntry({ c: '0:11:20:20', a: 1, t: 1 })).toBeNull()
    const e = validEntry({ c: key(1), a: 10, t: 10, n: '  Glowcore\n  cave  ', nt: 20, s: { g: 'VOLCANIC!', k: 99, r: [[42, 2, 0, 1], ['x'], [0, 1, 1, 1], [42, 5, 0, 0]], d: 'zz' }, st: 15 })
    expect(e?.n).toBe('Glowcore cave')
    expect(e?.t).toBe(20)
    expect(e?.s).toEqual({ g: null, k: null, m: null, r: [[42, 2, 0, 1]], d: '0'.repeat(64), v: 0 })
    expect(cleanNote('x'.repeat(80))).toHaveLength(48)
  })

  it('round-trips through its text, a tombstone newer than its entry winning as merging decides', () => {
    const r = rec([entry(1, 100, { n: 'cave', nt: 110, t: 110 }), entry(2, 200)], [[key(3), 300]])
    expect(sameRecord(decodeRecord(encodeRecord(r)), r)).toBe(true)
    const odd = rec([entry(1, 100)], [[key(1), 200]])
    const back = decodeRecord(encodeRecord(odd))
    expect(back.e[key(1)]).toBeUndefined()
    expect(back.x[key(1)]).toBe(200)
  })

  it('the full list fits one event, with varied cards as full as a snapshot carries', () => {
    // A seeded shuffle: keys far apart, every card different, the most rows a snapshot keeps, long notes.
    // mulberry32: a small seeded generator with no short cycles in its low bits.
    let seed = 7
    const rnd = (n: number): number => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return (((t ^ (t >>> 14)) >>> 0) % n)
    }
    const hex = (n: number): string => Array.from({ length: n }, () => '0123456789abcdef'[rnd(16)]).join('')
    const ids = [197, 192, 196, 43, 195, 194, 193, 42, 7, 12, 8, 13, 14, 41, 40, 9, 10, 11, 6, 3, 5, 4, 2, 1]
    const words = ['Glowcore', 'cave', 'ridge', 'by', 'the', 'shelf', 'north', 'pit', 'deep', 'vein', 'blue', 'cliff', 'home', 'spot']
    const many = rec(Array.from({ length: MAX_STARRED_CHUNKS }, (_, i) => {
      const c = chunkKey({ x: BigInt(`0x${hex(20)}`) << 5n, y: BigInt(`0x${hex(20)}`) << 5n, z: BigInt(`0x${hex(20)}`) << 5n, plane: rnd(2) })
      // Finds in tens, common rock in thousands, as a chunk's card counts them; the core in runs of a few kinds.
      const kinds = ids.filter(() => rnd(3) === 0).concat([2, 1]).slice(-MAX_ROWS)
      const r = kinds.map((id) => [id, id > 6 ? rnd(80) : 1000 + rnd(9000), rnd(40), rnd(2)] as [number, number, number, 0 | 1])
      const band = (): string => ['01', '02', '05', '07', '08', '00'][rnd(6)]
      let d = ''
      while (d.length < 64) { const b = band(); d += b.repeat(1 + rnd(8)) }
      const s: ChunkSnapshot = { g: 'volcanic', k: rnd(17), m: rnd(1600) / 100, r, d: d.slice(0, 64), v: 1795000000 + rnd(9999999) }
      const n = Array.from({ length: 2 + rnd(5) }, () => words[rnd(words.length)]).join(' ')
      return { c, a: 1795000000 + rnd(9999999), t: 1796000000 + i, n, nt: 1796000000 + i, s, st: 1796000000 + rnd(999) }
    }))
    expect(Object.keys(many.e)).toHaveLength(MAX_STARRED_CHUNKS)
    expect(planRecord(many).length).toBeLessThanOrEqual(MAX_RECORD_CHARS)
  })
})

describe('the sealed event', () => {
  it('only the d tag is public, and no chunk key or coordinate is in the clear', () => {
    const sk = generateSecretKey()
    const me = getPublicKey(sk)
    const self = nip44.utils.getConversationKey(sk, me)
    const rk = newRecordKey()
    const wrapped = nip44.encrypt(bytesToHex(rk), self)
    const r = rec([entry(1, 100, { n: 'Glowcore cave', nt: 100 })])
    const ev = finalizeEvent(recordTemplate(sealRecord(planRecord(r), rk, wrapped), 1795800000), sk) as unknown as NostrEvent
    expect(ev.kind).toBe(STARRED_KIND)
    expect(ev.tags).toEqual([['d', STARRED_D]])
    const text = JSON.stringify(ev)
    const c = key(1)
    for (const part of [c, ...c.split(':').slice(1), 'Glowcore', 'volcanic']) expect(text.includes(part)).toBe(false)
    // Opened with the key the signer unwraps, it is the record.
    const parts = recordContent(ev.content)!
    const back = nip44.decrypt(parts.wrapped, self)
    expect(back).toBe(bytesToHex(rk))
    expect(sameRecord(decodeRecord(openRecord(parts.body, rk)), r)).toBe(true)
    expect(newestRecord([ev], me)?.id).toBe(ev.id)
    expect(newestRecord([ev], '0'.repeat(64))).toBeNull()
  })

  it('an empty record still seals to a valid event', () => {
    const text = planRecord(emptyRecord())
    expect(sameRecord(decodeRecord(text), emptyRecord())).toBe(true)
  })
})
