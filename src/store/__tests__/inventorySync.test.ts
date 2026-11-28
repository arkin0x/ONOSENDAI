/**
 * inventorySync.test.ts: the TERRAIN inventory synced across devices (owner,
 * 2026-11-28), as MINING's stats are. Devices share one generated test key and
 * one fake relay that keeps the newest of each addressable event; each has
 * its own storage. Nothing here reaches a network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { matchFilter } from 'nostr-tools/filter'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { CHARGE, COMPILER, INVENTORY_D, INVENTORY_KIND, decodeRecord, openRecord, recordContent, totalsOf } from '../../lib/inventoryRecord'
import { carriedInto, emptyInventory, withCharges, withCompiler, type Inventory } from '../../lib/terrain/terrainDb'
import {
  HIDE_FLOOR_MS, OWN_FLOOR_MS, QUIET_MS, READ_FLOOR_MS, WRITE_EVERY_MS, inventoryRecordFor, inventorySyncLine, isDirty, loadedInventory, localFor, noteInventory, nudgeInventory,
  onInventoryMerged, resetInventorySync, setInventoryDeps, syncInventory, syncedInventory, useInventorySync, type InventoryDeps,
} from '../inventorySync'

function fakeRelay() {
  const events: NostrEvent[] = []
  return {
    events,
    trouble: false,
    fetch: async function (filter: Parameters<InventoryDeps['fetch']>[0]) { return { events: events.filter((e) => matchFilter(filter, e)), trouble: this.trouble } },
    publish: async (ev: NostrEvent) => {
      const d = ev.tags.find((t) => t[0] === 'd')?.[1]
      const i = events.findIndex((e) => e.pubkey === ev.pubkey && e.kind === ev.kind && e.tags.find((t) => t[0] === 'd')?.[1] === d)
      if (i >= 0 && events[i].created_at >= ev.created_at) return { ok: true as const }
      if (i >= 0) events.splice(i, 1)
      events.push(ev)
      return { ok: true as const }
    },
  }
}

function memStorage() {
  const m = new Map<string, string>()
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
}

interface Device {
  storage: ReturnType<typeof memStorage>
  prefs: ReturnType<typeof memStorage>
  live: boolean
  tutorial: boolean
  signed: number
  encrypts: number
  decrypts: number
  /** This device's TERRAIN inventory, as useTerrain holds it. */
  inv: Inventory
  duringSign?: () => Promise<void>
}

const sk = generateSecretKey()
const me = getPublicKey(sk)
const selfKey = nip44.utils.getConversationKey(sk, me)
const sk2 = generateSecretKey()
const other = getPublicKey(sk2)
let relay = fakeRelay()
let self = me
let current: Device | null = null
let unhook: (() => void) | null = null

function device(): Device {
  return { storage: memStorage(), prefs: memStorage(), live: true, tutorial: false, signed: 0, encrypts: 0, decrypts: 0, inv: emptyInventory() }
}

/** Run as device `d`: a new load of the app on it, its field loaded (loadedInventory) and merges put in its bag. */
function as(d: Device, over: Partial<InventoryDeps> = {}, load = true): void {
  resetInventorySync()
  current = d
  setInventoryDeps({
    self: () => self,
    live: () => d.live,
    tutorial: () => d.tutorial,
    crypto: () => ({
      nip44Encrypt: async (p) => { d.encrypts++; return nip44.encrypt(p, self === me ? selfKey : nip44.utils.getConversationKey(sk2, other)) },
      nip44Decrypt: async (c) => { d.decrypts++; return nip44.decrypt(c, self === me ? selfKey : nip44.utils.getConversationKey(sk2, other)) },
    }),
    fetch: (f) => relay.fetch(f),
    sign: async (t) => { d.signed++; if (d.duringSign) { const f = d.duringSign; d.duringSign = undefined; await f() } return finalizeEvent(t, self === me ? sk : sk2) as unknown as NostrEvent },
    publish: (ev) => relay.publish(ev),
    storage: d.storage,
    prefs: d.prefs,
    verify: (ev) => verifyEvent({ ...ev } as Parameters<typeof verifyEvent>[0]),
    ...over,
  })
  if (load) d.inv = loadedInventory(self, d.inv) ?? d.inv
}

/** Something done in TERRAIN on the current device: the change saved as useTerrain saveInventory does. */
function act(f: (inv: Inventory) => Inventory): void {
  const d = current!
  d.inv = noteInventory(self, d.inv, f(d.inv))
}
const mine = (id: number, n = 1): void => act((inv) => carriedInto(inv, id, n))
const place = (id: number): void => act((inv) => { const counts = { ...inv.counts }; if (counts[id] > 1) counts[id]--; else delete counts[id]; return { ...inv, counts } })

/** The record on the relay, opened. */
function onRelay(who = me) {
  const ev = relay.events.find((e) => e.pubkey === who && e.kind === INVENTORY_KIND)
  if (!ev) return null
  const c = recordContent(ev.content)!
  const conv = who === me ? selfKey : nip44.utils.getConversationKey(sk2, other)
  const key = hexToBytes(nip44.decrypt(c.wrapped, conv))
  const plain = openRecord(c.body, key)
  return { ev, plain, rec: decodeRecord(plain) }
}

beforeEach(() => {
  relay = fakeRelay()
  self = me
  // Merges reach the current device's bag, as useTerrain's listener does.
  unhook = onInventoryMerged((owner) => { if (current && owner === self) current.inv = syncedInventory(owner, current.inv) })
})

afterEach(() => {
  vi.useRealTimers()
  unhook?.()
  resetInventorySync()
  setInventoryDeps(null)
  current = null
})

describe('the record on the relay', () => {
  it('only the d tag is public; the content sealed: one encrypt a first write, one sign; the next write a signature only', async () => {
    const d = device()
    as(d)
    mine(3, 4)
    await syncInventory()
    expect(d.signed).toBe(1)
    expect(d.encrypts).toBe(1)
    const { ev, plain, rec } = onRelay()!
    expect(ev.kind).toBe(30078)
    expect(ev.tags).toEqual([['d', INVENTORY_D]])
    expect(ev.content.startsWith('1:')).toBe(true)
    // Nothing readable in the content: not the kind, the count or the word.
    expect(ev.content).not.toMatch(/charge|devices|"3"/)
    expect(plain).not.toMatch(/devices/)
    expect(totalsOf(rec)).toEqual({ 3: 4 })
    mine(3)
    await syncInventory()
    expect(d.signed).toBe(2)
    expect(d.encrypts).toBe(1)
  })
})

describe('two devices', () => {
  it('adding and spending at once: each write reads and merges first, and both bags end with the sum', async () => {
    const a = device()
    as(a)
    mine(3, 10)
    await syncInventory()
    const b = device()
    as(b)
    await syncInventory(false)
    expect(b.inv.counts[3]).toBe(10)
    // Concurrently: A places 4 and mines 2 of kind 7; B mines 5 and places 3.
    as(a)
    for (let i = 0; i < 4; i++) place(3)
    mine(7, 2)
    as(b)
    mine(3, 5)
    for (let i = 0; i < 3; i++) place(3)
    await syncInventory()
    as(a)
    await syncInventory()
    expect(a.inv.counts).toEqual({ 3: 8, 7: 2 })
    as(b)
    await syncInventory(false)
    expect(b.inv.counts).toEqual({ 3: 8, 7: 2 })
    expect(totalsOf(onRelay()!.rec)).toEqual({ 3: 8, 7: 2 })
  })

  it('both spend the same blocks before syncing: 0 shown, never blocked, the debt kept and paid off by later gains', async () => {
    const a = device()
    as(a)
    mine(3, 5)
    await syncInventory()
    const b = device()
    as(b)
    await syncInventory(false)
    for (let i = 0; i < 5; i++) place(3)
    await syncInventory()
    as(a)
    for (let i = 0; i < 5; i++) place(3)
    await syncInventory()
    expect(totalsOf(inventoryRecordFor(me))['3']).toBe(-5)
    expect(a.inv.counts[3]).toBeUndefined()
    // Mining on: the first five pay the debt, the sixth shows.
    mine(3, 5)
    expect(a.inv.counts[3]).toBeUndefined()
    mine(3)
    expect(a.inv.counts[3]).toBe(1)
  })

  it('another device writes while this one waits on its signer: nothing is sent over it; it reads, merges and asks the signer again', async () => {
    const a = device()
    as(a)
    mine(3, 2)
    await syncInventory()
    const b = device()
    as(b)
    await syncInventory(false)
    mine(9)
    b.duringSign = async () => {
      // A writes meanwhile, from its own load.
      const saved = current!
      as(a)
      mine(4)
      await syncInventory()
      as(saved, {}, false)
    }
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)).toEqual({ 3: 2, 4: 1, 9: 1 })
  })
})

describe('migration', () => {
  it('what a device held before sync becomes its first gains, once: loading again never counts it twice', async () => {
    const d = device()
    d.inv = withCharges(withCompiler(carriedInto(carriedInto(emptyInventory(), 3, 6), 40, 2), 'made'), 7)
    as(d)
    expect(totalsOf(inventoryRecordFor(me))).toEqual({ 3: 6, 40: 2, [CHARGE]: 7 })
    expect(inventoryRecordFor(me).tools[COMPILER]).toBeGreaterThan(0)
    await syncInventory()
    // A reload, and another, and the field read again: still 6.
    as(d)
    as(d)
    d.inv = loadedInventory(me, d.inv)!
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)).toEqual({ 3: 6, 40: 2, [CHARGE]: 7 })
    expect(Object.keys(onRelay()!.rec.devices)).toEqual([localFor(me).device])
    expect(d.inv.counts).toEqual({ 3: 6, 40: 2 })
  })

  it('two devices each with blocks from before: both counted, each once', async () => {
    const a = device()
    a.inv = carriedInto(emptyInventory(), 3, 4)
    as(a)
    await syncInventory()
    const b = device()
    b.inv = carriedInto(emptyInventory(), 3, 6)
    as(b)
    await syncInventory()
    as(a)
    await syncInventory()
    expect(a.inv.counts[3]).toBe(10)
    as(b)
    await syncInventory(false)
    expect(b.inv.counts[3]).toBe(10)
  })

  it('a migrated Compiler keeps the date MINING has for it', () => {
    const d = device()
    d.inv = withCompiler(emptyInventory(), 'made')
    as(d, { crafted: () => 1_700_000_123 })
    expect(inventoryRecordFor(me).tools[COMPILER]).toBe(1_700_000_123)
  })

  it('no storage for TERRAIN on this device: nothing migrated, the bag left as it is until the record holds it', () => {
    const d = device()
    as(d, {}, false)
    expect(loadedInventory(me, null)).toBeNull()
    d.inv = carriedInto(emptyInventory(), 3, 2)
    as(d)
    expect(loadedInventory(me, null)?.counts).toEqual({ 3: 2 })
  })
})

describe('never written', () => {
  it('in LOCAL, during a tutorial run, with the switch off, or when the relay did not answer; recorded here all the same', async () => {
    const d = device()
    d.live = false
    as(d)
    mine(3)
    await syncInventory()
    expect(d.signed).toBe(0)
    expect(useInventorySync.getState().status).toBe('local')
    d.live = true
    d.tutorial = true
    as(d)
    mine(3)
    await syncInventory()
    nudgeInventory('read')
    expect(d.signed + d.decrypts).toBe(0)
    d.tutorial = false
    as(d)
    useInventorySync.getState().setEnabled(false)
    mine(3)
    await syncInventory()
    expect(d.signed).toBe(0)
    expect(d.prefs.m.get('onosendai:inventory-sync')).toBe('0')
    useInventorySync.getState().setEnabled(true)
    relay.trouble = true
    await syncInventory()
    expect(d.signed).toBe(0)
    expect(useInventorySync.getState().status).toBe('error')
    // Everything done meanwhile is here, and goes out once it can.
    expect(totalsOf(inventoryRecordFor(me))['3']).toBe(3)
    relay.trouble = false
    await syncInventory()
    expect(d.signed).toBe(1)
    expect(totalsOf(onRelay()!.rec)['3']).toBe(3)
  })

  it('a record that does not open with the signer is never written over', async () => {
    const a = device()
    as(a)
    mine(3)
    await syncInventory()
    const b = device()
    as(b, { crypto: () => ({ nip44Encrypt: async () => 'x', nip44Decrypt: async () => { throw new Error('refused') } }) })
    mine(4)
    await syncInventory()
    expect(b.signed).toBe(0)
    expect(totalsOf(onRelay()!.rec)).toEqual({ 3: 1 })
  })
})

describe('per identity', () => {
  it('each npub its own record and device id on one device; a switch deletes nothing', async () => {
    const d = device()
    as(d)
    mine(3, 2)
    const mineDevice = localFor(me).device
    self = other
    d.inv = emptyInventory()
    as(d)
    mine(9)
    expect(localFor(other).device).not.toBe(mineDevice)
    expect(totalsOf(inventoryRecordFor(other))).toEqual({ 9: 1 })
    expect(totalsOf(inventoryRecordFor(me))).toEqual({ 3: 2 })
    expect(d.storage.m.has(`onosendai:inventory:${me}`)).toBe(true)
    expect(d.storage.m.has(`onosendai:inventory:${other}`)).toBe(true)
    await syncInventory()
    expect(onRelay(other)).not.toBeNull()
    expect(onRelay(me)).toBeNull()
  })

  it('TERRAIN with no identity (its field is "local") never touches a record', () => {
    const d = device()
    as(d)
    const inv = carriedInto(emptyInventory(), 3)
    expect(noteInventory('local', emptyInventory(), inv)).toBe(inv)
    expect(d.storage.m.has('onosendai:inventory:local')).toBe(false)
  })
})

describe('the signer\'s cost', () => {
  it('at most one write in ten minutes however much changes; hiding writes too, no sooner than HIDE_FLOOR_MS after the last try', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const d = device()
    as(d)
    mine(3)
    await vi.advanceTimersByTimeAsync(QUIET_MS + 100)
    expect(d.signed).toBe(1)
    for (let i = 0; i < 20; i++) { mine(3); await vi.advanceTimersByTimeAsync(20_000) }
    expect(d.signed).toBe(1)
    let waited = 0
    while (d.signed < 2 && waited < WRITE_EVERY_MS) { await vi.advanceTimersByTimeAsync(1000); waited += 1000 }
    expect(d.signed).toBe(2)
    mine(3)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    nudgeInventory('hide')
    await vi.advanceTimersByTimeAsync(1000)
    expect(d.signed).toBe(2)
    await vi.advanceTimersByTimeAsync(HIDE_FLOOR_MS - 5 * 60_000)
    nudgeInventory('hide')
    await vi.advanceTimersByTimeAsync(1000)
    expect(d.signed).toBe(3)
    expect(totalsOf(onRelay()!.rec)['3']).toBe(22)
  })

  it('the Compiler made or charges gained writes within a minute of the last try, not ten', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const d = device()
    as(d)
    mine(3)
    await vi.advanceTimersByTimeAsync(QUIET_MS + 100)
    expect(d.signed).toBe(1)
    act((inv) => withCompiler(inv, 'made'))
    await vi.advanceTimersByTimeAsync(OWN_FLOOR_MS)
    expect(d.signed).toBe(2)
    expect(onRelay()!.rec.tools[COMPILER]).toBeGreaterThan(0)
    act((inv) => withCharges(inv, (inv.charges ?? 0) + 7))
    await vi.advanceTimersByTimeAsync(OWN_FLOOR_MS)
    expect(d.signed).toBe(3)
    expect(totalsOf(onRelay()!.rec)[CHARGE]).toBe(7)
    // Spending a charge is an ordinary change: it waits for the ten minutes.
    act((inv) => withCharges(inv, (inv.charges ?? 0) - 1))
    await vi.advanceTimersByTimeAsync(OWN_FLOOR_MS * 2)
    expect(d.signed).toBe(3)
  })

  it('a refusing signer is not asked every minute: a failed fast try falls back to the ten minutes', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const d = device()
    let refuse = true
    as(d, { sign: async (t) => { d.signed++; if (refuse) throw new Error('rejected'); return finalizeEvent(t, sk) as unknown as NostrEvent } })
    act((inv) => withCompiler(inv, 'made'))
    await vi.advanceTimersByTimeAsync(OWN_FLOOR_MS)
    expect(d.signed).toBe(1)
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS - OWN_FLOOR_MS - 1000)
    expect(d.signed).toBe(1)
    refuse = false
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(d.signed).toBe(2)
    expect(onRelay()!.rec.tools[COMPILER]).toBeGreaterThan(0)
  })

  it('an hour of heavy play: mining every 4 s, placing, two compiles, charges placed, the app switched every 90 s, the bag opened every 70 s: at most 8 signatures (6 for the ten-minute writes, one more for each Compiler or compile that lands just after one)', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const e = device()
    as(e)
    mine(5)
    await syncInventory()
    const d = device()
    as(d)
    const HOUR = 3600
    for (let t = 1; t <= HOUR; t++) {
      if (t % 4 === 0) mine(3)
      if (t % 25 === 0 && (d.inv.counts[3] ?? 0) > 0) place(3)
      // The Compiler made at 10 minutes, then a compile (7 charges) at 15 and at 45.
      if (t === 600) act((inv) => withCompiler(inv, 'made'))
      if (t === 900 || t === 2700) act((inv) => withCharges(inv, (inv.charges ?? 0) + 7))
      if (t % 180 === 0 && (d.inv.charges ?? 0) > 0) act((inv) => withCharges(inv, (inv.charges ?? 0) - 1))
      if (t % 90 === 0) nudgeInventory('hide')
      if (t % 90 === 1) nudgeInventory('read')
      if (t % 70 === 0) nudgeInventory('read')
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(d.signed).toBeLessThanOrEqual(8)
    expect(d.signed).toBeGreaterThanOrEqual(5)
    expect(d.encrypts).toBe(0)
    expect(d.decrypts).toBe(1)
    // Nothing lost: the device holds every block, and the relay all but the last few minutes.
    const held = totalsOf(inventoryRecordFor(me))
    const placed = Math.floor(HOUR / 25)
    expect(held['3']).toBe(HOUR / 4 - placed)
    expect(held['5']).toBe(1)
    expect(totalsOf(onRelay()!.rec)['3']).toBeGreaterThan(HOUR / 4 - placed - (10 * 60) / 4)
  })

  it('an hour of mining and placing alone, the app switched and the bag opened as above: six signatures at most', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const d = device()
    as(d)
    for (let t = 1; t <= 3600; t++) {
      if (t % 4 === 0) mine(3)
      if (t % 25 === 0) place(3)
      if (t % 90 === 0) nudgeInventory('hide')
      if (t % 70 === 0) nudgeInventory('read')
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(d.signed).toBeLessThanOrEqual(6)
    expect(d.encrypts).toBe(1)
  })

  it('reads never sign, at most once a minute, one decrypt a load', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const e = device()
    as(e)
    mine(5)
    await syncInventory()
    const d = device()
    let fetches = 0
    as(d, { fetch: (f) => { fetches++; return relay.fetch(f) } })
    nudgeInventory('read')
    await vi.advanceTimersByTimeAsync(100)
    expect(d.inv.counts[5]).toBe(1)
    expect(fetches).toBe(1)
    nudgeInventory('read')
    await vi.advanceTimersByTimeAsync(100)
    expect(fetches).toBe(1)
    await vi.advanceTimersByTimeAsync(READ_FLOOR_MS)
    nudgeInventory('read')
    await vi.advanceTimersByTimeAsync(100)
    expect(fetches).toBe(2)
    expect(d.signed).toBe(0)
    expect(d.decrypts).toBe(1)
  })

  it('no timer in LOCAL, and nothing at all for a player with nothing', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const d = device()
    d.live = false
    as(d)
    mine(3)
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 3)
    expect(d.signed + d.decrypts + d.encrypts).toBe(0)
    const e = device()
    as(e)
    expect(isDirty(me)).toBe(false)
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 3)
    expect(e.signed + e.encrypts).toBe(0)
  })
})

describe('local changes during a read are never overwritten', () => {
  it('blocks mined while the relay is answering are in the merge, and in the bag after it', async () => {
    const a = device()
    as(a)
    mine(7, 3)
    await syncInventory()
    const b = device()
    as(b, {
      fetch: async (f) => {
        // Mining on while the read is out.
        mine(3, 2)
        return relay.fetch(f)
      },
    })
    mine(3, 1)
    await syncInventory(false)
    expect(b.inv.counts).toEqual({ 3: 3, 7: 3 })
    expect(totalsOf(inventoryRecordFor(me))).toEqual({ 3: 3, 7: 3 })
  })
})

describe('the bag\'s line', () => {
  it('synced across your devices, saved on this device only, or sync failed', () => {
    const base = { me, enabled: true, live: true, status: 'synced' as const, syncedAt: 1, note: null }
    expect(inventorySyncLine(base).words).toBe('Synced across your devices')
    expect(inventorySyncLine({ ...base, enabled: false }).words).toBe('Saved on this device only')
    expect(inventorySyncLine({ ...base, live: false }).words).toBe('Saved on this device only')
    expect(inventorySyncLine({ ...base, syncedAt: 0 }).words).toBe('Saved on this device only')
    expect(inventorySyncLine({ ...base, me: '' }).words).toBe('Saved on this device only')
    expect(inventorySyncLine({ ...base, status: 'unsupported' }).words).toBe('Saved on this device only')
    expect(inventorySyncLine({ ...base, status: 'error' }).words).toBe('Sync failed')
  })
})
