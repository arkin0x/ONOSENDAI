/**
 * inventoryRecord.test.ts: the TERRAIN inventory's synced record (owner,
 * 2026-11-28): its format, the PN-counter merge per device, the honor
 * system's debt, the Compiler's grow-only flag, and the record as TERRAIN's
 * inventory.
 */

import { describe, expect, it } from 'vitest'
import {
  CHARGE, COMPILER, INVENTORY_D, INVENTORY_KIND, collectedKinds, decodeRecord, deltaFromInventory, deltaOf, emptyRecord, encodeRecord, heldOf, inventoryFrom,
  RETIRE_AT, RETIRE_IDLE_S, RETIRE_TO, foldIdle, isRetired, mergeRecords, newestRecord, planRecord, recordTemplate, sameRecord, totalsOf, validRecord, withDelta, type InventoryRecord,
} from '../inventoryRecord'
import { COMPILER_ID, QUARRY_ID, emptyInventory, tidyInventory, withCharges, withCompiler, type Inventory } from '../terrain/terrainDb'
import type { NostrEvent } from '../events'

const A = 'aaaaaaaaaaaaaaaa'
const B = 'bbbbbbbbbbbbbbbb'
const C = 'cccccccccccccccc'
const T0 = 1_790_000_000

const gain = (r: InventoryRecord, dev: string, item: string, n: number, t = T0): InventoryRecord => withDelta(r, dev, { add: { [item]: n }, spend: {}, compiler: false }, t)
const spend = (r: InventoryRecord, dev: string, item: string, n: number, t = T0): InventoryRecord => withDelta(r, dev, { add: {}, spend: { [item]: n }, compiler: false }, t)

describe('the event', () => {
  it('kind 30078, d onosendai/inventory, and the d tag alone', () => {
    const t = recordTemplate('1:wrapped:body', T0)
    expect(t.kind).toBe(INVENTORY_KIND)
    expect(INVENTORY_KIND).toBe(30078)
    expect(t.tags).toEqual([['d', INVENTORY_D]])
    expect(INVENTORY_D).toBe('onosendai/inventory')
  })

  it('round-trips through its text, v 1, and refuses what is not one', () => {
    let r = gain(emptyRecord(), A, '3', 12)
    r = spend(r, A, '3', 2)
    r = gain(r, A, CHARGE, 7)
    r = withDelta(r, B, { add: {}, spend: {}, compiler: true }, T0 + 5)
    const back = decodeRecord(encodeRecord(r))
    expect(sameRecord(back, r)).toBe(true)
    expect(back.tools[COMPILER]).toBe(T0 + 5)
    expect(() => planRecord(r)).not.toThrow()
  })

  it('the newest of this author\'s record events, ties to the lowest id; another d or author ignored', () => {
    const me = 'f'.repeat(64)
    const ev = (id: string, created_at: number, d = INVENTORY_D, pubkey = me): NostrEvent => ({ id, pubkey, created_at, kind: INVENTORY_KIND, tags: [['d', d]], content: '', sig: '' })
    expect(newestRecord([ev('b', 5), ev('a', 5), ev('c', 4), ev('d', 9, 'onosendai/mining'), ev('e', 9, INVENTORY_D, 'e'.repeat(64))], me)?.id).toBe('a')
  })
})

describe('the PN merge', () => {
  it('two devices adding and spending at once: every gain and every spend counts', () => {
    // Both start from what A had synced: 10 of kind 3.
    const base = gain(emptyRecord(), A, '3', 10)
    let a = spend(base, A, '3', 4)
    a = gain(a, A, '7', 2)
    let b = gain(base, B, '3', 5)
    b = spend(b, B, '3', 3)
    const m = mergeRecords(a, b)
    expect(totalsOf(m)).toEqual({ 3: 10 - 4 + 5 - 3, 7: 2 })
    // Either order, the same.
    expect(sameRecord(m, mergeRecords(b, a))).toBe(true)
  })

  it('idempotent and associative: merging again, or in any grouping, changes nothing', () => {
    const a = gain(emptyRecord(), A, '3', 4)
    const b = spend(gain(emptyRecord(), B, '3', 9), B, '3', 1)
    const c = gain(emptyRecord(), C, CHARGE, 7)
    const ab = mergeRecords(a, b)
    expect(sameRecord(mergeRecords(ab, ab), ab)).toBe(true)
    expect(sameRecord(mergeRecords(ab, a), ab)).toBe(true)
    expect(sameRecord(mergeRecords(mergeRecords(a, b), c), mergeRecords(a, mergeRecords(b, c)))).toBe(true)
  })

  it('an older copy of a device never takes its numbers back: per device, per item, per number, the larger', () => {
    const old = gain(emptyRecord(), A, '3', 4)
    const now = spend(gain(old, A, '3', 6), A, '3', 2)
    const m = mergeRecords(now, old)
    expect(m.devices[A].a['3']).toBe(10)
    expect(m.devices[A].s['3']).toBe(2)
  })

  it('negative totals: 0 shown, the debt kept, and later gains pay it off first', () => {
    // A synced 5; both devices spend all 5 before either syncs again.
    const base = gain(emptyRecord(), A, '3', 5)
    const m = mergeRecords(spend(base, A, '3', 5), spend(base, B, '3', 5))
    expect(totalsOf(m)['3']).toBe(-5)
    expect(heldOf(totalsOf(m), '3')).toBe(0)
    expect(inventoryFrom(emptyInventory(), m).counts[3]).toBeUndefined()
    // Three mined: still in debt, still 0.
    const paid = gain(m, B, '3', 3)
    expect(heldOf(totalsOf(paid), '3')).toBe(0)
    // Three more: one shows.
    const more = gain(paid, B, '3', 3)
    expect(heldOf(totalsOf(more), '3')).toBe(1)
    expect(inventoryFrom(emptyInventory(), more).counts[3]).toBe(1)
  })
})

describe('the Compiler: grow-only, the earliest date', () => {
  it('owned once any device recorded it; the earliest crafted date stands', () => {
    const a = withDelta(emptyRecord(), A, { add: {}, spend: {}, compiler: true }, T0 + 100)
    const b = withDelta(emptyRecord(), B, { add: {}, spend: {}, compiler: true }, T0 + 10)
    expect(mergeRecords(a, b).tools[COMPILER]).toBe(T0 + 10)
    expect(mergeRecords(a, emptyRecord()).tools[COMPILER]).toBe(T0 + 100)
    // Never taken away: a copy without it merges to with it.
    expect(mergeRecords(emptyRecord(), b).tools[COMPILER]).toBe(T0 + 10)
  })

  it('a made Compiler counts; a preview\'s granted one never does', () => {
    expect(deltaOf(emptyInventory(), withCompiler(emptyInventory(), 'made')).compiler).toBe(true)
    expect(deltaOf(emptyInventory(), withCompiler(emptyInventory(), 'granted')).compiler).toBe(false)
    expect(deltaFromInventory(withCompiler(emptyInventory(), 'granted')).compiler).toBe(false)
  })

  it('the record\'s Compiler puts it in slot 1 on a device that never made it', () => {
    const r = withDelta(emptyRecord(), A, { add: { 3: 2 }, spend: {}, compiler: true }, T0)
    const inv = inventoryFrom(emptyInventory(), r)
    expect(inv.compiler).toBe('made')
    expect(inv.hotbar[0]).toBe(COMPILER_ID)
    expect(inv.hotbar[1]).toBe(3)
    expect(tidyInventory(inv)).toEqual(inv)
  })
})

describe('Quarry Charges: a PN-counter like the blocks', () => {
  it('gained 7 a compile on one device, spent on another: the sum, in their slot after the Compiler', () => {
    let r = withDelta(emptyRecord(), A, { add: { [CHARGE]: 7 }, spend: {}, compiler: true }, T0)
    r = spend(r, B, CHARGE, 2)
    const inv = inventoryFrom(emptyInventory(), r)
    expect(inv.charges).toBe(5)
    expect(inv.hotbar.slice(0, 2)).toEqual([COMPILER_ID, QUARRY_ID])
  })

  it('all spent: kept at 0 in their slot, never taken off the bar', () => {
    const r = spend(gain(emptyRecord(), A, CHARGE, 7), A, CHARGE, 7)
    const inv = inventoryFrom(emptyInventory(), r)
    expect(inv.charges).toBe(0)
    expect(inv.hotbar).toContain(QUARRY_ID)
    // A device that shows them at 0 with no record of them keeps them at 0.
    expect(inventoryFrom(withCharges(emptyInventory(), 0), emptyRecord()).charges).toBe(0)
  })

  it('a placing and a compile, as inventory changes, are a spend and a gain', () => {
    const inv = withCharges(emptyInventory(), 7)
    expect(deltaOf(inv, withCharges(inv, 6))).toEqual({ add: {}, spend: { [CHARGE]: 1 }, compiler: false })
    expect(deltaOf(inv, withCharges(inv, 14))).toEqual({ add: { [CHARGE]: 7 }, spend: {}, compiler: false })
  })
})

describe('the record as TERRAIN\'s inventory', () => {
  it('the hotbar is this device\'s own: a kind new here takes the first empty slot, the chosen slot stays, a kind gone keeps its slot', () => {
    const mine: Inventory = { counts: { 3: 2, 9: 1 }, hotbar: [9, 3, 0, 0, 0, 0, 0, 0, 0], slot: 1 }
    let r = withDelta(emptyRecord(), A, deltaFromInventory(mine), T0)
    r = gain(r, B, '12', 4)
    r = spend(r, B, '9', 1)
    const inv = inventoryFrom(mine, r)
    expect(inv.counts).toEqual({ 3: 2, 12: 4 })
    expect(inv.hotbar).toEqual([9, 3, 12, 0, 0, 0, 0, 0, 0])
    expect(inv.slot).toBe(1)
  })

  it('the same inventory back when the record says what it holds', () => {
    const mine: Inventory = { counts: { 3: 2 }, hotbar: [3, 0, 0, 0, 0, 0, 0, 0, 0], slot: 0 }
    const r = withDelta(emptyRecord(), A, deltaFromInventory(mine), T0)
    expect(inventoryFrom(mine, r)).toBe(mine)
  })

  it('every kind ever collected, on any device, spent or not', () => {
    const r = spend(gain(gain(emptyRecord(), A, '40', 2), B, '41', 1), A, '40', 2)
    expect(collectedKinds(r)).toEqual({ 40: 2, 41: 1 })
  })
})

describe('what a newer client adds is carried through', () => {
  it('an unknown item merges as a PN-counter; an unknown tool by the earlier date; unknown fields kept', () => {
    const raw = {
      v: 1,
      devices: { [A]: { a: { 3: 2, gem: 5 }, s: { gem: 1 }, u: T0, hue: 'teal' }, nothex: { a: { 3: 99 }, s: {}, u: T0 } },
      tools: { compiler: T0, drill: T0 + 9 },
      season: 4,
    }
    const r = validRecord(raw)
    expect(Object.keys(r.devices)).toEqual([A])
    expect(totalsOf(r)).toEqual({ 3: 2, gem: 4 })
    expect(r.tools).toEqual({ compiler: T0, drill: T0 + 9 })
    expect(r.x).toEqual({ season: 4 })
    expect(r.devices[A].x).toEqual({ hue: 'teal' })
    const m = mergeRecords(r, gain(emptyRecord(), B, '3', 1))
    const back = decodeRecord(encodeRecord(m))
    expect(back.devices[A].x).toEqual({ hue: 'teal' })
    expect(back.devices[A].a.gem).toBe(5)
    expect(back.tools.drill).toBe(T0 + 9)
    expect(back.x).toEqual({ season: 4 })
  })

  it('malformed numbers are dropped one by one', () => {
    const r = validRecord({ v: 1, devices: { [A]: { a: { 3: -1, 4: 1.5, 5: 2, 999: 3, 'Bad Key': 1 }, s: { 5: 'x' }, u: 'later' } }, tools: { compiler: -4 } })
    expect(r.devices[A]).toEqual({ a: { 5: 2 }, s: {}, u: 0 })
    expect(r.tools).toEqual({})
  })
})

describe('retired devices: the record kept under the size limit', () => {
  /** A record of `n` devices, each with its own scattered counts (so deflate cannot shrink it much), last changed at u0 + i. */
  function crowd(n: number, u0: number): InventoryRecord {
    let seed = 7
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed }
    const r: InventoryRecord = { devices: {}, tools: { compiler: T0 } }
    for (let i = 0; i < n; i++) {
      const a: Record<string, number> = {}
      const sp: Record<string, number> = {}
      for (let k = 1; k <= 40; k++) { a[String((rnd() % 254) + 1)] = rnd() % 100_000; if (k % 3 === 0) sp[String((rnd() % 254) + 1)] = rnd() % 1000 }
      a[CHARGE] = rnd() % 500
      r.devices[(0x1000000000000000n + BigInt(i)).toString(16)] = { a, s: sp, u: u0 + i }
    }
    return r
  }

  it('folding the idlest devices keeps every total the same, never the device writing, never a recent one', () => {
    const now = T0 + 400 * 86_400
    const r = crowd(60, T0)
    // Two recent devices: never folded.
    const keep = Object.keys(r.devices)[0]
    const recent = Object.keys(r.devices)[59]
    r.devices[recent].u = now - 60
    const folded = foldIdle(r, keep, now, 4000)
    expect(totalsOf(folded)).toEqual(totalsOf(r))
    expect(Object.keys(folded.devices).length).toBeLessThan(60)
    expect(folded.devices[keep]).toBeDefined()
    expect(folded.devices[recent]).toBeDefined()
    expect(isRetired(folded, keep)).toBe(false)
    // The idlest went first.
    const gone = Object.keys(r.devices).filter((id) => !folded.devices[id])
    for (const id of gone) expect(isRetired(folded, id)).toBe(true)
    expect(gone).toContain(Object.keys(r.devices)[1])
    // Read back from its text, the same.
    expect(totalsOf(decodeRecord(encodeRecord(folded)))).toEqual(totalsOf(r))
  })

  it('merging a folded copy with an unfolded one counts nothing twice; a retired device showing up again is dropped', () => {
    const now = T0 + 400 * 86_400
    const r = crowd(30, T0)
    const folded = foldIdle(r, '', now, 2500)
    expect(sameRecord(folded, r)).toBe(false)
    expect(totalsOf(mergeRecords(r, folded))).toEqual(totalsOf(r))
    expect(totalsOf(mergeRecords(folded, r))).toEqual(totalsOf(r))
    const gone = Object.keys(r.devices).find((id) => isRetired(folded, id))!
    const back = mergeRecords(folded, { devices: { [gone]: { a: { 3: 999 }, s: {}, u: now } }, tools: {} })
    expect(back.devices[gone]).toBeUndefined()
    expect(totalsOf(back)).toEqual(totalsOf(r))
  })

  it('a record past RETIRE_AT is folded when planned, instead of failing as too large', () => {
    const now = T0 + 400 * 86_400
    const r = crowd(420, T0)
    expect(encodeRecord(r).length).toBeGreaterThan(RETIRE_AT)
    const plan = planRecord(r, Object.keys(r.devices)[0], now)
    expect(plan.text.length).toBeLessThanOrEqual(RETIRE_TO)
    expect(totalsOf(plan.rec)).toEqual(totalsOf(r))
    expect(totalsOf(decodeRecord(plan.text))).toEqual(totalsOf(r))
    // Devices changed within RETIRE_IDLE_S are never folded, so a crowd of fresh ones still fails loudly.
    const fresh = crowd(420, now - RETIRE_IDLE_S / 2)
    expect(() => planRecord(fresh, '', now)).toThrow()
  })
})
