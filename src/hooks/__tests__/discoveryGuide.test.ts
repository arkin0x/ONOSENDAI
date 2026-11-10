/**
 * discoveryGuide.test.ts: the background scan and the tutorial guide's bags
 * (first-arrival tutorial design, 2026-11-10, D1).
 *
 * A guide bag under one of the scan's lookup ids is opened at once, before
 * the relays answer, with plain unbag: never kept in the found bags (which
 * outlive the tutorial and ask relays about their authors), never named to a
 * relay. A guide bag staged again replaces what the one before it gave.
 *
 * The hook runs under the same small stand-in for React as discoveryTv.test.ts.
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
  useState: (v: unknown) => [v, () => {}],
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    const k = ei++
    const prev = effects[k]
    if (prev && deps && prev.deps && deps.every((d, n) => d === prev.deps![n])) return
    pending.push(() => { prev?.cleanup?.(); effects[k] = { deps, cleanup: fn() || undefined } })
  },
}))

const LOOKUP = 'd'.repeat(64)
const GUIDE = 'a'.repeat(64)
const guideBag = { id: 'g'.repeat(64), pubkey: GUIDE, kind: 33330, created_at: 2_000, content: '', tags: [['d', LOOKUP]], sig: 's' }
const found = [{ eventId: 'i'.repeat(64), author: GUIDE }]
const calls = vi.hoisted(() => ({ order: [] as string[], queries: [] as unknown[], remembered: 0, plain: 0 }))
const shards = vi.hoisted(() => ({
  dropStale: vi.fn((..._a: unknown[]) => { calls.order.push('dropStale') }),
  honorRetractions: vi.fn(),
  addDiscovered: vi.fn((..._a: unknown[]) => { calls.order.push('addDiscovered') }),
}))

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
// The relays answer slowly and with nothing: the guide's finds are filed before they do.
vi.mock('../../lib/relay', () => ({ query: async (f: unknown) => { calls.queries.push(f); calls.order.push('query'); return [] } }))
vi.mock('../../lib/bagVersions', () => ({ bagsToOpen: async (sent: unknown[]) => { calls.order.push('bagsToOpen'); return { bags: sent, deletions: [] } } }))
vi.mock('../../lib/foundCache', () => ({ unbagRemembered: async () => { calls.remembered++; return [] } }))
vi.mock('../../lib/hidden', async (orig) => ({ ...(await orig<typeof import('../../lib/hidden')>()), unbag: async () => { calls.plain++; return found } }))
vi.mock('../../lib/references', () => ({ resolveReference: async () => null }))

const asked: { id?: number; listener?: (e: { data: unknown }) => void } = {}
class FakeWorker {
  addEventListener(_t: string, l: (e: { data: unknown }) => void): void { asked.listener = l }
  removeEventListener(): void {}
  postMessage(m: { id: number }): void { asked.id = m.id }
  terminate(): void {}
}
;(globalThis as { Worker?: unknown }).Worker = FakeWorker

const { setGuideBags } = await import('../../tutorial/guideBags')
const { useDiscovery } = await import('../useDiscovery')

function render(): void {
  ei = 0
  ri = 0
  pending = []
  useDiscovery()
  for (const run of pending) run()
}

describe('the background scan and the tutorial guide\'s bags', () => {
  it('opens a guide bag at once with plain unbag, files it before the relays answer, never remembers it or names the guide', async () => {
    setGuideBags([guideBag as never])
    render()
    asked.listener!({ data: { id: asked.id, type: 'key', key: { lookupId: LOOKUP, keyHex: 'e'.repeat(64), height: 6 } } })
    asked.listener!({ data: { id: asked.id, type: 'done' } })
    await vi.waitFor(() => { expect(shards.honorRetractions).toHaveBeenCalled() })
    // Filed first (staged again: what the bag before it gave is replaced), then the relays, then again with their answer.
    expect(calls.order.slice(0, 3)).toEqual(['dropStale', 'addDiscovered', 'query'])
    expect(shards.addDiscovered.mock.calls[0][0]).toEqual(found)
    // The guide's bag stands among what the relays sent, for the stale check.
    const bags = shards.dropStale.mock.calls[1][0] as Array<{ id: string }>
    expect(bags.map((b) => b.id)).toEqual([guideBag.id])
    expect(calls.remembered).toBe(0)
    expect(calls.plain).toBe(2)
    expect(JSON.stringify(calls.queries)).not.toContain(GUIDE)
    setGuideBags(null)
  })
})
