/**
 * proofWorker.test.ts - the proof worker as the page runs it, one message in
 * and its posts out, for a hop (hop proof version 2).
 *
 * The worker answers a hop with the three tags of spec 8.4 and the region
 * key, derives that key once (it hashes all of region_n, 0.67 s at h20), and
 * paces its bar in time (lib/hopProgress.ts): monotone, never past 1. A hop
 * made from its answer verifies with cyberspace-core at Level 1.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

const posts = vi.hoisted(() => {
  const posts: unknown[] = []
  const g = globalThis as unknown as { self?: unknown; postMessage?: (m: unknown) => void }
  g.self = globalThis
  g.postMessage = (m: unknown) => { posts.push(m) }
  return posts
})

const derived = vi.hoisted(() => ({ calls: 0 }))
vi.mock('cyberspace-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cyberspace-core')>()
  return { ...actual, deriveRegionKeys: (n: bigint) => { derived.calls++; return actual.deriveRegionKeys(n) } }
})

import { bytesToHex, computeHopProofV2, deriveRegionKeys, verifyHopLevel1 } from 'cyberspace-core'
import type { ProofRequest, ProofResponse } from '../proof.worker'

const PREV = '5a'.repeat(32)
const from = { x: 1n << 40n, y: 3n << 30n, z: 7n }
const to = { x: from.x ^ (1n << 10n), y: from.y ^ 6n, z: from.z }

type Done = Extract<ProofResponse, { type: 'done' }>
let done: Done
let progress: number[]

beforeAll(async () => {
  await import('../proof.worker')
  const onmessage = (globalThis as unknown as { onmessage: (e: { data: ProofRequest }) => void }).onmessage
  derived.calls = 0
  onmessage({ data: { id: 1, mode: 'hop', from, to, plane: 0, prevEventId: PREV, maxComputeHeight: 20 } })
  done = posts.find((p) => (p as ProofResponse).type === 'done') as Done
  progress = posts.filter((p) => (p as ProofResponse).type === 'progress').map((p) => (p as { fraction: number }).fraction)
})

describe('the proof worker, for a hop', () => {
  it('answers with the seal as proof and the three tags of 8.4', () => {
    expect(done).toBeDefined()
    expect(done.mode).toBe('hop')
    expect(done.prevEventId).toBe(PREV)
    expect(done.hop).toBeDefined()
    expect(done.proofHash).toBe(done.hop!.sealHex)
    const p = computeHopProofV2(from.x, from.y, from.z, to.x, to.y, to.z, 0, PREV)
    expect(done.hop).toEqual({ sealHex: p.tags.proof, mnHex: p.tags.mn, mpHex: p.tags.mp })
    expect(done.terrainK).toBe(p.terrainK)
  })

  it('makes a hop that verifies with core at Level 1', () => {
    expect(verifyHopLevel1({
      from: { ...from, plane: 0 }, to: { ...to, plane: 0 }, previousEventIdHex: PREV,
      proof: done.hop!.sealHex, nonce: done.hop!.mnHex, openings: done.hop!.mpHex, eventId: 'f0'.repeat(32),
    })).toEqual([])
  })

  it('derives the region key once, and it is the region the hop crossed', () => {
    expect(derived.calls).toBe(1)
    const p = computeHopProofV2(from.x, from.y, from.z, to.x, to.y, to.z, 0, PREV)
    const keys = deriveRegionKeys(p.regionN)
    expect(done.region).toMatchObject({ keyHex: bytesToHex(keys.locationDecryptionKey), lookupId: keys.lookupIdHex, heights: [11, 3, 0] })
  })

  it('reports progress that only climbs and never passes 1', () => {
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1])
    for (const f of progress) expect(f).toBeLessThanOrEqual(1)
  })

  it('never builds hop_n: a request for a hop over the ceiling is an error, not a proof', async () => {
    posts.length = 0
    const onmessage = (globalThis as unknown as { onmessage: (e: { data: ProofRequest }) => void }).onmessage
    onmessage({ data: { id: 2, mode: 'hop', from, to: { ...to, x: from.x ^ (1n << 25n) }, plane: 0, prevEventId: PREV, maxComputeHeight: 12 } })
    expect((posts[posts.length - 1] as ProofResponse).type).toBe('error')
  })
})
