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
import { bytesToHex, hexToBytes, type NostrEvent } from '../../lib/events'
import { CHARGE, COMPILER, INVENTORY_D, INVENTORY_KIND, decodeRecord, encodeRecord, newRecordKey, openRecord, recordContent, recordTemplate, sealRecord, totalsOf, type InventoryRecord } from '../../lib/inventoryRecord'
import { carriedInto, emptyInventory, withCharges, withCompiler, type Inventory } from '../../lib/terrain/terrainDb'
import {
  HIDE_FLOOR_MS, OWN_FLOOR_MS, QUIET_MS, READ_FLOOR_MS, WRITE_EVERY_MS, inventoryRecordFor, inventorySyncLine, isDirty, loadedInventory, localFor, noteInventory, nudgeInventory,
  inventorySettled, onInventoryMerged, resetInventorySync, setInventoryDeps, syncInventory, syncedInventory, useInventorySync, type InventoryDeps,
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
  /** kvStore running blind on this load. */
  blind: boolean
  /** A tab of a device: the stored record changed in one step (kvUpdate), while `storage` is this tab's copy. */
  update?: InventoryDeps['update']
  lock?: InventoryDeps['lock']
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
  return { storage: memStorage(), prefs: memStorage(), live: true, tutorial: false, signed: 0, encrypts: 0, decrypts: 0, inv: emptyInventory(), blind: false }
}

/** Run as device `d`: a new load of the app on it, its field loaded (loadedInventory) and merges put in its bag. */
async function as(d: Device, over: Partial<InventoryDeps> = {}, load = true): Promise<void> {
  // What the last load had not stored yet lands first: a reload never drops a change already made.
  await inventorySettled()
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
    ...(d.update ? { update: d.update } : {}),
    // Each simulated device is its own machine: no lock shared with another (a tab pair shares one: twoTabs).
    lock: d.lock ?? ((_name, fn) => fn()),
    blind: () => d.blind,
    prefs: d.prefs,
    verify: (ev) => verifyEvent({ ...ev } as Parameters<typeof verifyEvent>[0]),
    ...over,
  })
  if (load) { d.inv = loadedInventory(self, d.inv) ?? d.inv; await inventorySettled() }
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
    await as(d)
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
    await as(a)
    mine(3, 10)
    await syncInventory()
    const b = device()
    await as(b)
    await syncInventory(false)
    expect(b.inv.counts[3]).toBe(10)
    // Concurrently: A places 4 and mines 2 of kind 7; B mines 5 and places 3.
    await as(a)
    for (let i = 0; i < 4; i++) place(3)
    mine(7, 2)
    await as(b)
    mine(3, 5)
    for (let i = 0; i < 3; i++) place(3)
    await syncInventory()
    await as(a)
    await syncInventory()
    expect(a.inv.counts).toEqual({ 3: 8, 7: 2 })
    await as(b)
    await syncInventory(false)
    expect(b.inv.counts).toEqual({ 3: 8, 7: 2 })
    expect(totalsOf(onRelay()!.rec)).toEqual({ 3: 8, 7: 2 })
  })

  it('both spend the same blocks before syncing: 0 shown, never blocked, the debt kept and paid off by later gains', async () => {
    const a = device()
    await as(a)
    mine(3, 5)
    await syncInventory()
    const b = device()
    await as(b)
    await syncInventory(false)
    for (let i = 0; i < 5; i++) place(3)
    await syncInventory()
    await as(a)
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
    await as(a)
    mine(3, 2)
    await syncInventory()
    const b = device()
    await as(b)
    await syncInventory(false)
    mine(9)
    b.duringSign = async () => {
      // A writes meanwhile, from its own load.
      const saved = current!
      await as(a)
      mine(4)
      await syncInventory()
      await as(saved, {}, false)
    }
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)).toEqual({ 3: 2, 4: 1, 9: 1 })
  })
})

describe('migration', () => {
  it('what a device held before sync becomes its first gains, once: loading again never counts it twice', async () => {
    const d = device()
    d.inv = withCharges(withCompiler(carriedInto(carriedInto(emptyInventory(), 3, 6), 40, 2), 'made'), 7)
    await as(d)
    expect(totalsOf(inventoryRecordFor(me))).toEqual({ 3: 6, 40: 2, [CHARGE]: 7 })
    expect(inventoryRecordFor(me).tools[COMPILER]).toBeGreaterThan(0)
    await syncInventory()
    // A reload, and another, and the field read again: still 6.
    await as(d)
    await as(d)
    d.inv = loadedInventory(me, d.inv)!
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)).toEqual({ 3: 6, 40: 2, [CHARGE]: 7 })
    expect(Object.keys(onRelay()!.rec.devices)).toEqual([localFor(me).device])
    expect(d.inv.counts).toEqual({ 3: 6, 40: 2 })
  })

  it('two devices each with blocks from before: both counted, each once', async () => {
    const a = device()
    a.inv = carriedInto(emptyInventory(), 3, 4)
    await as(a)
    await syncInventory()
    const b = device()
    b.inv = carriedInto(emptyInventory(), 3, 6)
    await as(b)
    await syncInventory()
    await as(a)
    await syncInventory()
    expect(a.inv.counts[3]).toBe(10)
    await as(b)
    await syncInventory(false)
    expect(b.inv.counts[3]).toBe(10)
  })

  it('a migrated Compiler keeps the date MINING has for it', async () => {
    const d = device()
    d.inv = withCompiler(emptyInventory(), 'made')
    await as(d, { crafted: () => 1_700_000_123 })
    expect(inventoryRecordFor(me).tools[COMPILER]).toBe(1_700_000_123)
  })

  it('no storage for TERRAIN on this device: nothing migrated, the bag left as it is until the record holds it', async () => {
    const d = device()
    await as(d, {}, false)
    expect(loadedInventory(me, null)).toBeNull()
    d.inv = carriedInto(emptyInventory(), 3, 2)
    await as(d)
    expect(loadedInventory(me, null)?.counts).toEqual({ 3: 2 })
  })
})

describe('never written', () => {
  it('in LOCAL, during a tutorial run, with the switch off, or when the relay did not answer; recorded here all the same', async () => {
    const d = device()
    d.live = false
    await as(d)
    mine(3)
    await syncInventory()
    expect(d.signed).toBe(0)
    expect(useInventorySync.getState().status).toBe('local')
    d.live = true
    d.tutorial = true
    await as(d)
    mine(3)
    await syncInventory()
    nudgeInventory('read')
    expect(d.signed + d.decrypts).toBe(0)
    d.tutorial = false
    await as(d)
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
    await as(a)
    mine(3)
    await syncInventory()
    const b = device()
    await as(b, { crypto: () => ({ nip44Encrypt: async () => 'x', nip44Decrypt: async () => { throw new Error('refused') } }) })
    mine(4)
    await syncInventory()
    expect(b.signed).toBe(0)
    expect(totalsOf(onRelay()!.rec)).toEqual({ 3: 1 })
  })
})

describe('per identity', () => {
  it('each npub its own record and device id on one device; a switch deletes nothing', async () => {
    const d = device()
    await as(d)
    mine(3, 2)
    const mineDevice = localFor(me).device
    self = other
    d.inv = emptyInventory()
    await as(d)
    mine(9)
    expect(localFor(other).device).not.toBe(mineDevice)
    expect(totalsOf(inventoryRecordFor(other))).toEqual({ 9: 1 })
    expect(totalsOf(inventoryRecordFor(me))).toEqual({ 3: 2 })
    await inventorySettled()
    expect(d.storage.m.has(`onosendai:inventory:${me}`)).toBe(true)
    expect(d.storage.m.has(`onosendai:inventory:${other}`)).toBe(true)
    await syncInventory()
    expect(onRelay(other)).not.toBeNull()
    expect(onRelay(me)).toBeNull()
  })

  it('TERRAIN with no identity (its field is "local") never touches a record', async () => {
    const d = device()
    await as(d)
    const inv = carriedInto(emptyInventory(), 3)
    expect(noteInventory('local', emptyInventory(), inv)).toBe(inv)
    expect(d.storage.m.has('onosendai:inventory:local')).toBe(false)
  })
})

describe('the signer\'s cost', () => {
  it('at most one write in ten minutes however much changes; hiding writes too, no sooner than HIDE_FLOOR_MS after the last try', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const d = device()
    await as(d)
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
    await as(d)
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
    await as(d, { sign: async (t) => { d.signed++; if (refuse) throw new Error('rejected'); return finalizeEvent(t, sk) as unknown as NostrEvent } })
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
    await as(e)
    mine(5)
    await syncInventory()
    const d = device()
    await as(d)
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
    await as(d)
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
    await as(e)
    mine(5)
    await syncInventory()
    const d = device()
    let fetches = 0
    await as(d, { fetch: (f) => { fetches++; return relay.fetch(f) } })
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
    await as(d)
    mine(3)
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 3)
    expect(d.signed + d.decrypts + d.encrypts).toBe(0)
    const e = device()
    await as(e)
    expect(isDirty(me)).toBe(false)
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 3)
    expect(e.signed + e.encrypts).toBe(0)
  })
})

describe('local changes during a read are never overwritten', () => {
  it('blocks mined while the relay is answering are in the merge, and in the bag after it', async () => {
    const a = device()
    await as(a)
    mine(7, 3)
    await syncInventory()
    const b = device()
    await as(b, {
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

/**
 * Two tabs of one device: one stored record (the database kvStore writes),
 * and each tab's own copy of it, which goes stale when the other tab writes
 * (kvStore's memory between its broadcasts). Changes go through `update`, one
 * step on the stored record, as kvUpdate does; a write takes one lock shared
 * by both tabs, as a Web Lock is.
 */
function twoTabs(): { a: Device; b: Device; durable: Map<string, string> } {
  const durable = new Map<string, string>()
  let held: Promise<unknown> = Promise.resolve()
  const lock: InventoryDeps['lock'] = (_name, fn) => { const p = held.then(fn, fn); held = p.catch(() => undefined); return p }
  const tab = (): Device => {
    const d = device()
    d.update = async (key, fn) => {
      const next = fn(durable.get(key) ?? null)
      if (next === null) { durable.delete(key); d.storage.m.delete(key) } else { durable.set(key, next); d.storage.m.set(key, next) }
      return next
    }
    d.lock = lock
    return d
  }
  return { a: tab(), b: tab(), durable }
}

/** A tab's copy brought up to the stored record (as kvStore's broadcast does), or left as it was. */
function catchUp(d: Device, durable: Map<string, string>): void {
  for (const [k, v] of durable) d.storage.m.set(k, v)
}

describe('two tabs on one device (review of #972)', () => {
  it('both tabs mining from stale copies: every gain is kept, the relay ends at the sum (10 + 5 + 3 = 18)', async () => {
    const { a, b, durable } = twoTabs()
    await as(a)
    mine(3, 10)
    await syncInventory()
    // Tab B opens now: its copy says 10.
    catchUp(b, durable)
    b.inv = { ...a.inv }
    // Tab A mines 5; tab B, its copy never caught up, mines 3.
    await as(a, {}, false)
    mine(3, 5)
    await as(b, {}, false)
    expect(localFor(me).rec.devices[localFor(me).device].a['3']).toBe(10)
    mine(3, 3)
    await inventorySettled()
    expect(totalsOf(inventoryRecordFor(me))['3']).toBe(18)
    // B's bag shows A's gains too, once its change is stored.
    expect(b.inv.counts[3]).toBe(18)
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)['3']).toBe(18)
    // One device entry, never two.
    expect(Object.keys(onRelay()!.rec.devices)).toHaveLength(1)
  })

  it('a tab\'s first change and another\'s, with nothing stored yet, keep one device id', async () => {
    const { a, b } = twoTabs()
    await as(a, {}, false)
    mine(3, 2)
    await as(b, {}, false)
    mine(4, 1)
    await inventorySettled()
    expect(Object.keys(inventoryRecordFor(me).devices)).toHaveLength(1)
    expect(totalsOf(inventoryRecordFor(me))).toEqual({ 3: 2, 4: 1 })
  })

  it('one signer prompt per device: a tab whose copy is stale holds back when the other tab has just written', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const { a, b, durable } = twoTabs()
    catchUp(b, durable)
    await as(a)
    mine(3)
    await vi.advanceTimersByTimeAsync(QUIET_MS + 100)
    expect(a.signed).toBe(1)
    // Tab B's copy is from before A's write: it thinks nothing was tried yet.
    await as(b, {}, false)
    mine(3)
    await vi.advanceTimersByTimeAsync(QUIET_MS + 100)
    expect(b.signed).toBe(0)
    // Its write waits for the device's ten minutes, counted from A's try.
    let waited = 0
    while (b.signed < 1 && waited < WRITE_EVERY_MS) { await vi.advanceTimersByTimeAsync(1000); waited += 1000 }
    expect(b.signed).toBe(1)
    expect(waited).toBeGreaterThan(WRITE_EVERY_MS - 2 * QUIET_MS - 2000)
    expect(totalsOf(onRelay()!.rec)['3']).toBe(2)
  })

  it('a hidden tab\'s page-hide write never clobbers the other tab\'s unsynced gains', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const { a, b, durable } = twoTabs()
    await as(a)
    mine(3, 4)
    await syncInventory()
    catchUp(b, durable)
    b.inv = { ...a.inv }
    await vi.advanceTimersByTimeAsync(HIDE_FLOOR_MS + 1000)
    // Tab B mines 3 and has not written; tab A, its copy older than that, mines 1 and goes hidden.
    await as(b, {}, false)
    mine(3, 3)
    await as(a, {}, false)
    mine(7)
    const signed = a.signed
    nudgeInventory('hide')
    await vi.advanceTimersByTimeAsync(100)
    expect(a.signed).toBe(signed + 1)
    await syncInventory(false)
    expect(totalsOf(onRelay()!.rec)).toEqual({ 3: 7, 7: 1 })
    expect(totalsOf(inventoryRecordFor(me))).toEqual({ 3: 7, 7: 1 })
    // B mines on after A's write: still dirty, and written in turn.
    await as(b, {}, false)
    mine(3)
    expect(isDirty(me)).toBe(true)
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)['3']).toBe(8)
  })
})

describe('the sync record lost (review of #972)', () => {
  it('sync 10, wipe only the sync record, reload, mine 1: the relay ends at 11, under the same device id', async () => {
    const d = device()
    d.inv = carriedInto(emptyInventory(), 3, 10)
    await as(d)
    await syncInventory()
    const id = localFor(me).device
    expect(totalsOf(onRelay()!.rec)['3']).toBe(10)
    expect(d.inv.own?.d).toBe(id)
    // Only the sync record goes; TERRAIN's row (d.inv) stays.
    d.storage.m.delete(`onosendai:inventory:${me}`)
    await as(d)
    expect(d.inv.counts[3]).toBe(10)
    mine(3)
    expect(d.inv.counts[3]).toBe(11)
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)['3']).toBe(11)
    expect(Object.keys(onRelay()!.rec.devices)).toEqual([id])
    expect(d.inv.counts[3]).toBe(11)
  })

  it('wiped before it ever reached the relay: the row\'s entry is written then, counted once', async () => {
    const d = device()
    d.live = false
    d.inv = carriedInto(emptyInventory(), 3, 6)
    await as(d)
    d.storage.m.delete(`onosendai:inventory:${me}`)
    d.live = true
    await as(d)
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)['3']).toBe(6)
  })

  it('kvStore blind: nothing migrated, nothing written to the relay; a row already counted comes back as it was', async () => {
    const d = device()
    d.blind = true
    d.inv = carriedInto(emptyInventory(), 3, 5)
    await as(d)
    expect(totalsOf(inventoryRecordFor(me))['3']).toBeUndefined()
    expect(d.inv.counts[3]).toBe(5)
    await syncInventory()
    expect(d.signed).toBe(0)
    // A device that synced before, loading blind (its record unseen): restored from the row, never counted again.
    const e = device()
    e.inv = carriedInto(emptyInventory(), 4, 3)
    await as(e)
    await syncInventory()
    const row = e.inv
    const blind = device()
    blind.blind = true
    blind.inv = row
    await as(blind)
    expect(totalsOf(inventoryRecordFor(me))).toEqual({ 4: 3 })
    expect(blind.inv.counts[4]).toBe(3)
    await syncInventory()
    expect(blind.signed).toBe(0)
  })
})

describe('after a read-back', () => {
  it('a relay copy behind on this device\'s own entry marks it dirty again, and the next write brings it back', async () => {
    const d = device()
    await as(d)
    mine(3, 5)
    await syncInventory()
    expect(isDirty(me)).toBe(false)
    const id = localFor(me).device
    // A newer copy on the relay that holds less of this device (written over by another device's stale write).
    const rk = newRecordKey()
    const wrapped = nip44.encrypt(bytesToHex(rk), selfKey)
    const older: InventoryRecord = { devices: { [id]: { a: { 3: 2 }, s: {}, u: 1 } }, tools: {} }
    const ev = finalizeEvent(recordTemplate(sealRecord(encodeRecord(older), rk, wrapped), onRelay()!.ev.created_at + 5), sk) as unknown as NostrEvent
    await relay.publish(ev)
    await syncInventory(false)
    expect(isDirty(me)).toBe(true)
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)['3']).toBe(5)
  })
})

describe('a device folded into retired by another', () => {
  it('takes a new id on its next read; every total stays the same, and its next gains count under the new id', async () => {
    const d = device()
    await as(d)
    mine(3, 5)
    await syncInventory()
    const id = localFor(me).device
    const rk = newRecordKey()
    const wrapped = nip44.encrypt(bytesToHex(rk), selfKey)
    const folded: InventoryRecord = { devices: {}, tools: {}, retired: { ['f'.repeat(16)]: { ids: { [id]: 1 }, a: { 3: 5 }, s: {} } } }
    await relay.publish(finalizeEvent(recordTemplate(sealRecord(encodeRecord(folded), rk, wrapped), onRelay()!.ev.created_at + 5), sk) as unknown as NostrEvent)
    await syncInventory(false)
    expect(localFor(me).device).not.toBe(id)
    expect(totalsOf(inventoryRecordFor(me))['3']).toBe(5)
    mine(3, 2)
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)['3']).toBe(7)
    expect(d.inv.counts[3]).toBe(7)
  })
})

describe('a device folded while it held numbers it had not written', () => {
  it('starts its new id with them, its entry less its last write: never lost, never counted twice (5 written, 2 not, 7 in all)', async () => {
    const d = device()
    await as(d)
    mine(3, 5)
    await syncInventory()
    const id = localFor(me).device
    // Two more while LOCAL: not written.
    d.live = false
    await as(d, {}, false)
    mine(3, 2)
    d.live = true
    await as(d, {}, false)
    // Meanwhile another device folded this one, holding what it last wrote (5).
    const rk = newRecordKey()
    const wrapped = nip44.encrypt(bytesToHex(rk), selfKey)
    const folded: InventoryRecord = { devices: {}, tools: {}, retired: { ['f'.repeat(16)]: { ids: { [id]: 1 }, a: { 3: 5 }, s: {} } } }
    await relay.publish(finalizeEvent(recordTemplate(sealRecord(encodeRecord(folded), rk, wrapped), onRelay()!.ev.created_at + 5), sk) as unknown as NostrEvent)
    await syncInventory(false)
    const now = localFor(me)
    expect(now.device).not.toBe(id)
    expect(now.rec.devices[now.device].a['3']).toBe(2)
    expect(totalsOf(inventoryRecordFor(me))['3']).toBe(7)
    expect(isDirty(me)).toBe(true)
    await syncInventory()
    expect(totalsOf(onRelay()!.rec)['3']).toBe(7)
  })
})
