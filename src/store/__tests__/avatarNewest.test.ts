/**
 * avatarNewest.test.ts: the avatar drawn for a pubkey is the newest one seen,
 * an older copy never draws over it, and every copy is kept in the event
 * database, never localStorage (arkinox, 2026-11-17: "every time I start
 * onosendai it shows my previous avatar for about 30 seconds and then finally
 * shows my more recently updated one. can't we cache the latest one
 * locally?" and "i dont want to use local storage if we can avoid it, it
 * fills up too fast").
 *
 * The cause was the copy of your own avatar this device kept: it held the
 * event this device signed last, and a newer one the relays answered with
 * (adopted on another device) was drawn but never kept in its place. So
 * every start drew the old one again until the relays answered.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
    get length() { return mem.size },
    key: (i: number) => [...mem.keys()][i] ?? null,
  }
}

vi.mock('../../lib/relay', () => ({
  publish: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { publish, query } from '../../lib/relay'
import { avatarReplaces, avatarTemplate, newestAvatar } from '../../lib/avatar'
import { keepAvatarEvent, readKeptAvatar, resetAvatarMigration } from '../../lib/avatarDb'
import { closeEventDb } from '../../lib/eventDb/connection'
import type { NostrEvent } from '../../lib/events'
import { useCyberspace } from '../useCyberspace'
import { forgetDeviceReads, useAvatars, watchMyAvatar } from '../useAvatars'

const shardNamed = (name: string): ShardModel => {
  const s = newShard(name)
  s.name = name
  s.vertices = [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [1, 0, 0] }, { p: [0, 1, 0], c: [1, 0, 0] }]
  s.faces = [[0, 1, 2]]
  s.mode = 'solid'
  return s
}

/** An avatar event of `pubkey` named `name` at `createdAt`; `id` (hex) stands in for the hash. */
const avatarEvent = (pubkey: string, name: string, createdAt: number, id: string): NostrEvent =>
  ({ ...avatarTemplate(shardNamed(name), createdAt), pubkey, id: id.repeat(64 / id.length), sig: '' }) as NostrEvent

const T = Math.floor(Date.now() / 1000) - 10_000

/** Ask for `pubkey` with the relays answering `events`, and wait for the answer to land. */
const answer = async (pubkey: string, events: NostrEvent[]): Promise<void> => {
  vi.mocked(query).mockResolvedValueOnce(events as never)
  const before = vi.mocked(query).mock.calls.length
  useAvatars.setState({ asked: {} })
  useAvatars.getState().ensure(pubkey)
  await vi.waitFor(() => { expect(vi.mocked(query).mock.calls.length).toBe(before + 1) })
  await new Promise((r) => setTimeout(r, 30))
}

/** The names `pubkey` is drawn as from now on, in order: a flash of an old one would show here. */
const watchNames = (pubkey: string): { names: string[]; stop: () => void } => {
  const names: string[] = []
  const stop = useAvatars.subscribe((s) => {
    const name = pubkey in s.shards ? (s.shards[pubkey]?.name ?? 'dodecahedron') : null
    if (name && names[names.length - 1] !== name) names.push(name)
  })
  return { names, stop }
}

/** As a reload: the store empty, nothing looked up yet, the same database. */
const reload = (): void => {
  forgetDeviceReads()
  resetAvatarMigration()
  useAvatars.setState({ shards: {}, events: {}, asked: {}, phase: null, adoptError: null, mineEvent: null, minePublished: false })
}

beforeEach(() => {
  closeEventDb()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  localStorage.clear()
  vi.mocked(query).mockReset()
  vi.mocked(query).mockResolvedValue([])
  vi.mocked(publish).mockClear()
  useCyberspace.setState({ live: true })
  reload()
})

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

describe('your own avatar', () => {
  const me = (): string => useCyberspace.getState().identity.pubkey

  it('a newer avatar from the relays (adopted on another device) is kept, so the next start draws it with no flash of the old one', async () => {
    await keepAvatarEvent(avatarEvent(me(), 'Previous', T + 100, '1'), { mine: true, published: true })
    await useAvatars.getState().loadMine()
    expect(useAvatars.getState().shards[me()]?.name).toBe('Previous')
    await answer(me(), [avatarEvent(me(), 'Previous', T + 100, '1'), avatarEvent(me(), 'Newest', T + 200, '2')])
    expect(useAvatars.getState().shards[me()]?.name).toBe('Newest')
    expect(useAvatars.getState().minePublished).toBe(true)
    await vi.waitFor(async () => { expect((await readKeptAvatar(me()))?.event.created_at).toBe(T + 200) })
    // The next start, the relays slow: only the newest is ever drawn.
    reload()
    vi.mocked(query).mockImplementation(() => new Promise(() => {}))
    const seen = watchNames(me())
    watchMyAvatar()()
    useAvatars.getState().ensure(me())
    await vi.waitFor(() => { expect(useAvatars.getState().shards[me()]?.name).toBe('Newest') })
    seen.stop()
    expect(seen.names).toEqual(['Newest'])
  })

  it('an older event from a relay never replaces the newer kept one', async () => {
    await keepAvatarEvent(avatarEvent(me(), 'Newest', T + 200, '2'), { mine: true, published: true })
    await useAvatars.getState().loadMine()
    await answer(me(), [avatarEvent(me(), 'Previous', T + 100, '1')])
    expect(useAvatars.getState().shards[me()]?.name).toBe('Newest')
    expect((await readKeptAvatar(me()))?.event.created_at).toBe(T + 200)
  })

  it('a newer event from a relay does replace it', async () => {
    await keepAvatarEvent(avatarEvent(me(), 'Previous', T + 100, '1'), { mine: true, published: true })
    await useAvatars.getState().loadMine()
    await answer(me(), [avatarEvent(me(), 'Newest', T + 200, '2')])
    expect(useAvatars.getState().shards[me()]?.name).toBe('Newest')
    expect(useAvatars.getState().mineEvent?.created_at).toBe(T + 200)
  })

  it('an avatar adopted while LOCAL stays drawn, and BROADCAST stays offered, when the relays only have an older one', async () => {
    await keepAvatarEvent(avatarEvent(me(), 'Local', T + 200, '2'), { mine: true, published: false })
    await useAvatars.getState().loadMine()
    expect(useAvatars.getState().minePublished).toBe(false)
    await answer(me(), [avatarEvent(me(), 'Previous', T + 100, '1')])
    expect(useAvatars.getState().shards[me()]?.name).toBe('Local')
    expect(useAvatars.getState().minePublished).toBe(false)
  })

  it('one the relays do not hold, though kept as published, offers BROADCAST again', async () => {
    await keepAvatarEvent(avatarEvent(me(), 'Unsent', T + 200, '2'), { mine: true, published: true })
    await useAvatars.getState().loadMine()
    expect(useAvatars.getState().minePublished).toBe(true)
    await answer(me(), [avatarEvent(me(), 'Previous', T + 100, '1')])
    expect(useAvatars.getState().shards[me()]?.name).toBe('Unsent')
    expect(useAvatars.getState().minePublished).toBe(false)
  })

  it('equal timestamps: the lower id wins, from the device or from a relay', async () => {
    await keepAvatarEvent(avatarEvent(me(), 'High', T + 150, 'e'), { mine: true, published: true })
    await useAvatars.getState().loadMine()
    await answer(me(), [avatarEvent(me(), 'Low', T + 150, '1')])
    expect(useAvatars.getState().shards[me()]?.name).toBe('Low')
    await vi.waitFor(async () => { expect((await readKeptAvatar(me()))?.event.id).toBe('1'.repeat(64)) })
    // And the higher id does not take it back.
    await answer(me(), [avatarEvent(me(), 'High', T + 150, 'e')])
    expect(useAvatars.getState().shards[me()]?.name).toBe('Low')
    expect((await readKeptAvatar(me()))?.event.id).toBe('1'.repeat(64))
  })

  it('saving a new avatar keeps it at once, later than anything held, so the next start draws it', async () => {
    // A copy from a device whose clock runs a little ahead: the new one still replaces it.
    const ahead = Math.floor(Date.now() / 1000) + 120
    await keepAvatarEvent(avatarEvent(me(), 'Ahead', ahead, '1'), { mine: true, published: true })
    await useAvatars.getState().loadMine()
    expect(await useAvatars.getState().adopt(shardNamed('Saved'))).toBe(true)
    const signed = useAvatars.getState().mineEvent!
    expect(signed.created_at).toBeGreaterThan(ahead)
    expect(useAvatars.getState().events[me()]?.id).toBe(signed.id)
    await vi.waitFor(async () => { expect((await readKeptAvatar(me()))?.event.id).toBe(signed.id) })
    reload()
    await useAvatars.getState().loadMine()
    expect(useAvatars.getState().shards[me()]?.name).toBe('Saved')
    // Nothing of it in localStorage.
    expect(localStorage.length).toBe(0)
  })

  it('a LOCAL avatar is still unpublished after a reload, and BROADCAST marks it published', async () => {
    useCyberspace.setState({ live: false })
    try {
      expect(await useAvatars.getState().adopt(shardNamed('Local'))).toBe(true)
      await vi.waitFor(async () => { expect((await readKeptAvatar(me()))?.published).toBe(false) })
      reload()
      await useAvatars.getState().loadMine()
      expect(useAvatars.getState().shards[me()]?.name).toBe('Local')
      expect(useAvatars.getState().minePublished).toBe(false)
      useCyberspace.setState({ live: true })
      expect(await useAvatars.getState().broadcastMine()).toBe(true)
      await vi.waitFor(async () => { expect((await readKeptAvatar(me()))?.published).toBe(true) })
    } finally {
      useCyberspace.setState({ live: true })
    }
  })

  it('is kept per identity: a switch draws that identity\'s own, and switching back restores yours', async () => {
    const other = '7a'.repeat(32)
    const identity = useCyberspace.getState().identity
    await keepAvatarEvent(avatarEvent(identity.pubkey, 'Mine', T + 100, '1'), { mine: true, published: false })
    await keepAvatarEvent(avatarEvent(other, 'Theirs', T + 100, '2'), { mine: true, published: true })
    const stop = watchMyAvatar()
    try {
      await vi.waitFor(() => { expect(useAvatars.getState().mineEvent?.pubkey).toBe(identity.pubkey) })
      expect(useAvatars.getState().minePublished).toBe(false)
      useCyberspace.setState({ identity: { pubkey: other, npub: '' } })
      await vi.waitFor(() => { expect(useAvatars.getState().mineEvent?.pubkey).toBe(other) })
      expect(useAvatars.getState().shards[other]?.name).toBe('Theirs')
      expect(useAvatars.getState().minePublished).toBe(true)
      useCyberspace.setState({ identity })
      await vi.waitFor(() => { expect(useAvatars.getState().mineEvent?.pubkey).toBe(identity.pubkey) })
      expect(useAvatars.getState().minePublished).toBe(false)
    } finally {
      stop()
      useCyberspace.setState({ identity })
    }
  })

  it('a switch to an identity with nothing kept takes the copy already drawn from a relay as its own, published', async () => {
    const other = '7b'.repeat(32)
    const identity = useCyberspace.getState().identity
    await answer(other, [avatarEvent(other, 'Seen', T + 100, '3')])
    const stop = watchMyAvatar()
    try {
      useCyberspace.setState({ identity: { pubkey: other, npub: '' } })
      await vi.waitFor(() => { expect(useAvatars.getState().mineEvent?.pubkey).toBe(other) })
      expect(useAvatars.getState().minePublished).toBe(true)
    } finally {
      stop()
      useCyberspace.setState({ identity })
    }
  })

  it('moves what localStorage held into the event database once, and clears those keys', async () => {
    const mine = avatarEvent(me(), 'Legacy', T + 100, '1')
    const theirs = avatarEvent('cd'.repeat(32), 'XOR', T + 100, '2')
    localStorage.setItem('onosendai:avatar', JSON.stringify({ pubkey: me(), payload: null, event: mine, published: false }))
    localStorage.setItem('onosendai:avatars', JSON.stringify({ [theirs.pubkey]: { event: theirs, at: Date.now() } }))
    await useAvatars.getState().loadMine()
    expect(useAvatars.getState().shards[me()]?.name).toBe('Legacy')
    expect(useAvatars.getState().minePublished).toBe(false)
    expect((await readKeptAvatar(theirs.pubkey))?.event.id).toBe(theirs.id)
    expect(localStorage.getItem('onosendai:avatar')).toBeNull()
    expect(localStorage.getItem('onosendai:avatars')).toBeNull()
  })

  it('a kept avatar over the size limit is the dodecahedron', async () => {
    const t = avatarTemplate(shardNamed('Big'), T + 100)
    const big = { ...t, content: t.content.replace(/}$/, `,"pad":"${'a'.repeat(131_072)}"}`), pubkey: me(), id: 'f'.repeat(64), sig: '' }
    await keepAvatarEvent(big, { mine: true, published: true })
    await useAvatars.getState().loadMine()
    expect(useAvatars.getState().mineEvent?.id).toBe(big.id)
    expect(useAvatars.getState().shards[me()]).toBeNull()
  })
})

describe('everyone else\'s avatar', () => {
  const pk = 'cd'.repeat(32)

  it('does not flip back to an older one a relay answers with later, and a newer one replaces it', async () => {
    await answer(pk, [avatarEvent(pk, 'Newest', T + 200, '2')])
    expect(useAvatars.getState().shards[pk]?.name).toBe('Newest')
    await answer(pk, [avatarEvent(pk, 'Previous', T + 100, '1')])
    expect(useAvatars.getState().shards[pk]?.name).toBe('Newest')
    await answer(pk, [avatarEvent(pk, 'Newer still', T + 300, '3')])
    expect(useAvatars.getState().shards[pk]?.name).toBe('Newer still')
  })

  it('a reload draws the kept newest from the device, and an older relay answer does not replace it', async () => {
    await answer(pk, [avatarEvent(pk, 'Newest', T + 200, '2')])
    await vi.waitFor(async () => { expect((await readKeptAvatar(pk))?.event.created_at).toBe(T + 200) })
    reload()
    const seen = watchNames(pk)
    let release: (v: NostrEvent[]) => void = () => {}
    vi.mocked(query).mockImplementationOnce(() => new Promise((r) => { release = r as never }))
    useAvatars.getState().ensure(pk)
    await vi.waitFor(() => { expect(useAvatars.getState().shards[pk]?.name).toBe('Newest') })
    release([avatarEvent(pk, 'Previous', T + 100, '1')])
    await new Promise((r) => setTimeout(r, 30))
    seen.stop()
    expect(seen.names).toEqual(['Newest'])
  })
})
