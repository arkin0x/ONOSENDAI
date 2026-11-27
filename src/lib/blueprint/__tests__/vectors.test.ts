/**
 * vectors.test.ts - DECK-0010's own vectors (cyberspace decks/blueprints-vectors.json,
 * copied here as a fixture): the encodings, keys and lookups, the location
 * lock's region key, the gathers, the sheets, the records, the cards and the
 * unsealing order. Keys run at the spec's 500,000 rounds.
 */

import { describe, expect, it } from 'vitest'
import { verifyEvent } from 'nostr-tools/pure'
import vectors from './fixtures/blueprints-vectors.json'
import { arrangementFrom } from '../arrangement'
import { RECORD_MAX_BYTES, canonicalRecord, cardRecord, cardTemplate, deriveKey, encodeArrangement, expandRuns, lookupOf, openPrize, readRecord, readSheetShape, recordRefusal, serializedLength, type RecordEvent, type Sheet } from '../format'
import { BARE_REACH, COMPILER_REACH, rankRecords, smashGroup } from '../smash'
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

  it('gathers (DECK-0010 9e806b1): the group, isolation, the arrangement and its box and lookup, bare-handed and with the Compiler', async () => {
    type G = { name: string; world: Cell4[]; hit: [number, number, number]; bare: boolean; reach: number; group: Cell4[]; isolated: boolean; arrangement: boolean; box?: { x: number; y: number; z: number }; lookup?: string }
    const cases = vectors.gather as unknown as G[]
    expect(cases.length).toBeGreaterThanOrEqual(21)
    expect((vectors.constants as unknown as { reach_compiler: number; reach_bare: number }).reach_compiler).toBe(COMPILER_REACH)
    expect((vectors.constants as unknown as { reach_compiler: number; reach_bare: number }).reach_bare).toBe(BARE_REACH)
    const key = (c: readonly number[]): string => c.slice(0, 3).join(',')
    for (const g of cases) {
      const m = new Map(g.world.map(([x, y, z, id]) => [`${x},${y},${z}`, id]))
      const read = (x: number, y: number, z: number): number => m.get(`${x},${y},${z}`) ?? 0
      expect(g.reach, g.name).toBe(g.bare ? BARE_REACH : COMPILER_REACH)
      // The same gather a smash uses, at that hand's reach.
      const got = smashGroup(read, g.hit, g.bare)
      expect(got.cells.map(key).sort(), g.name).toEqual(g.group.map(key).sort())
      expect(got.isolated, g.name).toBe(g.isolated)
      expect(!!got.arrangement, g.name).toBe(g.arrangement)
      if (g.arrangement && got.arrangement) {
        expect(got.arrangement.size, g.name).toEqual([g.box!.x, g.box!.y, g.box!.z])
        expect(await lookupOf(await deriveKey(encodeArrangement(got.arrangement))), g.name).toBe(g.lookup)
      }
    }
  }, 240_000)

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
    // Every refused record fails by our own check (the signature aside), so a reader drops it whatever signed it.
    const rejects = vectors.record.reject as unknown as Array<{ name: string; event?: RecordEvent }>
    expect(rejects.map((r) => r.name)).toEqual(expect.arrayContaining(['client-tag', 'title-extra-element', 'unknown-sheet-field', 'unknown-prize-field', 'needless-escape', 'whitespace', 'control-character', 'empty-prize-name', 'prize-name-too-long', 'too-large']))
    for (const r of rejects) {
      if (!r.event) continue
      expect(recordRefusal(r.event), r.name).not.toBeNull()
      expect(readRecord(r.event), r.name).toBeNull()
    }
  })

  it('size bounds (§5.2, §10): the worst record at the cap, its card, the chest room left and the sealed entry', () => {
    const sb = vectors.size_bounds as unknown as Record<string, number>
    const Q = (n: number): string => '"'.repeat(n), F = (n: number): string => 'f'.repeat(n)
    const view = 'data:image/png;base64,' + 'A'.repeat(16_384 - 22)
    const pal: Array<number | null> = [0, null]
    for (let i = 1; pal.length < 256; i++) pal.push(i)
    const sheet = { size: { x: 16, y: 16, z: 16 }, pal, cells: [0, -4095], lock: 'location', height: 85, prize: { reveal: 'render', text: Q(280), name: Q(64), views: { x: view, y: view, z: view, iso: view } } }
    const recAt = (n: number, quotes: boolean): RecordEvent => ({
      id: F(64), pubkey: F(64), created_at: 9999999999, kind: 33343,
      tags: [['d', F(64)], ['version', '1'], ['encrypted', 'aes-256-gcm', 'A'.repeat(n), 'cyberspace:blueprint'], ['title', quotes ? Q(64) : 'a'.repeat(64)], ['alt', quotes ? Q(280) : 'a'.repeat(280)], ['no-broadcast']],
      content: JSON.stringify(quotes ? sheet : { ...sheet, prize: { ...sheet.prize, text: 'a'.repeat(280), name: 'a'.repeat(64) } }), sig: F(128),
    })
    const bytes = (t: string): number => new TextEncoder().encode(t).length
    let lo = 0, hi = 200_000
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (serializedLength(recAt(m, true)) <= RECORD_MAX_BYTES) lo = m; else hi = m - 1 }
    const R = canonicalRecord(recAt(lo, true))
    const esc = (t: string): number => [...t].filter((c) => c === '"' || c === '\\').length
    expect(bytes(R)).toBe(sb.record_bytes)
    expect(esc(canonicalRecord(recAt(lo, false)))).toBe(sb.structural_escapes)
    expect(esc(R)).toBe(sb.escapes)
    // The card as this client writes it (cardTemplate: C, the protected marker, a lineage d), serialized canonically.
    const t = cardTemplate(recAt(lo, true), F(64), 9999999999, F(64))
    expect(t.content).toBe(R)
    const card = canonicalRecord({ id: F(64), pubkey: F(64), created_at: t.created_at, kind: t.kind, tags: t.tags, content: t.content, sig: F(128) })
    expect(bytes(card)).toBe(sb.card_bytes)
    expect(bytes(card) - bytes(R) - esc(R)).toBe(sb.card_own_fields)
    expect(131_072 - bytes(`[${card}]`)).toBe(sb.chest_room_left)
    expect(sb.sealed_entry_bytes).toBeLessThanOrEqual(240_000)
    expect(bytes(R) + 8 * (64 + 280 + 280 + 64)).toBe(sb.relay_worst_bytes)
  })

  it('cards carry the record unchanged; an altered record does not verify; a card not in the canonical serialization is dropped', () => {
    const c = vectors.card as unknown as Record<string, { event: RecordEvent }>
    expect(cardRecord(c.reject_not_canonical.event)).toBeNull()
    // Its record is fine: only the card's serialization of it is not.
    const inside = JSON.parse(c.reject_not_canonical.event.content) as RecordEvent
    expect(recordRefusal(inside)).toBeNull()
    expect(canonicalRecord(inside)).not.toBe(c.reject_not_canonical.event.content)
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
