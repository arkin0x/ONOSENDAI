/**
 * starredChunksTabs.test.ts: saved chunks across two tabs of one device and
 * across two full devices (review of #968).
 *
 * Two tabs are two loads of the module sharing one store (the database) with
 * each its own copy in memory that learns of the other tab's writes late, as
 * kvStore's mirror does: a hidden tab hears nothing until it is shown. Every
 * save is a read-merge-write on the stored copy (kvUpdate), so a tab's stale
 * copy never drops what the other tab starred or removed, and the 10-minute
 * write window is the device's. Then two devices with 150 saved chunks each
 * merge: the sync still writes one event and is never stuck. Nothing here
 * reaches a network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { matchFilter, type Filter } from 'nostr-tools/filter'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { MAX_RECORD_CHARS, STARRED_KIND, decodeRecord, openRecord, recordContent, type ChunkSnapshot } from '../../lib/starredChunksRecord'
import { chunkKey } from '../../lib/terrain/coords'

type Mod = typeof import('../starredChunks')

const sk = generateSecretKey()
const me = getPublicKey(sk)
const selfKey = nip44.utils.getConversationKey(sk, me)
const K = (i: number): string => chunkKey({ x: 0x1234567890abcdef12340n + BigInt(i) * 32n, y: 0xfedcba0987654321fed80n, z: 0x0f0f0f0f0f0f0f0f0f0e0n, plane: 0 })
const snap = (n = 2): ChunkSnapshot => ({ g: 'volcanic', k: 14, m: 11, r: [[42, n, 0, 1], [7, 40, 0, 0], [1, 9000, 0, 4000]], d: '0'.repeat(64), v: 0 })

function fakeRelay() {
  const events: NostrEvent[] = []
  return {
    events,
    fetch: async (filter: Filter) => ({ events: events.filter((e) => matchFilter(filter, e)), trouble: false }),
    publish: async (ev: NostrEvent) => {
      const i = events.findIndex((e) => e.pubkey === ev.pubkey && e.kind === ev.kind)
      if (i >= 0 && events[i].created_at >= ev.created_at) return { ok: true as const }
      if (i >= 0) events.splice(i, 1)
      events.push(ev)
      return { ok: true as const }
    },
  }
}

/** The device's database: one store every tab writes in one step, and a lock across tabs. */
function database() {
  const store = new Map<string, string>()
  let held: Promise<unknown> = Promise.resolve()
  const lock = <T,>(_name: string, fn: () => Promise<T>): Promise<T> => {
    const p = held.then(fn, fn)
    held = p.catch(() => undefined)
    return p
  }
  return { store, lock }
}

/** One tab: its own copy in memory (kvStore's mirror), which hears the other tab's writes only when told to. */
function tab(db: ReturnType<typeof database>) {
  const mirror = new Map(db.store)
  return {
    mirror,
    signed: 0,
    hear: () => { mirror.clear(); for (const [k, v] of db.store) mirror.set(k, v) },
    storage: {
      getItem: (k: string) => mirror.get(k) ?? null,
      setItem: (k: string, v: string) => { mirror.set(k, v); db.store.set(k, v) },
      removeItem: (k: string) => { mirror.delete(k); db.store.delete(k) },
    },
    update: async (k: string, fn: (stored: string | null) => string | null) => {
      await Promise.resolve()
      const next = fn(db.store.get(k) ?? null)
      if (next === null) { db.store.delete(k); mirror.delete(k) } else { db.store.set(k, next); mirror.set(k, next) }
      return next
    },
  }
}

let relay = fakeRelay()

/** A fresh load of the module, as a new tab is. */
async function load(): Promise<Mod> {
  vi.resetModules()
  return import('../starredChunks')
}

function start(m: Mod, t: ReturnType<typeof tab>, db: ReturnType<typeof database>): void {
  m.setStarredDeps({
    self: () => me,
    live: () => true,
    tutorial: () => false,
    crypto: () => ({ nip44Encrypt: async (p) => nip44.encrypt(p, selfKey), nip44Decrypt: async (c) => nip44.decrypt(c, selfKey) }),
    fetch: (f) => relay.fetch(f),
    sign: async (tpl) => { t.signed++; return finalizeEvent(tpl, sk) as unknown as NostrEvent },
    publish: (ev) => relay.publish(ev),
    storage: t.storage,
    update: t.update,
    lock: db.lock,
    prefs: null,
    now: () => Date.now(),
    verify: (ev) => verifyEvent({ ...ev } as Parameters<typeof verifyEvent>[0]),
  })
}

/** The list as stored, read. */
function stored(db: ReturnType<typeof database>) {
  const raw = db.store.get(`onosendai:starred-chunks:${me}`)
  return raw ? (JSON.parse(raw) as { rec: { e: Record<string, unknown>; x: Record<string, number> }; triedAt: number }) : null
}

/** The record on the relay, opened. */
function onRelay() {
  const ev = relay.events.find((e) => e.pubkey === me && e.kind === STARRED_KIND)
  if (!ev) return null
  const c = recordContent(ev.content)!
  return { ev, rec: decodeRecord(openRecord(c.body, hexToBytes(nip44.decrypt(c.wrapped, selfKey)))) }
}

beforeEach(() => { relay = fakeRelay() })
afterEach(() => { vi.useRealTimers() })

describe('two tabs of one device', () => {
  it('a hidden tab\'s timer never drops a star or unstar made in the other tab', async () => {
    vi.useFakeTimers({ now: 1_795_800_000_000 })
    const db = database()
    const a = tab(db), b = tab(db)
    const A = await load(); start(A, a, db)
    const B = await load(); start(B, b, db)
    // B stars K1; A is hidden and hears nothing.
    B.starChunk(K(1), snap())
    await B.starredWrites()
    expect(Object.keys(stored(db)!.rec.e)).toEqual([K(1)])
    expect(A.localFor(me).rec.e[K(1)]).toBeUndefined()
    // A, still stale, stars K2: written over the stored copy, never over K1.
    A.starChunk(K(2), snap())
    await A.starredWrites()
    expect(Object.keys(stored(db)!.rec.e).sort()).toEqual([K(1), K(2)].sort())
    // B removes K1. A's copy (its own write) still holds K1, and a card it counts there brings nothing back.
    B.unstarChunk(K(1))
    await B.starredWrites()
    expect(A.localFor(me).rec.e[K(1)]).toBeDefined()
    expect(A.refreshSnapshot(K(1), snap(1))).toBe(true)
    await A.starredWrites()
    expect(stored(db)!.rec.e[K(1)]).toBeUndefined()
    expect(stored(db)!.rec.x[K(1)]).toBeGreaterThan(0)
    // A's timer fires while hidden: its sync writes the stored list (K2, K1 removed), never its stale copy.
    await vi.advanceTimersByTimeAsync(A.WRITE_EVERY_MS + A.QUIET_MS + 1000)
    const r = onRelay()!
    expect(Object.keys(r.rec.e)).toEqual([K(2)])
    expect(r.rec.x[K(1)]).toBeGreaterThan(0)
    expect(Object.keys(stored(db)!.rec.e)).toEqual([K(2)])
    // Shown again, A lists what is stored, and so does B.
    a.hear()
    A.heardElsewhere(`onosendai:starred-chunks:${me}`)
    expect(A.useStarredChunks.getState().entries.map((e) => e.c)).toEqual([K(2)])
    b.hear()
    B.heardElsewhere(`onosendai:starred-chunks:${me}`)
    expect(B.useStarredChunks.getState().entries.map((e) => e.c)).toEqual([K(2)])
  })

  it('the write window is the device\'s: two tabs starring for an hour sign about six times between them', async () => {
    vi.useFakeTimers({ now: 1_795_800_000_000 })
    const db = database()
    const a = tab(db), b = tab(db)
    const A = await load(); start(A, a, db)
    const B = await load(); start(B, b, db)
    for (let t = 1; t <= 3600; t++) {
      if (t % 50 === 0) A.starChunk(K(t), snap())
      if (t % 70 === 0) B.starChunk(K(100_000 + t), snap())
      if (t % 90 === 0) { A.nudgeStarred('hide'); B.nudgeStarred('hide') }
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(a.signed + b.signed).toBeLessThanOrEqual(7)
    expect(a.signed + b.signed).toBeGreaterThanOrEqual(5)
    // Every star from both tabs is stored.
    expect(Object.keys(stored(db)!.rec.e)).toHaveLength(3600 / 50 + Math.floor(3600 / 70))
  })
})

describe('two full devices', () => {
  it('150 saved chunks on each merge into one event, never a stuck sync; a star past it says the list is full', async () => {
    vi.useFakeTimers({ now: 1_795_800_000_000 })
    const one = database(), two = database()
    const t1 = tab(one), t2 = tab(two)
    // Varied cards, as real ones are.
    let seed = 11
    const rnd = (n: number): number => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n }
    const ids = [197, 192, 196, 43, 195, 194, 193, 42, 7, 12, 8, 13, 14, 41, 40, 9]
    const card = (i: number): ChunkSnapshot => ({ g: 'volcanic', k: i % 17, m: 9.5, r: ids.map((id) => [id, rnd(5000), rnd(300), rnd(2000)] as [number, number, number, number]), d: Array.from({ length: 64 }, () => '0123456789abcdef'[rnd(16)]).join(''), v: 1795000000 + rnd(9999999) })
    const D1 = await load(); start(D1, t1, one)
    for (let i = 0; i < 150; i++) expect(D1.starChunk(K(i * 37), card(i))).toBe(true)
    await D1.syncStarred()
    expect(t1.signed).toBe(1)
    const D2 = await load(); start(D2, t2, two)
    for (let i = 0; i < 150; i++) expect(D2.starChunk(K(900_000 + i * 41), card(i + 7))).toBe(true)
    await D2.starredWrites()
    // The second device's write: 300 chunks merged; what does not fit stays on the device, and the write still goes.
    const out = await D2.syncStarred()
    expect(out.wrote).toBe(true)
    expect(D2.useStarredChunks.getState().status).toBe('synced')
    // One event, as any record its size: a sealed body of at most MAX_RECORD_CHARS, some 55,000 characters with its seal.
    expect(relay.events[0].content.length).toBeLessThan(56_000)
    expect(MAX_RECORD_CHARS).toBe(40_000)
    // Every chunk is on the relay; the oldest went without their cards to fit (each device keeps the cards it has).
    const merged = onRelay()!.rec
    expect(Object.keys(merged.e)).toHaveLength(300)
    expect(Object.values(merged.e).filter((e) => !e.s).length).toBeGreaterThan(0)
    expect(D2.useStarredChunks.getState().entries).toHaveLength(300)
    // Full: a new star is refused with the reason, and the next change still syncs.
    expect(D2.starChunkWhy(K(5_000_000), card(1))).toBe('full')
    D2.renameChunk(K(900_000), 'Glowcore cave')
    await vi.advanceTimersByTimeAsync(D2.WRITE_EVERY_MS + D2.QUIET_MS + 1000)
    expect(t2.signed).toBe(2)
    expect(onRelay()!.rec.e[K(900_000)]?.n).toBe('Glowcore cave')
  })

  it('a star with nobody signed in says so', async () => {
    const M = await load()
    M.setStarredDeps({ self: () => '', storage: null, prefs: null })
    expect(M.starChunkWhy(K(1), snap())).toBe('no-identity')
  })
})
