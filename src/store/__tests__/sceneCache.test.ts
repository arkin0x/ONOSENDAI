/**
 * sceneCache.test.ts: the people around you and their avatars are kept on
 * the device, so a reload draws them where they last stood, in their own
 * shapes, before any relay answers (arkinox, 2026-10-12: "when I refresh the
 * page XOR disappears until it loads"). And the avatar you spectate is drawn
 * once, not twice (arkinox, the same day: "his avatar appears at the new
 * coordinate AND the previous coordinate").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

// A relay that never answers: whatever is drawn came from the device.
vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  query: () => new Promise(() => {}),
  subscribe: () => () => {},
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard } from 'sno-core/shards'
import { avatarTemplate } from '../../lib/avatar'
import type { NostrEvent } from '../../lib/events'
import { useCyberspace } from '../useCyberspace'
import {
  PRESENCE_CACHE_MAX_AGE_S, loadPresenceCache, presenceDrawn, savePresenceCache, startPresence, stopPresence, usePresence, type Person,
} from '../usePresence'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { closeAvatarDb, keepAvatarEvent, readKeptAvatar, resetAvatarMigration } from '../../lib/avatarDb'
import { forgetDeviceReads, useAvatars } from '../useAvatars'

const SECTOR = 1n << 30n
const here = { x: 5n * SECTOR + 7n, y: 9n * SECTOR + 1n, z: 3n * SECTOR + 2n }
const NOW = 1_800_000_000

const someone = (pubkey: string, over: Partial<Person> = {}): Person => ({
  pubkey, position: { ...here, x: here.x + 3n }, plane: 0, lastActive: NOW - 60, type: 'hop', checkedAt: NOW - 60, actionId: 'e'.repeat(64), ...over,
})

/** XOR's avatar: a kind 11333, signed as the workshop would. */
function xorAvatar(createdAt = NOW): { pubkey: string; event: NostrEvent } {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const s = newShard('xor')
  s.name = 'Stella Octangula'
  s.vertices = [{ p: [0, 0, 0], c: [0, 0.9, 1] }, { p: [1, 0, 0], c: [0, 0.9, 1] }, { p: [0, 1, 0], c: [0, 0.9, 1] }]
  s.faces = [[0, 1, 2]]
  s.mode = 'solid'
  return { pubkey, event: finalizeEvent(avatarTemplate(s, createdAt), sk) as NostrEvent }
}

beforeEach(() => {
  stopPresence()
  localStorage.clear()
  useCyberspace.setState({ position: here })
})

describe('the presence cache', () => {
  it('round-trips the people around you, positions and all, per identity', () => {
    const me = useCyberspace.getState().identity.pubkey
    const xor = 'a'.repeat(64)
    savePresenceCache(me, { [xor]: someone(xor, { frozen: true }) })
    const back = loadPresenceCache(me, here, NOW)
    expect(back[xor]).toEqual(someone(xor, { frozen: true }))
    expect(typeof back[xor].position.x).toBe('bigint')
    // Another identity on this device has its own neighbors.
    expect(loadPresenceCache('f'.repeat(64), here, NOW)).toEqual({})
  })

  it('drops anyone not confirmed within a day, or outside the 27 sectors', () => {
    const me = useCyberspace.getState().identity.pubkey
    const stale = 'b'.repeat(64)
    const far = 'c'.repeat(64)
    const near = 'd'.repeat(64)
    savePresenceCache(me, {
      [stale]: someone(stale, { checkedAt: NOW - PRESENCE_CACHE_MAX_AGE_S - 1 }),
      [far]: someone(far, { position: { ...here, x: here.x + 2n * SECTOR } }),
      [near]: someone(near),
    })
    expect(Object.keys(loadPresenceCache(me, here, NOW))).toEqual([near])
  })

  it('puts the cached people on the scene the moment presence starts, before the relay answers', () => {
    const me = useCyberspace.getState().identity.pubkey
    const xor = 'a'.repeat(64)
    const now = Math.floor(Date.now() / 1000)
    savePresenceCache(me, { [xor]: someone(xor, { checkedAt: now, lastActive: now }) })
    startPresence()
    // Synchronously: the relay mock never answers, and loading is still on.
    expect(usePresence.getState().loading).toBe(true)
    expect(usePresence.getState().people[xor]?.position).toEqual(someone(xor).position)
    const drawn = presenceDrawn(usePresence.getState().people, { me, focus: me, targets: {}, plane: 0 })
    expect(drawn.map((p) => p.pubkey)).toEqual([xor])
  })
})

describe('the spectated avatar is drawn once', () => {
  it('is left to scene/Avatar, not drawn again by PresenceAvatars at its newer place', () => {
    const me = 'f'.repeat(64)
    const xor = 'a'.repeat(64)
    const passerBy = 'b'.repeat(64)
    const people = { [xor]: someone(xor), [passerBy]: someone(passerBy) }
    // Not spectating: XOR is a passer-by like any other.
    expect(presenceDrawn(people, { me, focus: me, targets: {}, plane: 0 }).map((p) => p.pubkey).sort()).toEqual([passerBy, xor].sort())
    // Spectating XOR: Avatar draws him, gliding; presence must not.
    expect(presenceDrawn(people, { me, focus: xor, targets: {}, plane: 0 }).map((p) => p.pubkey)).toEqual([passerBy])
    // Targets are TargetAvatars', and you are Avatar's, as before.
    expect(presenceDrawn({ ...people, [me]: someone(me) }, { me, focus: me, targets: { [passerBy]: {} }, plane: 0 }).map((p) => p.pubkey)).toEqual([xor])
  })
})

describe('the avatar cache', () => {
  /** XOR's avatar dated now: the event database refuses someone else's event far ahead of the clock. */
  const xorNow = (): { pubkey: string; event: NostrEvent } => xorAvatar(Math.floor(Date.now() / 1000) - 60)

  beforeEach(() => {
    closeAvatarDb()
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
    resetAvatarMigration()
    forgetDeviceReads()
    useAvatars.setState({ shards: {}, events: {}, asked: {}, mineEvent: null, minePublished: false })
  })

  it('a reload draws a kept avatar from the device before the relay answers, and keeps nothing in localStorage', async () => {
    const { pubkey, event } = xorNow()
    await keepAvatarEvent(event, { mine: false, published: true })
    useAvatars.getState().ensure(pubkey)
    await vi.waitFor(() => { expect(useAvatars.getState().shards[pubkey]?.name).toBe('Stella Octangula') })
    expect(localStorage.getItem('onosendai:avatars')).toBeNull()
  })

  it('a kept avatar over the size limit is kept, and not drawn', async () => {
    const { pubkey, event } = xorNow()
    const big = { ...event, content: event.content.replace(/}$/, `,"pad":"${'a'.repeat(131_072)}"}`) }
    await keepAvatarEvent(big, { mine: false, published: true })
    expect((await readKeptAvatar(pubkey))?.event.id).toBe(big.id)
    useAvatars.getState().ensure(pubkey)
    await vi.waitFor(() => { expect(useAvatars.getState().events[pubkey]?.id).toBe(big.id) })
    expect(useAvatars.getState().shards[pubkey]).toBeNull()
  })

  it('forgets a shape its author dropped for the dodecahedron', async () => {
    const { pubkey, event } = xorNow()
    await keepAvatarEvent(event, { mine: false, published: true })
    await keepAvatarEvent({ ...event, id: 'f'.repeat(64), content: '', tags: [], created_at: event.created_at + 1 }, { mine: false, published: true })
    useAvatars.getState().ensure(pubkey)
    await vi.waitFor(() => { expect(pubkey in useAvatars.getState().shards).toBe(true) })
    expect(useAvatars.getState().shards[pubkey]).toBeNull()
  })
})
