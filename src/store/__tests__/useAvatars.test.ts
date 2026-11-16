import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store keeps your own avatar in localStorage; the test runs where there is none.
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

import { verifyAvatar } from 'cyberspace-core'
import { publish, query } from '../../lib/relay'
import { AVATAR_KIND, avatarSize, avatarTemplate } from '../../lib/avatar'
import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { AVATAR_SIGN_PATIENCE_MS, avatarShard, useAvatars } from '../useAvatars'

const built = () => {
  const s = newShard('me')
  s.name = 'Arches'
  s.vertices = [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [1, 0, 0] }, { p: [0, 1, 0], c: [1, 0, 0] }]
  s.faces = [[0, 1, 2]]
  s.mode = 'solid'
  return s
}

describe('useAvatars', () => {
  beforeEach(() => { useAvatars.setState({ shards: {}, asked: {}, phase: null, adoptError: null, mineEvent: null, minePublished: false }); useCyberspace.setState({ live: true }); localStorage.clear(); vi.mocked(query).mockClear(); vi.mocked(publish).mockClear() })

  it('adopting a shard signs a kind 11333 event with no d tag and no work, publishes it and keeps a copy', async () => {
    const me = useCyberspace.getState().identity.pubkey
    expect(await useAvatars.getState().adopt(built())).toBe(true)
    const ev = vi.mocked(publish).mock.calls[0][0]
    expect(ev.kind).toBe(AVATAR_KIND)
    expect(ev.pubkey).toBe(me)
    expect(ev.tags[0]).toEqual(['name', 'Arches'])
    // Replaceable: no `d` tag at all (spec 8.10), and no work: no nonce tag.
    expect(ev.tags.some((t: string[]) => t[0] === 'd')).toBe(false)
    expect(ev.tags.some((t: string[]) => t[0] === 'nonce')).toBe(false)
    expect(verifyAvatar(ev)).toEqual({ ok: true, reason: 'ok' })
    expect(useAvatars.getState().phase).toBeNull()
    expect(useAvatars.getState().shards[me]?.name).toBe('Arches')
    // Kept for the next load, before any relay answers.
    useAvatars.setState({ shards: {} })
    useAvatars.getState().loadMine()
    expect(useAvatars.getState().shards[me]?.name).toBe('Arches')
  })

  it('adopting nothing puts the dodecahedron back', async () => {
    const me = useCyberspace.getState().identity.pubkey
    await useAvatars.getState().adopt(built())
    expect(await useAvatars.getState().adopt(null)).toBe(true)
    const ev = vi.mocked(publish).mock.calls[1][0]
    expect(ev.content).toBe('')
    // The dodecahedron: an empty content.
    expect(ev.tags.some((t) => t[0] === 'nonce')).toBe(false)
    expect(useAvatars.getState().shards[me]).toBeNull()
  })

  it('refuses a shard over the size limit without asking the signer', async () => {
    const me = useCyberspace.getState().identity.pubkey
    const original = useCyberspace.getState().signEvent
    const signs: unknown[] = []
    useCyberspace.setState({ signEvent: (t, p) => { signs.push(t); return original(t, p) } })
    try {
      const heavy: ShardModel = { ...built(), name: 'Heavy' }
      // About 200 KB of content: over the 128 KB size limit.
      heavy.vertices = Array.from({ length: 10_000 }, (_, i) => ({ p: [i, i, i] as [number, number, number], c: [0.123, 0.456, 0.789] as [number, number, number] }))
      expect(avatarSize(avatarTemplate(heavy, 1).content).over).toBe(true)
      expect(await useAvatars.getState().adopt(heavy)).toBe(false)
      expect(useAvatars.getState().adoptError).toMatch(/128 KB size limit/)
      expect(useAvatars.getState().phase).toBeNull()
      expect(signs).toEqual([])
      expect(vi.mocked(publish)).not.toHaveBeenCalled()
      expect(me in useAvatars.getState().shards).toBe(false)
    } finally {
      useCyberspace.setState({ signEvent: original })
    }
  })

  it('walks signing and publishing, refusing a second adopt the whole way', async () => {
    const original = useCyberspace.getState().signEvent
    let release: (() => void) | null = null
    const patience: number[] = []
    useCyberspace.setState({
      signEvent: (template, patienceMs) => new Promise((resolve) => {
        patience.push(patienceMs ?? -1)
        release = () => { void original(template).then(resolve) }
      }),
    })
    try {
      const pending = useAvatars.getState().adopt(built())
      // No work first: straight to the signer.
      expect(useAvatars.getState().phase).toBe('signing')
      // The signer's prompt is open: a second press must not ask again.
      expect(await useAvatars.getState().adopt(built())).toBe(false)
      expect(patience).toEqual([AVATAR_SIGN_PATIENCE_MS])
      release!()
      expect(await pending).toBe(true)
      expect(useAvatars.getState().phase).toBeNull()
      expect(vi.mocked(publish)).toHaveBeenCalledTimes(1)
    } finally {
      useCyberspace.setState({ signEvent: original })
    }
  })

  it('a second adopt while one is signing is refused', async () => {
    const pending = useAvatars.getState().adopt(built())
    expect(await useAvatars.getState().adopt(built())).toBe(false)
    expect(await pending).toBe(true)
  })

  it('an empty answer from the relay keeps a known avatar', async () => {
    const me = useCyberspace.getState().identity.pubkey
    await useAvatars.getState().adopt(built())
    expect(useAvatars.getState().shards[me]?.name).toBe('Arches')
    useAvatars.setState({ asked: {} })
    vi.mocked(query).mockResolvedValueOnce([])
    useAvatars.getState().ensure(me)
    await vi.waitFor(() => { expect(vi.mocked(query)).toHaveBeenCalledTimes(1) })
    await new Promise((r) => setTimeout(r, 20))
    expect(useAvatars.getState().shards[me]?.name).toBe('Arches')
    // Never asked before and nothing there: the dodecahedron, as before.
    const other = '12'.repeat(32)
    vi.mocked(query).mockResolvedValueOnce([])
    useAvatars.getState().ensure(other)
    await vi.waitFor(() => { expect(other in useAvatars.getState().shards).toBe(true) })
    expect(useAvatars.getState().shards[other]).toBeNull()
  })

  it('LOCAL keeps the avatar on this device, and BROADCAST sends that same event later', async () => {
    const me = useCyberspace.getState().identity.pubkey
    const wasLive = useCyberspace.getState().live
    useCyberspace.setState({ live: false })
    try {
      expect(await useAvatars.getState().adopt(built())).toBe(true)
      // Drawn for you, kept whole, and no relay heard about it.
      expect(useAvatars.getState().shards[me]?.name).toBe('Arches')
      expect(useAvatars.getState().minePublished).toBe(false)
      expect(vi.mocked(publish)).not.toHaveBeenCalled()
      const kept = useAvatars.getState().mineEvent
      expect(kept).not.toBeNull()
      expect(verifyAvatar(kept!)).toMatchObject({ ok: true })

      // Broadcasting while still LOCAL refuses rather than publishing.
      expect(await useAvatars.getState().broadcastMine()).toBe(false)
      expect(vi.mocked(publish)).not.toHaveBeenCalled()
      expect(useAvatars.getState().adoptError).toMatch(/LOCAL/)

      // Live: the very event that was signed goes out, not signed again.
      useCyberspace.setState({ live: true })
      expect(await useAvatars.getState().broadcastMine()).toBe(true)
      expect(vi.mocked(publish)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(publish).mock.calls[0][0].id).toBe(kept!.id)
      expect(useAvatars.getState().minePublished).toBe(true)
    } finally {
      useCyberspace.setState({ live: wasLive })
    }
  })

  it('draws an avatar with no nonce tag, and one published with work, its nonce tag ignored', async () => {
    const pk = 'ef'.repeat(32)
    const shard = built()
    const plain = { ...avatarTemplate(shard, 30), pubkey: pk, id: 'ff'.repeat(32), sig: '' }
    vi.mocked(query).mockResolvedValueOnce([plain as never])
    useAvatars.getState().ensure(pk)
    await vi.waitFor(() => { expect(useAvatars.getState().shards[pk]?.name).toBe('Arches') })
    // Published while avatars were paid for in work: the tag is ignored, met or not.
    const t = avatarTemplate(shard, 31)
    for (const nonce of [['nonce', '12345', '16'], ['nonce', '0', '42']]) {
      const old = { ...t, tags: [...t.tags, nonce], pubkey: pk, id: 'ff'.repeat(32), sig: '' }
      expect(avatarShard(old)?.name).toBe('Arches')
    }
  })

  it('an event that is not an avatar every client draws is the dodecahedron to everyone', async () => {
    const pk = 'ab'.repeat(32)
    const t = avatarTemplate(built(), 30)
    // Over the size limit, whatever it carries.
    const big = { ...t, content: t.content.replace(/}$/, `,"pad":"${'a'.repeat(131_072)}"}`), pubkey: pk, id: 'ff'.repeat(32), sig: '' }
    expect(avatarShard(big)).toBeNull()
    vi.mocked(query).mockResolvedValueOnce([big as never])
    useAvatars.getState().ensure(pk)
    await vi.waitFor(() => { expect(pk in useAvatars.getState().shards).toBe(true) })
    expect(useAvatars.getState().shards[pk]).toBeNull()
    // Unreadable, or another kind.
    expect(avatarShard({ ...t, content: 'not json', pubkey: pk })).toBeNull()
    expect(avatarShard({ ...t, kind: 1, pubkey: pk })).toBeNull()
  })

  it('asks the relay once per pubkey and reads the newest event', async () => {
    const pk = 'cd'.repeat(32)
    const shard = built()
    const { avatarTemplate } = await import('../../lib/avatar')
    vi.mocked(query).mockResolvedValueOnce([
      { ...avatarTemplate(shard, 10), pubkey: pk, id: 'a', sig: '' } as never,
      { ...avatarTemplate(null, 20), pubkey: pk, id: 'b', sig: '' } as never,
    ])
    useAvatars.getState().ensure(pk)
    useAvatars.getState().ensure(pk)
    await vi.waitFor(() => { expect(pk in useAvatars.getState().shards).toBe(true) })
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1)
    // The newest (created_at 20) carries no shard: the dodecahedron.
    expect(useAvatars.getState().shards[pk]).toBeNull()
  })
})
