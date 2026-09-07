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

vi.mock('../lib/relay', () => ({
  publish: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
}))

import { publish, query } from '../lib/relay'
import { AVATAR_KIND } from '../lib/avatar'
import { newShard } from '../lib/shards'
import { useCyberspace } from './useCyberspace'
import { useAvatars } from './useAvatars'

const built = () => {
  const s = newShard('me')
  s.name = 'Arches'
  s.vertices = [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [1, 0, 0] }, { p: [0, 1, 0], c: [1, 0, 0] }]
  s.faces = [[0, 1, 2]]
  s.mode = 'solid'
  return s
}

describe('useAvatars', () => {
  beforeEach(() => { useAvatars.setState({ shards: {}, asked: {} }); localStorage.clear(); vi.mocked(query).mockClear(); vi.mocked(publish).mockClear() })

  it('adopting a shard signs a kind 33331 event with d=avatar, publishes it and keeps a copy', async () => {
    const me = useCyberspace.getState().identity.pubkey
    expect(await useAvatars.getState().adopt(built())).toBe(true)
    const ev = vi.mocked(publish).mock.calls[0][0]
    expect(ev.kind).toBe(AVATAR_KIND)
    expect(ev.pubkey).toBe(me)
    expect(ev.tags).toEqual([['d', 'avatar'], ['name', 'Arches']])
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
    expect(vi.mocked(publish).mock.calls[1][0].content).toBe('')
    expect(useAvatars.getState().shards[me]).toBeNull()
  })

  it('asks the relay once per pubkey and reads the newest event', async () => {
    const pk = 'cd'.repeat(32)
    const shard = built()
    const { avatarTemplate } = await import('../lib/avatar')
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
