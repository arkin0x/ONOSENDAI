/**
 * avatarNewest.test.ts: the avatar drawn for a pubkey is the newest one seen,
 * and an older copy never draws over it (arkinox, 2026-11-17: "every time I
 * start onosendai it shows my previous avatar for about 30 seconds and then
 * finally shows my more recently updated one. can't we cache the latest one
 * locally?").
 *
 * The cause was the copy of your own avatar this device keeps: it held the
 * event this device signed last, and a newer one the relays answered with
 * (adopted on another device) was drawn but never kept in its place. So
 * every start drew the old one again until the relays answered.
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

vi.mock('../../lib/relay', () => ({
  publish: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { query } from '../../lib/relay'
import { avatarReplaces, avatarTemplate, newestAvatar } from '../../lib/avatar'
import type { NostrEvent } from '../../lib/events'
import { useCyberspace } from '../useCyberspace'
import { AVATARS_CACHE_KEY, keepAvatar, loadAvatarCache, mineKey, useAvatars, watchMyAvatar } from '../useAvatars'

const shardNamed = (name: string): ShardModel => {
  const s = newShard(name)
  s.name = name
  s.vertices = [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [1, 0, 0] }, { p: [0, 1, 0], c: [1, 0, 0] }]
  s.faces = [[0, 1, 2]]
  s.mode = 'solid'
  return s
}

/** An avatar event of `pubkey` named `name` at `createdAt`; `id` stands in for the hash. */
const avatarEvent = (pubkey: string, name: string, createdAt: number, id: string): NostrEvent =>
  ({ ...avatarTemplate(shardNamed(name), createdAt), pubkey, id: id.repeat(64 / id.length), sig: '' }) as NostrEvent

const keepMine = (event: NostrEvent, published = true): void => {
  localStorage.setItem(mineKey(event.pubkey), JSON.stringify({ pubkey: event.pubkey, event, published }))
}

const keptMine = (pubkey: string): NostrEvent | null => {
  const raw = localStorage.getItem(mineKey(pubkey))
  return raw ? (JSON.parse(raw) as { event: NostrEvent }).event : null
}

const answer = async (pubkey: string, events: NostrEvent[]): Promise<void> => {
  vi.mocked(query).mockResolvedValueOnce(events as never)
  const before = vi.mocked(query).mock.calls.length
  useAvatars.setState({ asked: {} })
  useAvatars.getState().ensure(pubkey)
  await vi.waitFor(() => { expect(vi.mocked(query).mock.calls.length).toBe(before + 1) })
  await new Promise((r) => setTimeout(r, 10))
}

describe('avatarReplaces: newest wins, as NIP-01 has it for a replaceable kind', () => {
  const pk = 'ab'.repeat(32)
  it('the later created_at wins, and anything replaces nothing', () => {
    const old = avatarEvent(pk, 'Old', 10, '1')
    const now = avatarEvent(pk, 'New', 20, '2')
    expect(avatarReplaces(now, old)).toBe(true)
    expect(avatarReplaces(old, now)).toBe(false)
    expect(avatarReplaces(old, null)).toBe(true)
  })
  it('of two with the same created_at, the lower id wins, whichever came first', () => {
    const low = avatarEvent(pk, 'Low', 10, '1')
    const high = avatarEvent(pk, 'High', 10, 'f')
    expect(avatarReplaces(low, high)).toBe(true)
    expect(avatarReplaces(high, low)).toBe(false)
    expect(newestAvatar([high, low])?.id).toBe(low.id)
    expect(newestAvatar([low, high])?.id).toBe(low.id)
  })
  it('the same event never replaces itself', () => {
    const e = avatarEvent(pk, 'Same', 10, '3')
    expect(avatarReplaces(e, { ...e })).toBe(false)
    expect(newestAvatar([])).toBeNull()
  })
})

/**
 * A fresh start: the modules made again, as a reload makes them, signed in
 * as `pubkey` before the avatar store is made.
 */
async function restart(pubkey: string): Promise<typeof import('../useAvatars')> {
  vi.resetModules()
  const { useCyberspace: fresh } = await import('../useCyberspace')
  fresh.setState({ identity: { pubkey, npub: '' } })
  return import('../useAvatars')
}

describe('your own avatar', () => {
  let me = ''
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(query).mockClear()
    useCyberspace.setState({ live: true })
    me = useCyberspace.getState().identity.pubkey
    useAvatars.setState({ shards: {}, events: {}, asked: {}, phase: null, adoptError: null, mineEvent: null, minePublished: false })
  })

  it('the start draws the kept newest at once, as the store is made, before any relay or effect', async () => {
    keepMine(avatarEvent(me, 'Newest', 200, '2'))
    // An older copy of you in everyone else's cache (kept while you were someone else) loses.
    localStorage.setItem(AVATARS_CACHE_KEY, JSON.stringify({ [me]: { event: avatarEvent(me, 'Previous', 100, '1'), at: Date.now() } }))
    const fresh = await restart(me)
    expect(fresh.useAvatars.getState().shards[me]?.name).toBe('Newest')
    expect(fresh.useAvatars.getState().mineEvent?.created_at).toBe(200)
  })

  it('a newer avatar from the relays (adopted on another device) is kept, so the next start draws it, not the old one', async () => {
    keepMine(avatarEvent(me, 'Previous', 100, '1'))
    useAvatars.getState().loadMine()
    expect(useAvatars.getState().shards[me]?.name).toBe('Previous')
    await answer(me, [avatarEvent(me, 'Previous', 100, '1'), avatarEvent(me, 'Newest', 200, '2')])
    expect(useAvatars.getState().shards[me]?.name).toBe('Newest')
    expect(useAvatars.getState().mineEvent?.created_at).toBe(200)
    expect(useAvatars.getState().minePublished).toBe(true)
    expect(keptMine(me)?.created_at).toBe(200)
    // The next start: no flash of the previous one.
    const fresh = await restart(me)
    expect(fresh.useAvatars.getState().shards[me]?.name).toBe('Newest')
  })

  it('an older event from a relay never replaces the newer kept one', async () => {
    keepMine(avatarEvent(me, 'Newest', 200, '2'))
    useAvatars.getState().loadMine()
    await answer(me, [avatarEvent(me, 'Previous', 100, '1')])
    expect(useAvatars.getState().shards[me]?.name).toBe('Newest')
    expect(useAvatars.getState().events[me]?.created_at).toBe(200)
    expect(keptMine(me)?.created_at).toBe(200)
  })

  it('an avatar adopted while LOCAL stays drawn and unpublished when the relays only have an older one', async () => {
    keepMine(avatarEvent(me, 'Local', 200, '2'), false)
    useAvatars.getState().loadMine()
    await answer(me, [avatarEvent(me, 'Previous', 100, '1')])
    expect(useAvatars.getState().shards[me]?.name).toBe('Local')
    expect(useAvatars.getState().minePublished).toBe(false)
  })

  it('equal timestamps: the lower id wins, from the cache or from a relay', async () => {
    keepMine(avatarEvent(me, 'High', 150, 'e'))
    useAvatars.getState().loadMine()
    await answer(me, [avatarEvent(me, 'Low', 150, '1')])
    expect(useAvatars.getState().shards[me]?.name).toBe('Low')
    expect(keptMine(me)?.id).toBe('1'.repeat(64))
    // And the higher id does not take it back.
    await answer(me, [avatarEvent(me, 'High', 150, 'e')])
    expect(useAvatars.getState().shards[me]?.name).toBe('Low')
    expect(keptMine(me)?.id).toBe('1'.repeat(64))
  })

  it('saving a new avatar keeps it at once, later than anything held, so the next start draws it', async () => {
    // A copy from a device whose clock runs ahead: the new one still replaces it.
    const ahead = Math.floor(Date.now() / 1000) + 3600
    keepMine(avatarEvent(me, 'Ahead', ahead, '1'))
    useAvatars.getState().loadMine()
    expect(await useAvatars.getState().adopt(shardNamed('Saved'))).toBe(true)
    const kept = keptMine(me)
    expect(kept?.tags[0]).toEqual(['name', 'Saved'])
    expect(kept!.created_at).toBeGreaterThan(ahead)
    expect(useAvatars.getState().events[me]?.id).toBe(kept!.id)
    const fresh = await restart(me)
    expect(fresh.useAvatars.getState().shards[me]?.name).toBe('Saved')
  })

  it('is kept per identity: a switch draws that identity\'s own, and switching back restores yours', async () => {
    const other = '7a'.repeat(32)
    const identity = useCyberspace.getState().identity
    keepMine(avatarEvent(me, 'Mine', 100, '1'), false)
    keepMine(avatarEvent(other, 'Theirs', 100, '2'))
    const stop = watchMyAvatar()
    try {
      expect(useAvatars.getState().shards[me]?.name).toBe('Mine')
      expect(useAvatars.getState().minePublished).toBe(false)
      useCyberspace.setState({ identity: { pubkey: other, npub: '' } })
      expect(useAvatars.getState().shards[other]?.name).toBe('Theirs')
      expect(useAvatars.getState().mineEvent?.pubkey).toBe(other)
      expect(useAvatars.getState().minePublished).toBe(true)
      useCyberspace.setState({ identity })
      expect(useAvatars.getState().mineEvent?.pubkey).toBe(me)
      expect(useAvatars.getState().minePublished).toBe(false)
      // Neither identity's slot was written over by the other's.
      expect(keptMine(me)?.tags[0]).toEqual(['name', 'Mine'])
      expect(keptMine(other)?.tags[0]).toEqual(['name', 'Theirs'])
    } finally {
      stop()
      useCyberspace.setState({ identity })
    }
  })

  it('reads the one slot kept before each identity had its own, for the identity it names', () => {
    const e = avatarEvent(me, 'Legacy', 100, '1')
    localStorage.setItem('onosendai:avatar', JSON.stringify({ pubkey: me, event: e, published: true }))
    useAvatars.getState().loadMine()
    expect(useAvatars.getState().shards[me]?.name).toBe('Legacy')
    // Someone else's single slot is not yours.
    useAvatars.setState({ shards: {}, events: {}, mineEvent: null })
    localStorage.setItem('onosendai:avatar', JSON.stringify({ pubkey: '7a'.repeat(32), event: { ...e, pubkey: '7a'.repeat(32) }, published: true }))
    useAvatars.getState().loadMine()
    expect(me in useAvatars.getState().shards).toBe(false)
  })
})

describe('everyone else\'s avatar', () => {
  const pk = 'cd'.repeat(32)
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(query).mockClear()
    useAvatars.setState({ shards: {}, events: {}, asked: {}, phase: null, adoptError: null, mineEvent: null, minePublished: false })
  })

  it('does not flip back to an older one a relay answers with later', async () => {
    await answer(pk, [avatarEvent(pk, 'Newest', 200, '2')])
    expect(useAvatars.getState().shards[pk]?.name).toBe('Newest')
    await answer(pk, [avatarEvent(pk, 'Previous', 100, '1')])
    expect(useAvatars.getState().shards[pk]?.name).toBe('Newest')
    expect(loadAvatarCache()[pk]?.name).toBe('Newest')
    // A newer one does replace it.
    await answer(pk, [avatarEvent(pk, 'Newer still', 300, '3')])
    expect(useAvatars.getState().shards[pk]?.name).toBe('Newer still')
  })

  it('a kept newer one is not replaced by an older one from the relays after a reload', async () => {
    keepAvatar(avatarEvent(pk, 'Newest', 200, '2'))
    vi.resetModules()
    const fresh = await import('../useAvatars')
    const relay = await import('../../lib/relay')
    expect(fresh.useAvatars.getState().shards[pk]?.name).toBe('Newest')
    vi.mocked(relay.query).mockResolvedValueOnce([avatarEvent(pk, 'Previous', 100, '1')] as never)
    fresh.useAvatars.getState().ensure(pk)
    await vi.waitFor(() => { expect(vi.mocked(relay.query)).toHaveBeenCalled() })
    await new Promise((r) => setTimeout(r, 10))
    expect(fresh.useAvatars.getState().shards[pk]?.name).toBe('Newest')
  })

  it('keepAvatar never keeps an older event over a newer one', () => {
    keepAvatar(avatarEvent(pk, 'Newest', 200, '2'))
    keepAvatar(avatarEvent(pk, 'Previous', 100, '1'))
    expect(loadAvatarCache()[pk]?.name).toBe('Newest')
    keepAvatar(avatarEvent(pk, 'Low', 200, '1'))
    expect(loadAvatarCache()[pk]?.name).toBe('Low')
  })
})
