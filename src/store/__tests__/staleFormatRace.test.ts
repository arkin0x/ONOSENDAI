/**
 * staleFormatRace.test.ts - a stale-format cut that lands while a proof is
 * in flight, and the Level 1 check of every local hop (review of #539, F1
 * and F2; the reviewer's repro made a test).
 *
 * F1: a tab of the old build saves an unsent version 1 hop on the same head
 * while this tab computes a hop. The cut takes it away and puts the head
 * back where the proof started; the proof must not then be signed at the
 * current position (a hop with C equal to c, carrying a seal for another
 * move). The cut stops the proof as a respawn does, and finishProof refuses
 * a proof with no pending target.
 *
 * F2: a local hop is checked at Level 1 under its own signed id before it
 * is recorded or queued: a forged seal is never kept, a real one is.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { posted, sent, cancels } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  return { posted: [] as Array<{ id: number; mode: string; prevEventId: string; from: unknown; to: unknown; plane: 0 | 1 }>, sent: [] as unknown[], cancels: { n: 0 } }
})
vi.mock('../../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workers')>()
  return { ...actual, postProof: vi.fn((m: never) => { posted.push(m) }), cancelProof: vi.fn(() => { cancels.n++ }) }
})
vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []), askChainEvents: vi.fn(async () => []) }
})
vi.mock('../../lib/relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/relay')>()
  return { ...actual, publish: async (ev: unknown) => { sent.push(ev); return { ok: true as const, accepted: [actual.CYBERSPACE_RELAY] } } }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { ACTION_KIND, hopTemplate, positionHex, sectorTags, spawnTemplate, type NostrEvent } from '../../lib/events'
import { provedFor } from '../fixtures/provedHop'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const at = (dx: bigint) => ({ x: home.x ^ dx, y: home.y, z: home.z })
const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => ({ ...finalizeEvent(t, sk) }) as NostrEvent
const spawn = sign(spawnTemplate(pk, 1_000))
const h1 = sign(hopTemplate({ createdAt: 1_010, genesisId: spawn.id, previousId: spawn.id, prevCoordHex: pk, to: at(4n), plane: home.plane, proofHash: '2'.repeat(64), mn: '0'.repeat(16), mp: '00' }))

/** A fresh page holding [spawn, h1], both on the relays, LOCAL. */
async function page() {
  localStorage.clear()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  localStorage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  localStorage.setItem('onosendai:live', '0')
  localStorage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events: [spawn, h1], published: [spawn.id, h1.id], stats: {} }))
  vi.resetModules()
  const store = await import('../useCyberspace')
  await store.savedChainLoaded()
  store.useCyberspace.setState({ selfCheck: { pubkey: pk, status: 'none' } })
  return store
}

/** Commit one hop toward `target` and return the request the worker got. */
async function commitTo(store: Awaited<ReturnType<typeof page>>, target: { x: bigint; y: bigint; z: bigint }) {
  store.useCyberspace.setState({ cursor: target })
  await store.useCyberspace.getState().commit()
  expect(posted).toHaveLength(1)
  return posted[0]
}

describe('review of #539', () => {
  beforeEach(() => { posted.length = 0; sent.length = 0; cancels.n = 0 })

  it('F1: a cut while a proof is in flight on the same head stops the proof, and nothing is signed at the wrong place', async () => {
    const store = await page()
    const S = store.useCyberspace.getState
    expect(S().prevEventId).toBe(h1.id)
    const target = { x: at(4n).x ^ 1n, y: home.y, z: home.z }
    const req = await commitTo(store, target)
    expect(S().pendingTarget).toEqual(target)

    // A stale tab of the old build signs a version 1 hop on the same head and saves it, unsent.
    const v1 = sign({
      kind: ACTION_KIND, created_at: 1_020, content: '',
      tags: [['A', 'hop'], ['e', spawn.id, '', 'genesis'], ['e', h1.id, '', 'previous'], ['c', positionHex(at(4n), home.plane)], ['C', positionHex(at(12n), home.plane)], ['proof', '1'.repeat(64)], ...sectorTags(at(12n))],
    })
    localStorage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events: [spawn, h1, v1], published: [spawn.id, h1.id], stats: {}, savedAt: Date.now() }))
    localStorage.setItem(`onosendai:chain-mark:${pk}`, `3:${v1.id.slice(0, 16)}:zzzz`)

    // The worker answers for the original request, with a real proof for it.
    await S().applyProofMessage({ type: 'done', id: req.id, mode: 'hop', elapsedMs: 1, ...provedFor(req), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: req.prevEventId })

    const ids = S().events.map((e) => e.id)
    expect(ids).not.toContain(v1.id)
    // No hop was signed whose C is its own c.
    for (const e of S().events.slice(2)) {
      const c = e.tags.find((t) => t[0] === 'c')?.[1]
      const C = e.tags.find((t) => t[0] === 'C')?.[1]
      expect(C).not.toBe(c)
    }
    // Either nothing was signed (the cut stopped the proof), or what was signed goes where its proof went.
    const head = S().events[S().events.length - 1]
    if (head.id !== h1.id) expect(head.tags.find((t) => t[0] === 'C')?.[1]).toBe(positionHex(target, home.plane))
    expect(sent).toHaveLength(0)
  }, 20_000)

  it('F1: the cut stops a proof in flight (as a respawn does), and a late answer for it signs nothing', async () => {
    const store = await page()
    const S = store.useCyberspace.getState
    const target = { x: at(4n).x ^ 1n, y: home.y, z: home.z }
    const req = await commitTo(store, target)
    // An unsent old hop lands in the chain in hand (a fold) while the proof computes.
    const v1 = sign({
      kind: ACTION_KIND, created_at: 1_020, content: '',
      tags: [['A', 'hop'], ['e', spawn.id, '', 'genesis'], ['e', h1.id, '', 'previous'], ['c', positionHex(at(4n), home.plane)], ['C', positionHex(at(12n), home.plane)], ['proof', '1'.repeat(64)], ...sectorTags(at(12n))],
    })
    store.useCyberspace.setState({ events: [...S().events, v1], prevEventId: v1.id, published: { ...S().published, [v1.id]: 'queued' } })
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, h1.id])
    expect(cancels.n).toBe(1)
    expect(S().pendingTarget).toBeNull()
    expect(S().proof.status).not.toBe('computing')
    const before = S().events.length
    await S().applyProofMessage({ type: 'done', id: req.id, mode: 'hop', elapsedMs: 1, ...provedFor(req), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: req.prevEventId })
    expect(S().events).toHaveLength(before)
  }, 20_000)

  it('F1: finishProof refuses a proof with no pending target', async () => {
    const store = await page()
    const S = store.useCyberspace.getState
    const target = { x: at(4n).x ^ 1n, y: home.y, z: home.z }
    const req = await commitTo(store, target)
    store.useCyberspace.setState({ pendingTarget: null })
    await S().finishProof({ type: 'done', id: req.id, mode: 'hop', elapsedMs: 1, ...provedFor(req), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: req.prevEventId })
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, h1.id])
    expect(S().proof.message).toContain('no longer lined up')
  }, 20_000)

  it('F2: a local hop whose proof fails Level 1 under its own id is never recorded or queued; a real one is', async () => {
    const store = await page()
    const S = store.useCyberspace.getState
    const target = { x: at(4n).x ^ 1n, y: home.y, z: home.z }
    const req = await commitTo(store, target)
    const real = provedFor(req)
    // The same tags with one opening character changed: well formed, and false.
    const mp = real.hop!.mpHex
    const forged = { ...real.hop!, mpHex: (mp[0] === '0' ? '1' : '0') + mp.slice(1) }
    await S().applyProofMessage({ type: 'done', id: req.id, mode: 'hop', elapsedMs: 1, proofHash: real.proofHash, hop: forged, terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: req.prevEventId })
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, h1.id])
    expect(S().proof.message).toContain('did not pass the check')
    expect(JSON.parse(localStorage.getItem(`onosendai:chain:${pk}`)!).events).toHaveLength(2)

    posted.length = 0
    const req2 = await commitTo(store, target)
    await S().applyProofMessage({ type: 'done', id: req2.id, mode: 'hop', elapsedMs: 1, ...provedFor(req2), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: req2.prevEventId })
    expect(S().events).toHaveLength(3)
    expect(S().position).toEqual(target)
    expect(S().published[S().prevEventId]).toBe('queued')
  }, 20_000)
})
