/**
 * vectors.test.ts - DECK-0010's own vectors (cyberspace decks/blueprints-vectors.json,
 * copied here as a fixture): the encodings, keys and lookups, the location
 * lock's region key, the gathers, the sheets, the records, the cards and the
 * unsealing order. Keys run at the spec's 500,000 rounds.
 */

import { describe, expect, it } from 'vitest'
import { verifyEvent } from 'nostr-tools/pure'
import vectors from './fixtures/blueprints-vectors.json'
import { arrangementFrom, gather } from '../arrangement'
import { cardRecord, deriveKey, encodeArrangement, expandRuns, lookupOf, openPrize, readSheetShape, recordRefusal, type RecordEvent, type Sheet } from '../format'
import { rankRecords } from '../smash'
import { regionKeyAt } from '../../shardCrypto'
import { bytesToHex, hexToBytes } from '../../events'

type Cell4 = [number, number, number, number]
const arr = (cells: Cell4[]) => arrangementFrom(cells.map(([x, y, z, id]) => ({ at: [x, y, z] as const, id })))!

describe('DECK-0010 vectors', () => {
  it('encodings, keys and lookups', async () => {
    for (const a of vectors.arrangements as unknown as Array<{ name: string; cells: Cell4[]; encoding?: string; encoding_sha256?: string; key: string; lookup: string }>) {
      const e = encodeArrangement(arr(a.cells))
      // Long encodings are given by their SHA-256.
      if (a.encoding) expect(bytesToHex(e), a.name).toBe(a.encoding)
      else expect(bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(e)))), a.name).toBe(a.encoding_sha256)
      const key = await deriveKey(e)
      expect(bytesToHex(key), a.name).toBe(a.key)
      expect(await lookupOf(key), a.name).toBe(a.lookup)
    }
  }, 60_000)

  it('the location lock: the region key of the height holding the box', async () => {
    const loc = vectors.location as unknown as Record<string, { region: { base: Record<string, string>; height: number; region_key: string }; cells: Cell4[]; encoding: string; key: string; lookup: string }>
    for (const name of ['h5', 'h6']) {
      const v = loc[name]
      const b = v.region.base
      const rk = regionKeyAt({ x: BigInt(b.x), y: BigInt(b.y), z: BigInt(b.z) }, v.region.height, 12).key
      expect(bytesToHex(rk), name).toBe(v.region.region_key)
      const e = encodeArrangement(arr(v.cells), rk)
      expect(bytesToHex(e), name).toBe(v.encoding)
      const key = await deriveKey(e)
      expect(await lookupOf(key), name).toBe(v.lookup)
    }
  }, 60_000)

  it('gathers: the group, isolation and the lookup', async () => {
    for (const g of vectors.gather as unknown as Array<{ name: string; world: Cell4[]; hit: [number, number, number]; smashed: Cell4[]; isolated: boolean; lookup?: string | null }>) {
      const m = new Map(g.world.map(([x, y, z, id]) => [`${x},${y},${z}`, id]))
      const read = (x: number, y: number, z: number): number => m.get(`${x},${y},${z}`) ?? 0
      const got = gather(read, g.hit)
      const key = (c: readonly number[]): string => c.slice(0, 3).join(',')
      expect(got.cells.map(key).sort(), g.name).toEqual(g.smashed.map(key).sort())
      expect(got.isolated, g.name).toBe(g.isolated)
      if (g.isolated && g.lookup) expect(await lookupOf(await deriveKey(encodeArrangement(got.arrangement!))), g.name).toBe(g.lookup)
    }
  }, 120_000)

  it('sheets: accepted and refused', () => {
    for (const s of vectors.sheets.accept as unknown as Array<{ name: string; size: Sheet['size']; pal: Sheet['pal']; cells: number[]; expanded: Array<number | null> }>) {
      expect(readSheetShape(s), s.name).toEqual(s.expanded)
      expect(expandRuns(s.cells, s.size.x * s.size.y * s.size.z, s.pal.length)).not.toBeNull()
    }
    for (const s of vectors.sheets.reject as unknown as Array<{ name: string; sheet: Partial<Sheet> }>) expect(readSheetShape(s.sheet), s.name).toBeNull()
  })

  it('records: the standard and location records pass and open with their key; the refused ones fail', async () => {
    for (const name of ['standard', 'location'] as const) {
      const r = (vectors.record as unknown as Record<string, { event: RecordEvent; key: string; prize?: unknown }>)[name]
      expect(verifyEvent(r.event as Parameters<typeof verifyEvent>[0]), name).toBe(true)
      expect(recordRefusal(r.event), name).toBeNull()
      const sealed = r.event.tags.find((t) => t[0] === 'encrypted')![2]
      const opened = await openPrize(hexToBytes(r.key), sealed)
      expect(opened, name).not.toBeNull()
      if (r.prize) expect(opened, name).toEqual(r.prize)
    }
    for (const r of vectors.record.reject as unknown as Array<{ name: string; event?: RecordEvent }>) {
      if (!r.event) continue
      const ok = verifyEvent(r.event as Parameters<typeof verifyEvent>[0]) && recordRefusal(r.event) === null
      expect(ok, r.name).toBe(false)
    }
  })

  it('cards carry the record unchanged; an altered record does not verify', () => {
    const c = vectors.card as unknown as Record<string, { event: RecordEvent }>
    for (const name of ['by_creator', 'copy_by_finder']) {
      const rec = cardRecord(c[name].event)
      expect(rec, name).not.toBeNull()
      expect(verifyEvent(rec as Parameters<typeof verifyEvent>[0]), name).toBe(true)
    }
    const bad = cardRecord(c.reject_altered.event)
    expect(!bad || !verifyEvent(bad as Parameters<typeof verifyEvent>[0])).toBe(true)
  })

  it('unsealing order', () => {
    const r = vectors.rank as unknown as { reader: string; follows: string[]; mutes: string[]; records: RecordEvent[]; order: string[] }
    // The order vector checks ranking alone: rankRecords also checks each record, so it ranks the spec's minimal rows by the same rule.
    const deps = { me: () => r.reader, follows: () => new Set(r.follows), muted: () => new Set(r.mutes) }
    const lookup = 'a'.repeat(64)
    const full = r.records.map((x) => ({ ...x, kind: 33343, content: JSON.stringify({ size: { x: 1, y: 1, z: 1 }, pal: [null], cells: [0], lock: 'standard', prize: { reveal: 'hidden' } }), tags: [['d', lookup], ['version', '1'], ['encrypted', 'aes-256-gcm', 'x', 'cyberspace:blueprint']] }))
    expect(rankRecords(full, lookup, deps).map((x) => x.id)).toEqual(r.order)
  })
})
