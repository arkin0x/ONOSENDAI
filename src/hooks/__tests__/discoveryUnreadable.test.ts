/**
 * discoveryUnreadable.test.ts: the background scan never counts a bag that
 * does not open with its key as the current version of its address. Read as
 * empty, it took every find of the version before it (lib/bagVersions.ts
 * staleFinds), a door and the room behind it too. What did open is judged as
 * before.
 *
 * The hook runs under the same small stand-in for React as discoveryTv.test.ts,
 * with the stores as plain objects and a Worker the test answers by hand.
 */
import { describe, expect, it, vi } from 'vitest'

interface Effect { deps?: unknown[]; cleanup?: () => void }
const effects: Effect[] = []
const refs: Array<{ current: unknown }> = []
let pending: Array<() => void> = []
let ei = 0
let ri = 0
vi.mock('react', () => ({
  useRef: (v: unknown) => { refs[ri] ??= { current: v }; return refs[ri++] },
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    const k = ei++
    const prev = effects[k]
    if (prev && deps && prev.deps && deps.every((d, n) => d === prev.deps![n])) return
    pending.push(() => { prev?.cleanup?.(); effects[k] = { deps, cleanup: fn() || undefined } })
  },
}))

const BAD = 'b'.repeat(64)
const GOOD = 'a'.repeat(64)
const bag = (id: string) => ({ id, pubkey: 'p'.repeat(64), kind: 33330, created_at: 2_000, content: '', tags: [['d', 'd'.repeat(64)]], sig: '' })
const shards = vi.hoisted(() => ({ dropStale: vi.fn(), honorRetractions: vi.fn(), addDiscovered: vi.fn() }))

const cs = { anchor: { x: 1000n, y: 5n, z: 7n }, anchorPlane: 0, atHead: () => false, headPlane: 0 }
const tv = { on: false }
vi.mock('../../store/useCyberspace', () => ({
  MAX_COMPUTE_HEIGHT: 20,
  useCyberspace: Object.assign((sel: (s: typeof cs) => unknown) => sel(cs), { getState: () => cs }),
}))
vi.mock('../../store/useTv', () => ({ useTv: Object.assign((sel: (s: typeof tv) => unknown) => sel(tv), { getState: () => tv }) }))
vi.mock('../../store/useShards', () => ({
  SCAN_MAX_HEIGHT: 12,
  useShards: { getState: () => ({ setScanning: () => {}, freshOf: () => [], ownDoorAddresses: () => [], ...shards }) },
}))
vi.mock('../../store/useSecrets', () => ({ useSecrets: { getState: () => ({ setCurrent: () => {}, recordPlace: async () => {}, hold: () => {} }) } }))
vi.mock('../../store/useCeremony', () => ({ useCeremony: { getState: () => ({ mark: () => {} }) } }))
vi.mock('../../lib/relay', () => ({ query: async () => [bag(BAD), bag(GOOD)] }))
vi.mock('../../lib/bagVersions', () => ({ bagsToOpen: async (sent: unknown[]) => ({ bags: sent, deletions: [] }) }))
vi.mock('../../lib/foundCache', async () => {
  const { BagUnreadable } = await import('../../lib/hidden')
  return { unbagRemembered: async (ev: { id: string }) => { if (ev.id === BAD) throw new BagUnreadable(ev.id); return [] } }
})
vi.mock('../../lib/references', () => ({ resolveReference: async () => null }))

/** The scan's request id and the hook's listener, so the test answers as the region worker would. */
const asked: { id?: number; listener?: (e: { data: unknown }) => void } = {}
class FakeWorker {
  addEventListener(_t: string, l: (e: { data: unknown }) => void): void { asked.listener = l }
  removeEventListener(): void {}
  postMessage(m: { id: number }): void { asked.id = m.id }
  terminate(): void {}
}
;(globalThis as { Worker?: unknown }).Worker = FakeWorker

const { useDiscovery } = await import('../useDiscovery')

function render(): void {
  ei = 0
  ri = 0
  pending = []
  useDiscovery()
  for (const run of pending) run()
}

describe('the background scan and a bag that does not open with its key', () => {
  it('judges what is stale by the bags that opened only', async () => {
    render()
    expect(asked.id).toBeDefined()
    asked.listener!({ data: { id: asked.id, type: 'key', key: { lookupId: 'd'.repeat(64), keyHex: 'e'.repeat(64), height: 6 } } })
    asked.listener!({ data: { id: asked.id, type: 'done' } })
    await vi.waitFor(() => { expect(shards.dropStale).toHaveBeenCalled() })
    const bags = shards.dropStale.mock.calls[0][0] as Array<{ id: string }>
    expect(bags.map((b) => b.id)).toEqual([GOOD])
    // A bag that would not open still stands at its address: it is no retraction.
    const standing = shards.honorRetractions.mock.calls[0][1] as Array<{ id: string }>
    expect(standing.map((b) => b.id)).toEqual([BAD, GOOD])
  })
})
