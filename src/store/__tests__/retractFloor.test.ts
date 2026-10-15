/**
 * A PUBLISH right after a RETRACT and a reload, in the same second, is still
 * newer than the deletion (review of snocrash #36, 2026-10-15). RETRACT
 * forgets the publish record, and a reload loses the in-memory clock, so the
 * retraction's own second is kept for a day.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  publishMany: vi.fn(async () => ({ ok: true, accepted: ['wss://relay.test'] })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
  connectRelay: vi.fn(async () => true),
  authForRead: vi.fn(async () => {}),
  subscribeOne: vi.fn(() => ({ close: () => {} })),
}))

import { newShard, type ShardModel } from 'sno-core/shards'

function step(): ShardModel {
  const s = newShard('Step')
  s.id = 'floor-1'
  s.mode = 'solid'
  s.vertices = [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 1], c: [1, 1, 1] }]
  s.faces = [[0, 1, 2]]
  return s
}

type Sent = { kind: number; created_at: number }
async function load(): Promise<{ usePublished: typeof import('../usePublished')['usePublished']; last: () => Sent }> {
  const { usePublished } = await import('../usePublished')
  const { publishMany } = await import('../../lib/relay')
  return { usePublished, last: () => vi.mocked(publishMany).mock.calls.at(-1)![1] as never }
}

afterEach(() => { vi.useRealTimers() })

describe('a publish after a retract and a reload', () => {
  it('is newer than the deletion even within the same second', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
    const before = await load()
    const s = step()
    expect(await before.usePublished.getState().publish(s)).toBe(true)
    expect(await before.usePublished.getState().retract(s)).toBe(true)
    const deletion = before.last()
    expect(deletion.kind).toBe(5)
    // A reload: fresh modules, the same storage, the same second.
    vi.resetModules()
    const after = await load()
    expect(await after.usePublished.getState().publish(s)).toBe(true)
    expect(after.last().kind).toBe(33331)
    expect(after.last().created_at).toBeGreaterThan(deletion.created_at)
  }, 20_000)
})
