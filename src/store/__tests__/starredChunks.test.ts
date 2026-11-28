/**
 * starredChunks.test.ts: your saved chunks, kept per identity and synced
 * privately (owner, 2026-11-28). Devices share one generated test key and one
 * fake relay that keeps the newest of each addressable event; each has its own
 * storage. Nothing here reaches a network.
 *
 * - star, unstar and UNDO; renaming; a fresh card kept without a signature;
 * - the list per identity on this device: switching never deletes;
 * - the sealed record: only `d` public, the merge with tombstones across devices;
 * - the signer's cost: at most about six signatures in an hour of starring;
 * - nothing written in LOCAL, during the tutorial, or with sync off;
 * - the guide: waypoint and HUD target each on or off, one chunk at a time,
 *   ending when you arrive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { matchFilter } from 'nostr-tools/filter'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { STARRED_D, STARRED_KIND, decodeRecord, openRecord, recordContent, type ChunkSnapshot } from '../../lib/starredChunksRecord'
import { chunkKey } from '../../lib/terrain/coords'
import {
  HIDE_FLOOR_MS, QUIET_MS, UNDO_MS, WRITE_EVERY_MS, endGuide, expireUndo, guideTo, identityChanged, isDirty, localFor, nudgeStarred, refreshSnapshot, renameChunk,
  resetStarredChunks, setHudTarget, setStarredDeps, setWaypoint, starChunk, syncStarred, undoRemove, unstarChunk, useStarredChunks, type StarredDeps,
} from '../starredChunks'
import { crossed } from '../starredChunksLive'
import { useToast } from '../useToast'

function fakeRelay() {
  const events: NostrEvent[] = []
  return {
    events,
    trouble: false,
    fetch: async function (filter: Parameters<StarredDeps['fetch']>[0]) { return { events: events.filter((e) => matchFilter(filter, e)), trouble: this.trouble } },
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

/** Run as device `d`: a new load of the app on it. */
function as(d: Device, over: Partial<StarredDeps> = {}): void {
  resetStarredChunks()
  setStarredDeps({
    self: () => self,
    live: () => d.live,
    tutorial: () => d.tutorial,
    crypto: () => ({
      nip44Encrypt: async (p) => { d.encrypts++; return nip44.encrypt(p, self === me ? selfKey : nip44.utils.getConversationKey(sk2, other)) },
      nip44Decrypt: async (c) => { d.decrypts++; return nip44.decrypt(c, self === me ? selfKey : nip44.utils.getConversationKey(sk2, other)) },
    }),
    fetch: (f) => relay.fetch(f),
    sign: async (t) => { d.signed++; return finalizeEvent(t, self === me ? sk : sk2) as unknown as NostrEvent },
    publish: (ev) => relay.publish(ev),
    storage: d.storage,
    prefs: d.prefs,
    now: () => Date.now(),
    verify: (ev) => verifyEvent({ ...ev } as Parameters<typeof verifyEvent>[0]),
    ...over,
  })
}

/** The record on the relay, opened. */
function onRelay() {
  const ev = relay.events.find((e) => e.pubkey === me && e.kind === STARRED_KIND)
  if (!ev) return null
  const c = recordContent(ev.content)!
  const key = hexToBytes(nip44.decrypt(c.wrapped, selfKey))
  return { ev, rec: decodeRecord(openRecord(c.body, key)) }
}

const K = (i: number, plane = 0): string => chunkKey({ x: 0x1234567890abcdef12340n + BigInt(i) * 32n, y: 0xfedcba0987654321fed80n, z: 0x0f0f0f0f0f0f0f0f0f0e0n, plane })
const snap = (glow = 2): ChunkSnapshot => ({ g: 'volcanic', k: 14, m: 11, r: [[42, glow, 0, 1], [7, 40, 0, 0], [1, 9000, 0, 1]], d: '0'.repeat(64), v: 0 })

beforeEach(() => {
  relay = fakeRelay()
  self = me
})

afterEach(() => {
  vi.useRealTimers()
  resetStarredChunks()
  setStarredDeps(null)
})

describe('starring', () => {
  it('star, unstar and UNDO: the entry comes back as it was, newer than its tombstone', () => {
    vi.useFakeTimers({ now: 1_795_800_000_000 })
    const d = device()
    as(d, { live: () => false })
    expect(starChunk(K(1), snap())).toBe(true)
    expect(useStarredChunks.getState().keys.has(K(1))).toBe(true)
    expect(renameChunk(K(1), '  Glowcore   cave ')).toBe(true)
    const removed = unstarChunk(K(1))
    expect(removed?.n).toBe('Glowcore cave')
    expect(useStarredChunks.getState().keys.has(K(1))).toBe(false)
    expect(localFor(me).rec.x[K(1)]).toBeGreaterThan(0)
    expect(useStarredChunks.getState().removed?.entry.c).toBe(K(1))
    vi.advanceTimersByTime(1000)
    expect(undoRemove()).toBe(true)
    const back = localFor(me).rec.e[K(1)]
    expect(back.n).toBe('Glowcore cave')
    expect(back.s?.r[0]).toEqual([42, 2, 0, 1])
    expect(back.t).toBeGreaterThan(removed!.t)
    expect(localFor(me).rec.x[K(1)]).toBeUndefined()
  })

  it('UNDO goes when its time is up, and the removal stands', () => {
    vi.useFakeTimers({ now: 1_795_800_000_000 })
    as(device(), { live: () => false })
    starChunk(K(1), snap())
    unstarChunk(K(1))
    expireUndo(Date.now() + UNDO_MS - 1)
    expect(useStarredChunks.getState().removed).not.toBeNull()
    expireUndo(Date.now() + UNDO_MS)
    expect(useStarredChunks.getState().removed).toBeNull()
    expect(undoRemove()).toBe(false)
    expect(useStarredChunks.getState().keys.has(K(1))).toBe(false)
  })

  it('a fresh card is kept only when it says something new, and never makes a write by itself', () => {
    as(device(), { live: () => false })
    starChunk(K(1), snap(2))
    const real = localFor(me).real
    expect(refreshSnapshot(K(1), snap(2))).toBe(false)
    expect(refreshSnapshot(K(1), snap(1))).toBe(true)
    expect(localFor(me).rec.e[K(1)].s?.r[0][1]).toBe(1)
    expect(localFor(me).real).toBe(real)
    // Not saved: not kept.
    expect(refreshSnapshot(K(2), snap())).toBe(false)
  })

  it('keeps each identity\'s list on this device: switching never deletes', () => {
    const d = device()
    as(d, { live: () => false })
    starChunk(K(1), snap())
    self = other
    identityChanged()
    expect(useStarredChunks.getState().entries).toEqual([])
    starChunk(K(2), snap())
    self = me
    identityChanged()
    expect(useStarredChunks.getState().entries.map((e) => e.c)).toEqual([K(1)])
    // Kept per npub under its own name.
    expect([...d.storage.m.keys()].sort()).toEqual([`onosendai:starred-chunks:${me}`, `onosendai:starred-chunks:${other}`].sort())
    // A new load of the app on the device reads them back.
    as(d, { live: () => false })
    expect(useStarredChunks.getState().entries.map((e) => e.c)).toEqual([K(1)])
  })
})

describe('the sync', () => {
  it('writes one sealed event with only the d tag public; another device merges, tombstones keep a removal removed', async () => {
    const a = device()
    as(a)
    starChunk(K(1), snap())
    starChunk(K(2), snap())
    await syncStarred()
    const first = onRelay()!
    expect(first.ev.tags).toEqual([['d', STARRED_D]])
    expect(JSON.stringify(first.ev).includes(K(1).split(':')[1])).toBe(false)
    expect(Object.keys(first.rec.e).sort()).toEqual([K(1), K(2)].sort())
    expect(a.encrypts).toBe(1)

    const b = device()
    as(b)
    await syncStarred(false)
    expect(useStarredChunks.getState().entries.map((e) => e.c).sort()).toEqual([K(1), K(2)].sort())
    unstarChunk(K(1))
    starChunk(K(3), snap())
    await syncStarred()
    expect(b.signed).toBe(1)
    expect(b.encrypts).toBe(0)

    // Back on the first device, which still holds K(1): the tombstone wins.
    as(a)
    await syncStarred(false)
    expect(useStarredChunks.getState().entries.map((e) => e.c).sort()).toEqual([K(2), K(3)].sort())
    expect(onRelay()!.rec.x[K(1)]).toBeGreaterThan(0)
  })

  it('an hour of starring, renaming, mining in saved chunks and switching apps: about six signatures at most', async () => {
    vi.useFakeTimers({ now: 1_795_800_000_000 })
    const d = device()
    as(d)
    for (let t = 1; t <= 3600; t++) {
      if (t % 45 === 0) starChunk(K(t), snap())
      if (t % 100 === 0) renameChunk(K(45), `cave ${t}`)
      if (t % 5 === 0) refreshSnapshot(K(45), snap(t % 3))
      if (t % 90 === 0) nudgeStarred('hide')
      if (t % 70 === 0) nudgeStarred('panel')
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(d.signed).toBeLessThanOrEqual(7)
    expect(d.signed).toBeGreaterThanOrEqual(5)
    expect(d.encrypts).toBe(1)
    // Nothing lost: the device holds every star, the relay all but the last minutes'.
    expect(useStarredChunks.getState().entries.length).toBe(80)
    expect(Object.keys(onRelay()!.rec.e).length).toBeGreaterThan(80 - WRITE_EVERY_MS / 45_000 - 1)
  })

  it('starring writes after QUIET_MS when nothing was written in the last ten minutes, else waits for the window', async () => {
    vi.useFakeTimers({ now: 1_795_800_000_000 })
    const d = device()
    as(d)
    starChunk(K(1), snap())
    await vi.advanceTimersByTimeAsync(QUIET_MS + 100)
    expect(d.signed).toBe(1)
    starChunk(K(2), snap())
    await vi.advanceTimersByTimeAsync(QUIET_MS + 100)
    expect(d.signed).toBe(1)
    // Hidden before the floor: nothing; at the floor: written.
    nudgeStarred('hide')
    await vi.advanceTimersByTimeAsync(100)
    expect(d.signed).toBe(1)
    await vi.advanceTimersByTimeAsync(HIDE_FLOOR_MS)
    expect(d.signed).toBe(2)
    expect(isDirty(me)).toBe(false)
  })

  it('never writes in LOCAL, during the tutorial, or with sync off; the stars wait on the device', async () => {
    vi.useFakeTimers({ now: 1_795_800_000_000 })
    for (const which of ['local', 'tutorial', 'off'] as const) {
      relay = fakeRelay()
      const d = device()
      if (which === 'local') d.live = false
      if (which === 'tutorial') d.tutorial = true
      as(d)
      if (which === 'off') useStarredChunks.getState().setEnabled(false)
      starChunk(K(1), snap())
      renameChunk(K(1), 'cave')
      nudgeStarred('hide')
      await vi.advanceTimersByTimeAsync(2 * WRITE_EVERY_MS)
      await syncStarred()
      expect(d.signed).toBe(0)
      expect(relay.events).toHaveLength(0)
      expect(useStarredChunks.getState().keys.has(K(1))).toBe(true)
      expect(isDirty(me)).toBe(true)
      if (which === 'off') expect(d.prefs.m.get('onosendai:starred-sync')).toBe('0')
    }
  })
})

describe('the guide', () => {
  it('the waypoint and the HUD target are each on or off; one chunk at a time; both off ends it', () => {
    as(device(), { live: () => false })
    starChunk(K(1), snap())
    starChunk(K(2), snap())
    setWaypoint(K(1), true)
    expect(useStarredChunks.getState().guide).toEqual({ key: K(1), waypoint: true, hud: false })
    setHudTarget(K(1), true)
    expect(useStarredChunks.getState().guide).toEqual({ key: K(1), waypoint: true, hud: true })
    setWaypoint(K(1), false)
    expect(useStarredChunks.getState().guide).toEqual({ key: K(1), waypoint: false, hud: true })
    // Another chunk replaces it.
    setWaypoint(K(2), true)
    expect(useStarredChunks.getState().guide).toEqual({ key: K(2), waypoint: true, hud: false })
    setWaypoint(K(2), false)
    expect(useStarredChunks.getState().guide).toBeNull()
    guideTo(K(1))
    expect(useStarredChunks.getState().guide).toEqual({ key: K(1), waypoint: true, hud: true })
    endGuide()
    expect(useStarredChunks.getState().guide).toBeNull()
  })

  it('arriving in the chunk ends the guide with a toast; another chunk does not; removing the chunk ends it too', () => {
    as(device(), { live: () => false })
    starChunk(K(1), snap())
    renameChunk(K(1), 'Glowcore cave')
    guideTo(K(1))
    useToast.setState({ toast: null })
    crossed(K(5), K(6))
    expect(useStarredChunks.getState().guide?.key).toBe(K(1))
    expect(useToast.getState().toast).toBeNull()
    crossed(K(6), K(1))
    expect(useStarredChunks.getState().guide).toBeNull()
    expect(useToast.getState().toast).toMatchObject({ label: 'You\'re in your starred chunk', meta: 'Glowcore cave', mark: 'star' })
    setHudTarget(K(1), true)
    unstarChunk(K(1))
    expect(useStarredChunks.getState().guide).toBeNull()
  })
})
