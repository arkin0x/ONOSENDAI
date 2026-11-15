/**
 * hidesSync.test.ts: your hides on every device signed in as you (owner
 * ruling, 2026-11-15). Two devices share one generated test key and one fake
 * relay that keeps the newest of each addressable event; each has its own
 * storage and its own list. Nothing here reaches a network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { matchFilter } from 'nostr-tools/filter'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, type NostrEvent } from '../../lib/events'
import { HIDES_KIND, shardContent, type HideEntry } from '../../lib/hidesRecord'
import { entriesOf, noteListChange, resetHidesSync, setHidesDeps, syncHides, useHidesSync, type HidesDeps } from '../hidesSync'
import type { MyDeployment } from '../useShards'

const hex = (s: string): string => bytesToHex(sha256(new TextEncoder().encode(s)))

/** A relay that keeps the newest of each addressable event, as strfry and grain do. */
function fakeRelay() {
  const events: NostrEvent[] = []
  return {
    events,
    fetch: async (filter: Parameters<HidesDeps['fetch']>[0]) => ({ events: events.filter((e) => matchFilter(filter, e)), trouble: false }),
    publish: async (ev: NostrEvent) => {
      const d = ev.tags.find((t) => t[0] === 'd')?.[1]
      const i = events.findIndex((e) => e.pubkey === ev.pubkey && e.kind === ev.kind && e.tags.find((t) => t[0] === 'd')?.[1] === d)
      if (i >= 0 && (events[i].created_at > ev.created_at || (events[i].created_at === ev.created_at && events[i].id < ev.id))) return { ok: true as const }
      if (i >= 0) events.splice(i, 1)
      events.push(ev)
      return { ok: true as const }
    },
  }
}

function memStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
}

/** A row of `mine`, as a hide leaves it. */
function row(name: string, me: string, opts: Partial<MyDeployment> = {}): MyDeployment {
  return {
    eventId: hex(`item:${name}`), inner: { id: hex(`item:${name}`), pubkey: me, kind: 1, created_at: 1_700_000_000, tags: [], content: name } as MyDeployment['inner'],
    bagId: hex(`bag:${name}`), type: 'message', text: name, at: { x: '1099511627776', y: '5', z: '9' }, plane: 0, height: 12,
    lookupId: hex(`lookup:${name}`), keyHex: hex(`key:${name}`), relays: [], createdAt: 1_700_000_000, published: true, bagAt: 1_700_000_000, ...opts,
  }
}

interface Device {
  rows: MyDeployment[]
  storage: ReturnType<typeof memStorage>
  live: boolean
  tutorial: boolean
  nip44: boolean
  adopted: HideEntry[][]
  signs: number
  decrypts: number
  encrypts: number
}

const sk = generateSecretKey()
const me = getPublicKey(sk)
const selfKey = nip44.utils.getConversationKey(sk, me)
let clock = 1_700_001_000
let relay = fakeRelay()
/** The bags on the relay, as adopting finds them: lookup id to the rows a scan would file. */
let bagsOnRelay = new Map<string, MyDeployment[]>()

function device(rows: MyDeployment[] = []): Device {
  return { rows, storage: memStorage(), live: true, tutorial: false, nip44: true, adopted: [], signs: 0, decrypts: 0, encrypts: 0 }
}

/** Make `d` the device the sync runs as. */
function as(d: Device, over: Partial<HidesDeps> = {}): void {
  setHidesDeps({
    self: () => me,
    live: () => d.live,
    tutorial: () => d.tutorial,
    crypto: () => (d.nip44
      ? { nip44Encrypt: async (pt) => { d.encrypts++; return nip44.encrypt(pt, selfKey) }, nip44Decrypt: async (ct) => { d.decrypts++; return nip44.decrypt(ct, selfKey) } }
      : {}),
    fetch: relay.fetch,
    sign: async (t) => { d.signs++; return finalizeEvent(t, sk) as unknown as NostrEvent },
    publish: relay.publish,
    rows: () => d.rows,
    adopt: async (entries) => {
      d.adopted.push(entries)
      // As claimOwn: what the bag holds, filed once.
      for (const e of entries) for (const r of bagsOnRelay.get(e.l) ?? []) if (!d.rows.some((x) => x.eventId === r.eventId)) d.rows = [...d.rows, r]
    },
    now: () => clock,
    storage: d.storage,
    verify: (ev) => verifyEvent({ ...ev } as Parameters<typeof verifyEvent>[0]),
    ...over,
  })
}

function hidden(...rows: MyDeployment[]): void {
  for (const r of rows) bagsOnRelay.set(r.lookupId, [...(bagsOnRelay.get(r.lookupId) ?? []), r])
}

beforeEach(() => {
  vi.useFakeTimers()
  relay = fakeRelay()
  bagsOnRelay = new Map()
  clock = 1_700_001_000
  resetHidesSync()
  useHidesSync.setState({ enabled: true, status: 'idle', note: null })
})
afterEach(() => { resetHidesSync(); vi.useRealTimers(); setHidesDeps(null) })

describe('one record, encrypted to you', () => {
  it('a write leaves nothing readable: one kind 30078 with only its d, the bag ids and keys sealed', async () => {
    const a = device([row('alpha', me), row('beta', me)])
    as(a)
    const out = await syncHides()
    expect(out.wrote).toBe(1)
    expect(relay.events).toHaveLength(1)
    const ev = relay.events[0]
    expect(ev.kind).toBe(HIDES_KIND)
    expect(ev.tags.filter((t) => t[0] !== 'client')).toEqual([['d', 'onosendai/hides/0']])
    for (const r of a.rows) {
      expect(ev.content).not.toContain(r.lookupId)
      expect(ev.content).not.toContain(r.keyHex)
    }
    expect(ev.content).not.toContain('alpha')
    // The record key is wrapped from you to you with NIP-44.
    expect(nip44.decrypt(shardContent(ev.content)!.wrapped, selfKey)).toMatch(/^[0-9a-f]{64}$/)
    expect(a.encrypts).toBe(1)
  })

  it('a second device shows the first device\'s hides, with what opens them', async () => {
    const r1 = row('one', me)
    const r2 = row('two', me, { room: { doorId: hex('door') } })
    hidden(r1, r2)
    const a = device([r1, r2])
    as(a)
    await syncHides()
    // Another device: its own memory.
    const b = device()
    resetHidesSync(); as(b)
    await syncHides()
    expect(b.adopted).toHaveLength(1)
    const got = Object.fromEntries(b.adopted[0].map((e) => [e.l, e]))
    expect(got[r1.lookupId]).toMatchObject({ k: r1.keyHex, h: 12, p: 0, x: r1.at.x, y: r1.at.y, z: r1.at.z, n: 'one', c: 1 })
    expect(got[r2.lookupId].r).toBe(hex('door'))
    expect(b.rows.map((r) => r.eventId).sort()).toEqual([r1.eventId, r2.eventId].sort())
    // One signer decrypt for the whole record on this load, none on the next sync.
    expect(b.decrypts).toBe(1)
    await syncHides()
    expect(b.decrypts).toBe(1)
  })

  it('a bag kept LOCAL is not in the record: no other device could open it', () => {
    const rows = [row('out', me), row('kept', me, { published: false }), row('gone', me, { goneFrom: 1 })]
    expect(Object.keys(entriesOf(rows))).toEqual([rows[0].lookupId])
  })
})

describe('the union', () => {
  it('a device that lacks the relay\'s entries never drops them', async () => {
    const a = device([row('a1', me), row('a2', me)])
    as(a)
    await syncHides()
    // Device B knows only its own bag and cannot open A's (adopting finds nothing).
    const b = device([row('b1', me)])
    as(b)
    clock += 10
    await syncHides()
    const c = device()
    as(c)
    await syncHides()
    expect(c.adopted[0].map((e) => e.n).sort()).toEqual(['a1', 'a2', 'b1'])
  })

  it('two devices writing at once: neither loses its entries', async () => {
    const a = device([row('fromA', me)])
    const b = device([row('fromB', me)])
    hidden(...a.rows, ...b.rows)
    // Both read the empty relay before either writes: the classic lost update.
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const slow = async (f: Parameters<HidesDeps['fetch']>[0]) => { const got = await relay.fetch(f); await gate; return got }
    as(a, { fetch: slow })
    const pa = syncHides()
    await vi.advanceTimersByTimeAsync(0)
    // B's sync runs on its own device: its own queue, its own deps.
    resetHidesSync()
    as(b, { fetch: slow })
    const pb = syncHides()
    await vi.advanceTimersByTimeAsync(0)
    release()
    await Promise.all([pa, pb])
    // The later write replaced the earlier on the relay.
    expect(relay.events).toHaveLength(1)
    // Each device reads back (VERIFY_MS) and writes the union.
    resetHidesSync(); as(a); clock += 5; await syncHides()
    resetHidesSync(); as(b); clock += 5; await syncHides()
    const c = device()
    resetHidesSync(); as(c); await syncHides()
    expect(c.adopted[0].map((e) => e.n).sort()).toEqual(['fromA', 'fromB'])
  })

  it('a write is checked a little later and written again when another device landed over it', async () => {
    const a = device([row('mine', me)])
    as(a)
    await syncHides()
    // Another device writes a record without A's entry, newer.
    const other = device([row('theirs', me)])
    resetHidesSync(); as(other, { fetch: async () => ({ events: [], trouble: false }) })
    clock += 3
    await syncHides()
    resetHidesSync(); as(a)
    clock += 3
    const first = await syncHides()
    expect(first.wrote).toBe(1)
    const c = device()
    resetHidesSync(); as(c); await syncHides()
    expect(c.adopted[0].map((e) => e.n).sort()).toEqual(['mine', 'theirs'])
  })
})

describe('taking a bag off your list', () => {
  it('leaves a tombstone that keeps an older copy from bringing it back, and drops nothing on another device', async () => {
    const keep = row('keep', me)
    const del = row('delete-me', me)
    hidden(keep, del)
    const a = device([keep, del])
    as(a)
    await syncHides()
    const b = device()
    resetHidesSync(); as(b); await syncHides()
    expect(b.rows).toHaveLength(2)
    // A deletes one: its list changes, and the bag is tombstoned now.
    clock += 100
    resetHidesSync(); as(a)
    const before = a.rows
    a.rows = [keep]
    noteListChange(me, before, a.rows)
    await syncHides()
    // B still lists it (never dropped here) and syncs: its older copy does not bring it back.
    resetHidesSync(); as(b)
    clock += 5
    await syncHides()
    expect(b.rows).toHaveLength(2)
    const c = device()
    resetHidesSync(); as(c); await syncHides()
    expect(c.adopted[0].map((e) => e.n)).toEqual(['keep'])
  })

  it('a bag that comes back to the list is newer than its tombstone', async () => {
    const r = row('back', me)
    const a = device([r])
    as(a)
    await syncHides()
    clock += 10
    noteListChange(me, [r], [])
    clock += 1
    noteListChange(me, [], [r])
    await syncHides()
    const c = device()
    resetHidesSync(); as(c); await syncHides()
    expect(c.adopted[0].map((e) => e.n)).toEqual(['back'])
  })

  it('a list that loses most of itself at once is not read as deletions', async () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((n) => row(n, me))
    const a = device(rows)
    as(a)
    noteListChange(me, rows, [])
    expect(a.storage.getItem(`onosendai:hides-gone:${me}`) ?? '{}').toBe('{}')
  })
})

describe('what publishes nothing', () => {
  it('LOCAL reads and adopts, and writes nothing', async () => {
    const r = row('x', me)
    hidden(r)
    const a = device([r])
    as(a)
    await syncHides()
    const n = relay.events.length
    const b = device([row('local-only-device', me)])
    b.live = false
    resetHidesSync(); as(b)
    await syncHides()
    expect(relay.events).toHaveLength(n)
    expect(b.signs).toBe(0)
    expect(b.encrypts).toBe(0)
    expect(useHidesSync.getState().status).toBe('local')
    expect(b.rows.map((d) => d.eventId)).toContain(r.eventId)
  })

  it('a tutorial run writes nothing', async () => {
    const a = device([row('t', me)])
    a.tutorial = true
    as(a)
    await syncHides()
    expect(relay.events).toHaveLength(0)
    expect(a.signs).toBe(0)
  })

  it('a signer with no NIP-44 is skipped quietly, and says so', async () => {
    const a = device([row('n', me)])
    a.nip44 = false
    as(a)
    await syncHides()
    expect(relay.events).toHaveLength(0)
    expect(useHidesSync.getState().status).toBe('unsupported')
    expect(useHidesSync.getState().note).toMatch(/NIP-44/)
  })

  it('the switch off writes and reads nothing', async () => {
    const a = device([row('off', me)])
    as(a)
    useHidesSync.setState({ enabled: false })
    await syncHides()
    expect(relay.events).toHaveLength(0)
    expect(a.decrypts).toBe(0)
  })

  it('no answer from the canonical relay: nothing is written over what it may hold', async () => {
    const a = device([row('q', me)])
    as(a, { fetch: async () => ({ events: [], trouble: true }) })
    await syncHides()
    expect(relay.events).toHaveLength(0)
    expect(useHidesSync.getState().status).toBe('error')
  })

  it('a shard that does not open is never written over', async () => {
    const a = device([row('first', me)])
    as(a)
    await syncHides()
    // The record key was wrapped by a key that is not this signer's.
    const ev = relay.events[0]
    const forged = finalizeEvent({ kind: HIDES_KIND, created_at: ev.created_at + 1, tags: [['d', 'onosendai/hides/0']], content: `1:${nip44.encrypt(hex('k'), nip44.utils.getConversationKey(generateSecretKey(), me))}:${shardContent(ev.content)!.body}` }, sk) as unknown as NostrEvent
    await relay.publish(forged)
    const b = device([row('second', me)])
    resetHidesSync(); as(b)
    clock += 10
    const out = await syncHides()
    expect(out.wrote).toBe(0)
    expect(relay.events[0].id).toBe(forged.id)
  })

  it('another person\'s 30078 under our d is ignored', async () => {
    const stranger = generateSecretKey()
    await relay.publish(finalizeEvent({ kind: HIDES_KIND, created_at: clock, tags: [['d', 'onosendai/hides/0']], content: 'junk' }, stranger) as unknown as NostrEvent)
    const a = device([row('mine', me)])
    as(a)
    const out = await syncHides()
    expect(out.wrote).toBe(1)
  })
})
