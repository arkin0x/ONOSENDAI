/**
 * miningRecord.test.ts: the MINING record (owner, 2026-11-27). Its event
 * shows only its `d`; its content is sealed as the hidden list's is; two
 * devices' counts merge as a G-counter (per device, per number, the larger),
 * so concurrent increments are never lost; firsts take the earlier, bests
 * the larger, days are a union; and nothing in it names a place.
 */

import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { v2 as nip44 } from 'nostr-tools/nip44'
import {
  COUNTERS, MINING_D, MINING_KIND, currentStreak, daysActive, decodeRecord, emptyDevice, emptyRecord, encodeRecord, longestStreak, mergeRecords,
  newDeviceId, newRecordKey, newestRecord, normalDays, openRecord, rarestMined, rarityOf, recordContent, recordTemplate, sameRecord, sealRecord,
  topMined, totalsOf, validRecord, withDay, type MiningRecord,
} from '../miningRecord'
import { bytesToHex, type NostrEvent } from '../events'
import { inflateSync, strFromU8 } from 'fflate'
import { fromBase64 } from '../hidesRecord'

const A = 'a1a1a1a1a1a1a1a1'
const B = 'b2b2b2b2b2b2b2b2'

function rec(devices: MiningRecord['devices'], extra: Partial<MiningRecord> = {}): MiningRecord {
  return { ...emptyRecord(), devices, ...extra }
}

describe('the event', () => {
  it('is kind 30078 with only the d tag public, and its content sealed: the record key wrapped to self, the body under it', () => {
    const sk = generateSecretKey()
    const me = getPublicKey(sk)
    const self = nip44.utils.getConversationKey(sk, me)
    const key = newRecordKey()
    const wrapped = nip44.encrypt(bytesToHex(key), self)
    const r = rec({ [A]: { c: { surveys: 3, mined: 40 }, k: { 1: 30, 42: 10 }, u: 1_790_000_000 } }, { first: { survey: 1_790_000_000 } })
    const t = recordTemplate(sealRecord(encodeRecord(r), key, wrapped), 1_790_000_100)
    expect(t.kind).toBe(MINING_KIND)
    expect(t.tags).toEqual([['d', MINING_D]])
    expect(MINING_D).toBe('onosendai/mining')
    // Nothing readable: no counter name, no number.
    for (const word of ['surveys', 'mined', 'devices', A, '1790000000']) expect(t.content).not.toContain(word)
    const c = recordContent(t.content)!
    expect(c.wrapped).toBe(wrapped)
    // One decrypt opens the key; the key opens the body.
    const opened = nip44.decrypt(c.wrapped, self)
    expect(opened).toBe(bytesToHex(key))
    expect(sameRecord(decodeRecord(openRecord(c.body, key)), r)).toBe(true)
  })

  it('the newest of the author\'s own events stands; another author\'s or another d is never it', () => {
    const me = 'f'.repeat(64)
    const ev = (id: string, at: number, pubkey = me, d = MINING_D): NostrEvent => ({ id, pubkey, created_at: at, kind: MINING_KIND, tags: [['d', d]], content: '', sig: '' })
    const list = [ev('1'.repeat(64), 10), ev('2'.repeat(64), 20), ev('3'.repeat(64), 30, 'e'.repeat(64)), ev('4'.repeat(64), 40, me, 'onosendai/hides/0')]
    expect(newestRecord(list, me)?.id).toBe('2'.repeat(64))
  })

  it('a malformed record drops only what is wrong in it', () => {
    const r = validRecord({ devices: { [A]: { c: { surveys: 2, mined: -1, placed: 1.5, bogus: 9 }, k: { 1: 3, 0: 4, 300: 1, x: 2 }, u: 5 }, nope: { c: { surveys: 1 } } }, first: { survey: 'x' }, best: { streak: 3 }, days: [[5, 3], [1, 2], 'z'] })
    // `bogus` is a well-formed count under a name this version does not know: a newer client's, carried through.
    expect(r.devices).toEqual({ [A]: { c: { surveys: 2, bogus: 9 }, k: { 1: 3 }, u: 5 } })
    expect(r.first).toEqual({})
    expect(r.best).toEqual({ streak: 3 })
    expect(r.days).toEqual([[1, 2]])
    expect(() => decodeRecord(encodeRecord(r).slice(0, 4))).toThrow()
  })

  it('every counter round-trips', () => {
    const c = Object.fromEntries(COUNTERS.map((n, i) => [n, i + 1]))
    const r = rec({ [A]: { c, k: { 197: 1 }, u: 9 } })
    expect(decodeRecord(encodeRecord(r)).devices[A].c).toEqual(c)
    expect(isHex16(newDeviceId())).toBe(true)
  })
})

const isHex16 = (s: string): boolean => /^[0-9a-f]{16}$/.test(s)

describe('the G-counter merge', () => {
  it('two devices counting at the same time: the sum of both, nothing lost, in either order', () => {
    const base = rec({ [A]: { c: { surveys: 5 }, k: { 1: 2 }, u: 1 }, [B]: { c: { surveys: 3 }, k: {}, u: 1 } })
    // A surveys twice and mines a Glowcore; meanwhile B surveys once, each from the same copy.
    const onA = rec({ ...base.devices, [A]: { c: { surveys: 7, mined: 1 }, k: { 1: 2, 42: 1 }, u: 2 } })
    const onB = rec({ ...base.devices, [B]: { c: { surveys: 4 }, k: {}, u: 3 } })
    const ab = mergeRecords(onA, onB)
    const ba = mergeRecords(onB, onA)
    expect(sameRecord(ab, ba)).toBe(true)
    const t = totalsOf(ab)
    expect(t.c.surveys).toBe(11)
    expect(t.c.mined).toBe(1)
    expect(t.k[42]).toBe(1)
    expect(ab.devices[B].u).toBe(3)
  })

  it('is idempotent and associative: an old copy merged again changes nothing', () => {
    const x = rec({ [A]: { c: { mined: 4 }, k: { 1: 4 }, u: 1 } })
    const y = rec({ [A]: { c: { mined: 9 }, k: { 1: 9 }, u: 2 } })
    const z = rec({ [B]: { c: { placed: 2 }, k: {}, u: 1 } })
    expect(sameRecord(mergeRecords(y, x), y)).toBe(true)
    expect(sameRecord(mergeRecords(mergeRecords(x, y), z), mergeRecords(x, mergeRecords(y, z)))).toBe(true)
    expect(totalsOf(mergeRecords(mergeRecords(x, y), x)).c.mined).toBe(9)
  })

  it('firsts take the earlier, bests the larger, days the union', () => {
    const x = rec({}, { first: { survey: 200, compiler: 900 }, best: { streak: 4 }, days: [[10, 12]] })
    const y = rec({}, { first: { survey: 100 }, best: { streak: 2 }, days: [[13, 13], [20, 21]] })
    const m = mergeRecords(x, y)
    expect(m.first).toEqual({ survey: 100, compiler: 900 })
    expect(m.best).toEqual({ streak: 4 })
    expect(m.days).toEqual([[10, 13], [20, 21]])
    expect(sameRecord(m, mergeRecords(y, x))).toBe(true)
  })
})

describe('days and streaks', () => {
  it('runs join; days active counts each day once; the streak ends today or yesterday', () => {
    let days = withDay([], 100)
    days = withDay(days, 101)
    days = withDay(days, 101)
    days = withDay(days, 105)
    expect(days).toEqual([[100, 101], [105, 105]])
    const r = { days, best: {} }
    expect(daysActive(r)).toBe(3)
    expect(currentStreak(r, 105)).toBe(1)
    expect(currentStreak(r, 102)).toBe(2)
    expect(currentStreak(r, 103)).toBe(0)
    expect(longestStreak(r)).toBe(2)
    expect(longestStreak({ days, best: { streak: 9 } })).toBe(9)
    expect(normalDays(Array.from({ length: 2500 }, (_, i) => [i * 3, i * 3] as [number, number]))).toHaveLength(2000)
  })
})

describe('rarity', () => {
  it('the rare band by the owner\'s targets, then the veins; the ground has none', () => {
    expect(rarityOf(197)).toBe(1 / 10000)
    expect(rarityOf(193)).toBe(1 / 500)
    expect(rarityOf(42)!).toBeLessThan(rarityOf(40)!)
    expect(rarityOf(1)).toBeNull()
    expect(rarestMined({ 1: 300, 40: 2, 42: 1 })).toBe(42)
    expect(rarestMined({ 1: 300, 2: 5 })).toBeNull()
    expect(rarestMined({ 42: 1, 197: 1, 193: 3 })).toBe(197)
    expect(topMined({ 1: 3, 2: 9, 42: 1, 3: 3 }, 3)).toEqual([[2, 9], [1, 3], [3, 3]])
  })
})

describe('privacy', () => {
  it('a device entry this client makes holds counts, block kinds and a time; fields another client wrote are only carried, never added to', () => {
    const d = { ...emptyDevice(), c: { surveys: 1 }, k: { 1: 1 } }
    expect(Object.keys(d).sort()).toEqual(['c', 'k', 'u'])
    expect(Object.keys(JSON.parse(strFromU8(inflateSync(fromBase64(encodeRecord(rec({ [A]: d }))))))).sort()).toEqual(['best', 'days', 'devices', 'first', 'v'])
    // A newer client's fields come back exactly as read, at the same place, and nothing else.
    const r = validRecord({ devices: { [A]: { ...d, note: 'n' } }, extra: 2 })
    const back = JSON.parse(strFromU8(inflateSync(fromBase64(encodeRecord(r)))))
    expect(back.devices[A]).toEqual({ note: 'n', c: { surveys: 1 }, k: { 1: 1 }, u: 0 })
    expect(back.extra).toBe(2)
    // A name that is not a field name is never carried.
    expect(validRecord({ devices: {}, 'a b': 1, __proto__x: 2 }).x).toBeUndefined()
  })
})
