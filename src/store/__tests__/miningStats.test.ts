/**
 * miningStats.test.ts: MINING's stats counted, kept per identity and synced
 * (owner, 2026-11-27). Devices share one generated test key and one fake
 * relay that keeps the newest of each addressable event; each has its own
 * storage. Nothing here reaches a network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { matchFilter } from 'nostr-tools/filter'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, type NostrEvent } from '../../lib/events'
import { MINING_D, MINING_KIND, decodeRecord, emptyRecord, encodeRecord, openRecord, recordContent, recordTemplate, sealRecord, totalsOf } from '../../lib/miningRecord'
import {
  HIDE_FLOOR_MS, MAX_AHEAD_S, QUIET_MS, READ_FLOOR_MS, WRITE_EVERY_MS, addTerrainTime, localFor, miningRecordFor, noteMining, nudgeMining, resetMiningStats, setMiningDeps, syncMining,
  useMiningStats, type MiningDeps,
} from '../miningStats'

function fakeRelay() {
  const events: NostrEvent[] = []
  return {
    events,
    trouble: false,
    fetch: async function (filter: Parameters<MiningDeps['fetch']>[0]) { return { events: events.filter((e) => matchFilter(filter, e)), trouble: this.trouble } },
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
  /** Runs inside sign, before it returns: another device writing meanwhile. */
  duringSign?: () => Promise<void>
}

const sk = generateSecretKey()
const me = getPublicKey(sk)
const selfKey = nip44.utils.getConversationKey(sk, me)
const sk2 = generateSecretKey()
const other = getPublicKey(sk2)
let relay = fakeRelay()
let self = me

function device(): Device {
  return { storage: memStorage(), prefs: memStorage(), live: true, tutorial: false, signed: 0, encrypts: 0, decrypts: 0 }
}

/** Run as device `d`: a new load of the app on it (keys opened before are forgotten). */
function as(d: Device, over: Partial<MiningDeps> = {}): void {
  resetMiningStats()
  setMiningDeps({
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
}

/** The record on the relay, opened. */
function onRelay(who = me) {
  const ev = relay.events.find((e) => e.pubkey === who && e.kind === MINING_KIND)
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
})

afterEach(() => {
  vi.useRealTimers()
  resetMiningStats()
  setMiningDeps(null)
})

describe('counting', () => {
  it('each event raises its own counters, on this device\'s entry', () => {
    const d = device()
    as(d)
    noteMining({ type: 'survey', chunk: 'chunk-1' })
    noteMining({ type: 'mine', kind: 42 })
    noteMining({ type: 'mine', kind: 42 })
    noteMining({ type: 'mine', kind: 1 })
    noteMining({ type: 'place', air: false })
    noteMining({ type: 'place', air: true })
    noteMining({ type: 'smash', bare: true, blocks: 5 })
    noteMining({ type: 'smash', bare: false, blocks: 12 })
    noteMining({ type: 'compile' })
    noteMining({ type: 'prize' })
    noteMining({ type: 'compiler' })
    noteMining({ type: 'blueprint', what: 'made' })
    noteMining({ type: 'blueprint', what: 'placed' })
    noteMining({ type: 'blueprint', what: 'found' })
    addTerrainTime(30.6)
    addTerrainTime(0.6)
    const t = totalsOf(miningRecordFor(me))
    expect(t.c).toEqual({ surveys: 1, chunks: 1, mined: 3, placed: 2, placedAir: 1, smashes: 2, smashBare: 1, smashCompiler: 1, smashed: 17, compiles: 1, prizes: 1, bpMade: 1, bpPlaced: 1, bpFound: 1, terrainSec: 31 })
    expect(t.k).toEqual({ 1: 1, 42: 2 })
    const rec = miningRecordFor(me)
    expect(rec.first.survey).toBeGreaterThan(0)
    expect(rec.first.compiler).toBeGreaterThan(0)
    expect(rec.days).toHaveLength(1)
    expect(rec.best.streak).toBe(1)
    expect(Object.keys(rec.devices)).toEqual([localFor(me).device])
  })

  it('a chunk surveyed again counts as a survey, never as a new chunk', () => {
    as(device())
    noteMining({ type: 'survey', chunk: 'k1' })
    noteMining({ type: 'survey', chunk: 'k1' })
    noteMining({ type: 'survey', chunk: 'k2' })
    expect(totalsOf(miningRecordFor(me)).c.surveys).toBe(3)
    expect(totalsOf(miningRecordFor(me)).c.chunks).toBe(2)
  })

  it('each chunk hash is its own small record: a survey reads and writes one, never the whole set', () => {
    const d = device()
    as(d)
    noteMining({ type: 'survey', chunk: 'k1' })
    noteMining({ type: 'survey', chunk: 'k2' })
    const sets: string[] = []
    const write = d.storage.setItem
    d.storage.setItem = (k, v) => { sets.push(k); write(k, v) }
    noteMining({ type: 'survey', chunk: 'k3' })
    noteMining({ type: 'survey', chunk: 'k1' })
    const chunkKeys = [...d.storage.m.keys()].filter((k) => k.startsWith(`onosendai:mining:chunk:${me}:`))
    expect(chunkKeys).toHaveLength(3)
    for (const k of chunkKeys) expect(d.storage.m.get(k)).toBe('1')
    // The new chunk's own record and the counts, nothing else; the one seen before writes only the counts.
    expect(sets.filter((k) => k.includes(':chunk:'))).toHaveLength(1)
    expect(totalsOf(miningRecordFor(me)).c.chunks).toBe(3)
  })

  it('nothing counts during a tutorial run', () => {
    const d = device()
    d.tutorial = true
    as(d)
    noteMining({ type: 'survey', chunk: 'k1' })
    noteMining({ type: 'mine', kind: 1 })
    addTerrainTime(90)
    expect(totalsOf(miningRecordFor(me)).c.surveys).toBe(0)
    expect(totalsOf(miningRecordFor(me)).c.terrainSec).toBe(0)
  })

  it('per identity: each npub its own counts and its own device id on one device, and a switch deletes nothing', () => {
    const d = device()
    as(d)
    noteMining({ type: 'mine', kind: 1 })
    self = other
    noteMining({ type: 'mine', kind: 2 })
    noteMining({ type: 'mine', kind: 2 })
    expect(totalsOf(miningRecordFor(me)).c.mined).toBe(1)
    expect(totalsOf(miningRecordFor(other)).c.mined).toBe(2)
    expect(localFor(me).device).not.toBe(localFor(other).device)
    expect(d.storage.m.has(`onosendai:mining:${me}`)).toBe(true)
    expect(d.storage.m.has(`onosendai:mining:${other}`)).toBe(true)
    // A new load reads each back as it was.
    as(d)
    expect(totalsOf(miningRecordFor(me)).c.mined).toBe(1)
    expect(totalsOf(miningRecordFor(other)).c.mined).toBe(2)
  })
})

describe('syncing', () => {
  it('a first write: one encrypt (a new record key) and one sign; only the d tag public; the next write is a signature only', async () => {
    const d = device()
    as(d)
    noteMining({ type: 'survey', chunk: 'k1' })
    expect((await syncMining()).wrote).toBe(true)
    expect([d.encrypts, d.signed, d.decrypts]).toEqual([1, 1, 0])
    const r = onRelay()!
    expect(r.ev.tags).toEqual([['d', MINING_D]])
    expect(totalsOf(r.rec).c.surveys).toBe(1)
    expect(useMiningStats.getState().status).toBe('synced')
    noteMining({ type: 'survey', chunk: 'k2' })
    expect((await syncMining()).wrote).toBe(true)
    expect([d.encrypts, d.signed, d.decrypts]).toEqual([1, 2, 0])
    // Nothing new: nothing signed.
    expect((await syncMining()).wrote).toBe(false)
    expect(d.signed).toBe(2)
    // A new load costs one decrypt, however many syncs.
    as(d)
    await syncMining(false)
    await syncMining(false)
    expect(d.decrypts).toBe(1)
  })

  it('two devices counting at once: each write reads and merges first, so the total is the sum', async () => {
    const a = device()
    const b = device()
    as(a)
    noteMining({ type: 'survey', chunk: 'a1' })
    noteMining({ type: 'mine', kind: 42 })
    as(b)
    noteMining({ type: 'survey', chunk: 'b1' })
    noteMining({ type: 'survey', chunk: 'b2' })
    as(a); await syncMining()
    as(b); await syncMining()
    const t = totalsOf(onRelay()!.rec)
    expect(t.c.surveys).toBe(3)
    expect(t.c.mined).toBe(1)
    expect(Object.keys(onRelay()!.rec.devices)).toHaveLength(2)
    // A reads B's numbers back, and shows the same totals.
    as(a); await syncMining(false)
    expect(totalsOf(miningRecordFor(me)).c.surveys).toBe(3)
  })

  it('another device writes while this one waits on its signer: nothing is sent over it; it reads, merges and asks the signer again', async () => {
    const a = device()
    const b = device()
    as(b)
    noteMining({ type: 'survey', chunk: 'b1' })
    await syncMining()
    // A's write, prepared, lands during B's next signature.
    as(a)
    noteMining({ type: 'mine', kind: 1 })
    let stash: NostrEvent | null = null
    as(a, { publish: async (ev) => { stash = ev; return { ok: true } } })
    await syncMining()
    as(b)
    noteMining({ type: 'survey', chunk: 'b2' })
    b.duringSign = async () => { await relay.publish(stash!) }
    expect((await syncMining()).wrote).toBe(true)
    // One for its first write, two for this one: the first signed copy was dropped.
    expect(b.signed).toBe(3)
    const t = totalsOf(onRelay()!.rec)
    expect(t.c.surveys).toBe(2)
    expect(t.c.mined).toBe(1)
  })

  it('never written in LOCAL, during a tutorial run, with the switch off, or when the relay did not answer', async () => {
    const d = device()
    as(d)
    noteMining({ type: 'survey', chunk: 'k1' })
    d.live = false
    await syncMining()
    expect(useMiningStats.getState().status).toBe('local')
    d.live = true
    d.tutorial = true
    await syncMining()
    d.tutorial = false
    useMiningStats.getState().setEnabled(false)
    await syncMining()
    expect(useMiningStats.getState().status).toBe('off')
    expect(d.prefs.m.get('onosendai:mining-sync')).toBe('0')
    useMiningStats.getState().setEnabled(true)
    relay.trouble = true
    await syncMining()
    expect(useMiningStats.getState().status).toBe('error')
    expect(relay.events).toHaveLength(0)
    expect(d.signed).toBe(0)
    relay.trouble = false
    await syncMining()
    expect(relay.events).toHaveLength(1)
  })

  it('a record that does not open with the signer is never written over', async () => {
    const d = device()
    as(d)
    noteMining({ type: 'survey', chunk: 'k1' })
    await syncMining()
    as(d, { crypto: () => ({ nip44Encrypt: async () => 'x', nip44Decrypt: async () => { throw new Error('refused') } }) })
    noteMining({ type: 'survey', chunk: 'k2' })
    await syncMining()
    expect(useMiningStats.getState().status).toBe('error')
    expect(totalsOf(onRelay()!.rec).c.surveys).toBe(1)
  })

  it('the plaintext holds counts and dates only: never the chunk, its hash, or a coordinate', async () => {
    as(device())
    const chunk = '0:1099511627776:4096:12'
    noteMining({ type: 'survey', chunk })
    await syncMining()
    const { plain } = onRelay()!
    const json = new TextDecoder().decode((await import('fflate')).inflateSync(Uint8Array.from(atob(plain), (ch) => ch.charCodeAt(0))))
    expect(json).not.toContain(chunk)
    expect(json).not.toContain('1099511627776')
    const salt = localFor(me).salt
    expect(json).not.toContain(bytesToHex(sha256(new TextEncoder().encode(`${salt}:${chunk}`))).slice(0, 16))
    expect(json).not.toContain(salt)
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(['best', 'days', 'devices', 'first', 'v'])
  })
})

describe('the signer\'s cost: writes are throttled', () => {
  it('at most one write in ten minutes however much changes; hiding the page writes too, no sooner than HIDE_FLOOR_MS after the last try', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const d = device()
    as(d)
    noteMining({ type: 'mine', kind: 1 })
    await vi.advanceTimersByTimeAsync(QUIET_MS + 100)
    expect(d.signed).toBe(1)
    // Mining on: nothing more for ten minutes.
    for (let i = 0; i < 20; i++) { noteMining({ type: 'mine', kind: 1 }); await vi.advanceTimersByTimeAsync(20_000) }
    expect(d.signed).toBe(1)
    // The next write comes ten minutes after the first was tried, and not before.
    let waited = 0
    while (d.signed < 2 && waited < WRITE_EVERY_MS) { await vi.advanceTimersByTimeAsync(1000); waited += 1000 }
    expect(d.signed).toBe(2)
    expect(waited).toBeGreaterThan(WRITE_EVERY_MS - 21 * 20_000 - 2000)
    expect(totalsOf(onRelay()!.rec).c.mined).toBe(21)
    // The page hidden after a write, five minutes on: still too soon.
    noteMining({ type: 'mine', kind: 1 })
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    nudgeMining('hide')
    await vi.advanceTimersByTimeAsync(1000)
    expect(d.signed).toBe(2)
    // At the floor, hidden again: written at once (the timer may be asleep in a hidden page).
    await vi.advanceTimersByTimeAsync(HIDE_FLOOR_MS - 5 * 60_000)
    nudgeMining('hide')
    await vi.advanceTimersByTimeAsync(1000)
    expect(d.signed).toBe(3)
    expect(totalsOf(onRelay()!.rec).c.mined).toBe(22)
    // Nothing changed: hiding writes nothing.
    await vi.advanceTimersByTimeAsync(HIDE_FLOOR_MS)
    nudgeMining('hide')
    await vi.advanceTimersByTimeAsync(1000)
    expect(d.signed).toBe(3)
  })

  it('time in TERRAIN alone never asks for a signature; it goes with the next real change', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const d = device()
    as(d)
    noteMining({ type: 'mine', kind: 1 })
    await vi.advanceTimersByTimeAsync(QUIET_MS + 100)
    expect(d.signed).toBe(1)
    // An hour idle in TERRAIN, the page hidden and shown every few minutes.
    for (let t = 0; t < 3600; t += 30) {
      addTerrainTime(30)
      if (t % 300 === 0) nudgeMining('hide')
      await vi.advanceTimersByTimeAsync(30_000)
    }
    expect(d.signed).toBe(1)
    expect(totalsOf(onRelay()!.rec).c.terrainSec ?? 0).toBe(0)
    // The next thing done carries the hour with it.
    noteMining({ type: 'mine', kind: 1 })
    await vi.advanceTimersByTimeAsync(QUIET_MS + 100)
    expect(d.signed).toBe(2)
    expect(totalsOf(onRelay()!.rec).c.terrainSec).toBe(3600)
  })

  it('an hour of play with the app switched every 90 s and the menu opened every 70 s: six signatures at most, one encrypt, one decrypt', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    // A record from another device already there, so the load has something to open.
    const e = device()
    as(e)
    noteMining({ type: 'mine', kind: 2 })
    await syncMining()
    const d = device()
    as(d)
    const HOUR = 3600
    for (let t = 1; t <= HOUR; t++) {
      if (t % 4 === 0) noteMining({ type: 'mine', kind: 1 })
      if (t % 25 === 0) noteMining({ type: 'place', air: false })
      if (t % 30 === 0) addTerrainTime(30)
      // Switching apps: hidden, then shown.
      if (t % 90 === 0) nudgeMining('hide')
      // The menu opened with MINING on screen.
      if (t % 70 === 0) nudgeMining('panel')
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(d.signed).toBeLessThanOrEqual(6)
    expect(d.signed).toBeGreaterThanOrEqual(5)
    expect(d.encrypts).toBe(0)
    expect(d.decrypts).toBe(1)
    // Nothing lost: the relay holds all but the last few minutes, and the device holds everything.
    expect(totalsOf(miningRecordFor(me)).c.mined).toBe(HOUR / 4 + 1)
    expect(totalsOf(onRelay()!.rec).c.mined).toBeGreaterThan(HOUR / 4 - 10 * 60 / 4)
  })

  it('MINING on screen only reads, at most once a minute: never a signature, one decrypt a load', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const e = device()
    as(e)
    noteMining({ type: 'mine', kind: 2 })
    await syncMining()
    const d = device()
    as(d)
    noteMining({ type: 'mine', kind: 1 })
    nudgeMining('panel')
    await vi.advanceTimersByTimeAsync(100)
    expect(d.signed).toBe(0)
    expect(d.decrypts).toBe(1)
    // The other device's numbers, shown.
    expect(totalsOf(miningRecordFor(me)).c.mined).toBe(2)
    // Again within the minute: nothing at all.
    let fetches = 0
    as(d, { fetch: (f) => { fetches++; return relay.fetch(f) } })
    nudgeMining('panel')
    await vi.advanceTimersByTimeAsync(100)
    expect(fetches).toBe(0)
    await vi.advanceTimersByTimeAsync(READ_FLOOR_MS)
    nudgeMining('panel')
    await vi.advanceTimersByTimeAsync(100)
    expect(fetches).toBe(1)
    expect(d.signed).toBe(0)
  })

  it('no timer in LOCAL, and none for a player who never mined', async () => {
    vi.useFakeTimers({ now: 1_790_000_000_000 })
    const d = device()
    d.live = false
    as(d)
    noteMining({ type: 'mine', kind: 1 })
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 3)
    expect(d.signed + d.decrypts + d.encrypts).toBe(0)
    const e = device()
    as(e)
    await vi.advanceTimersByTimeAsync(WRITE_EVERY_MS * 3)
    expect(e.signed + e.decrypts + e.encrypts).toBe(0)
  })
})

describe('the first save failing, and a clock ahead', () => {
  it('a first save the relay keeps refusing wraps one record key a load, not one a try', async () => {
    const d = device()
    as(d, { publish: async () => ({ ok: false, reason: 'refused' }) })
    noteMining({ type: 'mine', kind: 1 })
    await syncMining()
    noteMining({ type: 'mine', kind: 1 })
    await syncMining()
    noteMining({ type: 'mine', kind: 1 })
    await syncMining()
    expect(d.signed).toBe(3)
    expect(d.encrypts).toBe(1)
    expect(useMiningStats.getState().status).toBe('error')
  })

  it('a relay copy dated a day ahead: written under at now (never past now + MAX_AHEAD_S), the counts merged, and not signed under twice', async () => {
    const now = 1_790_000_000_000
    vi.useFakeTimers({ now })
    // Another device, a day fast, wrote a record.
    const fast = device()
    as(fast, { now: () => now + 86_400_000 })
    noteMining({ type: 'mine', kind: 2 })
    noteMining({ type: 'mine', kind: 2 })
    await syncMining()
    const ahead = onRelay()!.ev
    expect(ahead.created_at).toBeGreaterThan(now / 1000 + 86_000)
    const d = device()
    const sent: NostrEvent[] = []
    as(d, { publish: async (ev) => { sent.push(ev); return relay.publish(ev) } })
    noteMining({ type: 'mine', kind: 1 })
    expect((await syncMining()).wrote).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].created_at).toBeLessThanOrEqual(Math.floor(now / 1000) + MAX_AHEAD_S)
    // The fast device's numbers are merged in here; the relay keeps its newer-dated copy.
    expect(totalsOf(miningRecordFor(me)).c.mined).toBe(3)
    expect(onRelay()!.ev.id).toBe(ahead.id)
    // Under that same copy, no second signature this load: said, and left for later.
    noteMining({ type: 'mine', kind: 1 })
    await syncMining()
    expect(d.signed).toBe(1)
    expect(useMiningStats.getState().status).toBe('error')
  })

  it('a relay copy a few seconds ahead is still written one second after it', async () => {
    const now = 1_790_000_000_000
    vi.useFakeTimers({ now })
    const fast = device()
    as(fast, { now: () => now + 20_000 })
    noteMining({ type: 'mine', kind: 2 })
    await syncMining()
    const d = device()
    as(d)
    noteMining({ type: 'mine', kind: 1 })
    expect((await syncMining()).wrote).toBe(true)
    expect(onRelay()!.ev.created_at).toBe(Math.floor(now / 1000) + 21)
    expect(totalsOf(onRelay()!.rec).c.mined).toBe(2)
  })

  it('what a newer client wrote (a counter, a first, a field) is carried through when this one writes', async () => {
    const d = device()
    as(d)
    noteMining({ type: 'mine', kind: 1 })
    await syncMining()
    // A newer client on another device adds things this version does not know.
    const c = recordContent(relay.events[0].content)!
    const key = hexToBytes(nip44.decrypt(c.wrapped, selfKey))
    const rec = decodeRecord(openRecord(c.body, key))
    rec.devices['00112233aabbccdd'] = { c: { mined: 4, quarries: 7 }, k: {}, u: 1_790_000_000, x: { charge: 'full' } }
    rec.first.quarry = 1_789_000_000
    rec.x = { seasons: [1, 2] }
    const at = relayAt() + 1
    relay.events.length = 0
    relay.events.push(finalizeEvent(recordTemplate(sealRecord(encodeRecord(rec), key, c.wrapped), at), sk) as unknown as NostrEvent)
    noteMining({ type: 'mine', kind: 1 })
    await syncMining()
    const back = onRelay()!.rec
    expect(back.devices['00112233aabbccdd'].c.quarries).toBe(7)
    expect(back.devices['00112233aabbccdd'].x).toEqual({ charge: 'full' })
    expect(back.first.quarry).toBe(1_789_000_000)
    expect(back.x).toEqual({ seasons: [1, 2] })
    expect(totalsOf(back).c.mined).toBe(6)
    expect(emptyRecord().x).toBeUndefined()
  })
})

/** The created_at of the record on the relay now. */
function relayAt(): number { return relay.events[0]?.created_at ?? 0 }
