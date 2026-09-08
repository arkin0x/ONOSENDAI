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

import { verifyAvatarWork } from 'cyberspace-core'
import { publish, query } from '../lib/relay'
import { AVATAR_KIND, avatarTemplate } from '../lib/avatar'
import { eventId, mineChunk, nonceTagged } from '../lib/avatarMine'
import { MineCancelled, type AvatarMiner } from '../lib/avatarWorker'
import { newShard } from '../lib/shards'
import { useCyberspace } from './useCyberspace'
import { AVATAR_SIGN_PATIENCE_MS, setAvatarMiner, useAvatars } from './useAvatars'

// The work, inline: the same loop the worker runs, with a hook to cancel.
const inline: AvatarMiner = (template, target, onProgress) => {
  let cancelled = false
  const done = new Promise<{ nonce: string; id: string; tries: number; elapsedMs: number }>((resolve, reject) => {
    setTimeout(() => {
      if (cancelled) { reject(new MineCancelled()); return }
      let found = null
      let from = 0
      for (; found === null && from < 2 ** 24; from += 4096) { found = mineChunk(template, target, from, 4096); onProgress({ tries: from + 4096, elapsedMs: 1 }) }
      resolve({ ...found!, tries: from, elapsedMs: 1 })
    }, 0)
  })
  return { done, cancel: () => { cancelled = true } }
}
setAvatarMiner(inline)

const built = () => {
  const s = newShard('me')
  s.name = 'Arches'
  s.vertices = [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [1, 0, 0] }, { p: [0, 1, 0], c: [1, 0, 0] }]
  s.faces = [[0, 1, 2]]
  s.mode = 'solid'
  return s
}

describe('useAvatars', () => {
  beforeEach(() => { useAvatars.setState({ shards: {}, asked: {}, mining: null, phase: null, minedMs: null, adoptError: null }); localStorage.clear(); vi.mocked(query).mockClear(); vi.mocked(publish).mockClear() })

  it('adopting a shard signs a kind 33331 event with d=avatar, publishes it and keeps a copy', async () => {
    const me = useCyberspace.getState().identity.pubkey
    expect(await useAvatars.getState().adopt(built())).toBe(true)
    const ev = vi.mocked(publish).mock.calls[0][0]
    expect(ev.kind).toBe(AVATAR_KIND)
    expect(ev.pubkey).toBe(me)
    expect(ev.tags.slice(0, 2)).toEqual([['d', 'avatar'], ['name', 'Arches']])
    // Paid: the floor for a one-gibson triangle, committed before mining and carried by the id.
    expect(ev.tags[2]).toEqual(['nonce', expect.any(String), '16'])
    expect(verifyAvatarWork(ev)).toMatchObject({ ok: true, required: 16, committed: 16 })
    expect(useAvatars.getState().mining).toBeNull()
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
    // The dodecahedron owes nothing: no nonce, no mining.
    expect(ev.tags.some((t) => t[0] === 'nonce')).toBe(false)
    expect(useAvatars.getState().shards[me]).toBeNull()
  })

  it('cancelling the work leaves the avatar as it was, with no error', async () => {
    const me = useCyberspace.getState().identity.pubkey
    const pending = useAvatars.getState().adopt(built())
    expect(useAvatars.getState().mining).toMatchObject({ required: 16, tries: 0 })
    useAvatars.getState().cancelAdopt()
    expect(await pending).toBe(false)
    expect(useAvatars.getState().mining).toBeNull()
    expect(useAvatars.getState().adoptError).toBeNull()
    expect(vi.mocked(publish)).not.toHaveBeenCalled()
    expect(me in useAvatars.getState().shards).toBe(false)
  })

  it('walks mining, signing and publishing, refusing a second adopt the whole way', async () => {
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
      expect(useAvatars.getState().phase).toBe('mining')
      await vi.waitFor(() => { expect(useAvatars.getState().phase).toBe('signing') })
      expect(useAvatars.getState().mining).toBeNull()
      expect(useAvatars.getState().minedMs).not.toBeNull()
      // The signer's prompt is open: a second press must not mine and ask again.
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

  it('a second adopt while one is mining is refused', async () => {
    const pending = useAvatars.getState().adopt(built())
    expect(await useAvatars.getState().adopt(built())).toBe(false)
    expect(await pending).toBe(true)
  })

  it('an avatar that has not paid is the dodecahedron to everyone', async () => {
    const pk = 'ef'.repeat(32)
    const shard = built()
    const unpaid = { ...avatarTemplate(shard, 30), pubkey: pk, id: 'ff'.repeat(32), sig: '' }
    vi.mocked(query).mockResolvedValueOnce([unpaid as never])
    useAvatars.getState().ensure(pk)
    await vi.waitFor(() => { expect(pk in useAvatars.getState().shards).toBe(true) })
    expect(useAvatars.getState().shards[pk]).toBeNull()
    // The same shape with its work done is drawn.
    const t = { ...avatarTemplate(shard, 31), pubkey: pk }
    let found = null
    for (let from = 0; found === null; from += 4096) found = mineChunk(t, 16, from, 4096)
    const paid = { ...nonceTagged(t, found!.nonce, 16), id: found!.id, sig: '' }
    expect(eventId(paid)).toBe(paid.id)
    useAvatars.setState({ asked: {} })
    vi.mocked(query).mockResolvedValueOnce([paid as never])
    useAvatars.getState().ensure(pk)
    await vi.waitFor(() => { expect(useAvatars.getState().shards[pk]?.name).toBe('Arches') })
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
