/**
 * twoDevicesRace.test.ts - two devices of one identity race, and the second
 * refuses instead of forking (arkinox's ruling of 2026-10-08: confirm the
 * head immediately before every signature; the live feed is the early
 * warning).
 *
 * The race the review of #236 found: B confirms its head at h and starts a
 * proof; 0.4 s later A's hop from h lands on the relay; B's proof finishes
 * 1.2 s after its confirmation. With a confirmation reused for 3 s, B signed
 * a second child of h, and the chain forked, which ends it. Two store
 * instances, each with its own storage, share one relay here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const dev = vi.hoisted(() => {
  const stores: Record<string, Map<string, string>> = { A: new Map(), B: new Map() }
  const state = { current: 'A' as 'A' | 'B', stores }
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => state.stores[state.current].get(k) ?? null,
    setItem: (k: string, v: string) => { state.stores[state.current].set(k, String(v)) },
    removeItem: (k: string) => { state.stores[state.current].delete(k) },
    clear: () => { state.stores[state.current].clear() },
  }
  return state
})
const relay = vi.hoisted(() => ({ events: [] as Array<{ id: string; pubkey: string }>, asked: { A: 0, B: 0 } as Record<string, number> }))
const posted = vi.hoisted(() => ({ A: [] as Array<{ id: number; prevEventId: string }>, B: [] as Array<{ id: number; prevEventId: string }> }))
const cancels = vi.hoisted(() => ({ A: 0, B: 0 } as Record<string, number>))

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/chains', async (orig) => ({
  ...(await orig() as object),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async (pubkey: string) => {
    relay.asked[dev.current]++
    return relay.events.filter((e) => e.pubkey === pubkey)
  }),
}))
vi.mock('../../lib/workers', async (orig) => ({
  ...(await orig() as object),
  postProof: (m: { id: number; prevEventId: string }) => { posted[dev.current].push(m) },
  cancelProof: () => { cancels[dev.current]++ },
}))

import { buildChain, type NostrEvent } from '../../lib/events'
import { moveDirection } from '../../lib/moves'

type Store = typeof import('../useCyberspace')
let A: Store
let B: Store
let clock = Date.now()
const at = (ms: number): void => { clock += ms; vi.setSystemTime(clock) }
const S = (m: Store) => m.useCyberspace.getState()
const prevOf = (e: NostrEvent): string | undefined => e.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1]

const done = (who: 'A' | 'B', elapsedMs: number) => {
  const p = posted[who][posted[who].length - 1]
  return { type: 'done' as const, id: p.id, mode: 'hop' as const, elapsedMs, proofHash: 'ab'.repeat(32), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: p.prevEventId }
}
async function as<T>(who: 'A' | 'B', f: () => Promise<T> | T): Promise<T> {
  dev.current = who
  return await f()
}
/** The chain published, as the relay already holds it. */
function published(m: Store): void {
  const s = S(m)
  m.useCyberspace.setState({ published: Object.fromEntries(s.events.map((e) => [e.id, 'ok' as const])), selfCheck: { pubkey: s.identity.pubkey, status: 'found' } as never, proof: { ...s.proof, status: 'idle', message: null } })
}
/** A moves and its hop reaches the relay; returns the hop. */
async function aMoves(): Promise<NostrEvent> {
  await as('A', async () => { S(A).moveCursor(moveDirection(S(A).axes(), 'up')); await S(A).commit(); await S(A).applyProofMessage(done('A', 5)) })
  const a1 = S(A).events[S(A).events.length - 1]
  relay.events.push(a1)
  return a1
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(60_000)
  dev.stores.A = new Map(); dev.stores.B = new Map()
  relay.events = []; relay.asked = { A: 0, B: 0 }
  posted.A = []; posted.B = []
  cancels.A = 0; cancels.B = 0
  vi.resetModules()
  dev.current = 'A'
  A = await import('../useCyberspace')
  const { placeSpawn } = await import('../fixtures/placeSpawn')
  await placeSpawn()
  relay.events.push(...S(A).events)
  published(A)
  // Device B: the same key and chain (its storage cloned), its own module.
  dev.stores.B = new Map(dev.stores.A)
  vi.resetModules()
  dev.current = 'B'
  B = await import('../useCyberspace')
  published(B)
  expect(S(B).prevEventId).toBe(S(A).prevEventId)
})

describe('two devices, one identity, racing', () => {
  it('a silent live feed: B confirms at h, A\'s hop lands 0.4 s later, B\'s proof ends 1.2 s after its confirmation; B asks again before signing, adopts A\'s hop and refuses', async () => {
    const h = S(B).prevEventId
    await as('B', async () => { S(B).moveCursor(moveDirection(S(B).axes(), 'right')); await S(B).commit() })
    expect(posted.B).toHaveLength(1)
    expect(relay.asked.B).toBe(1)
    at(400)
    const a1 = await aMoves()
    expect(prevOf(a1)).toBe(h)
    at(800)
    const before = S(B).events.length
    await as('B', () => S(B).applyProofMessage(done('B', 1_200)))
    expect(relay.asked.B).toBe(2)
    expect(S(B).events).toHaveLength(before + 1)
    expect(S(B).prevEventId).toBe(a1.id)
    expect(S(B).proof.message).toMatch(/^Your chain moved while this proof waited to be signed/)
    // Nothing of B's was signed: the relay's chain has one child of h, no fork.
    const chain = buildChain([...relay.events as NostrEvent[], ...S(B).events], S(A).identity.pubkey)
    expect(chain[0].fork).toBeUndefined()
  })

  it('the live feed delivers A\'s hop 0.4 s into B\'s proof: B stops the proof at once, adopts the hop, and its late finish signs nothing', async () => {
    await as('B', async () => { S(B).moveCursor(moveDirection(S(B).axes(), 'right')); await S(B).commit() })
    const askedAtCommit = relay.asked.B
    at(400)
    const a1 = await aMoves()
    await as('B', () => S(B).adoptChain([a1]))
    expect(cancels.B).toBe(1)
    expect(S(B).proof.status).not.toBe('computing')
    expect(S(B).prevEventId).toBe(a1.id)
    expect(S(B).proof.message).toMatch(/^Your chain moved while this proof waited to be signed/)
    at(800)
    const count = S(B).events.length
    await as('B', () => S(B).applyProofMessage(done('B', 1_200)))
    expect(S(B).events).toHaveLength(count)
    // Refused on what the feed brought, with no second look at the relays needed.
    expect(relay.asked.B).toBe(askedAtCommit)
  })
})
