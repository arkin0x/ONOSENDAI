/**
 * sidestepCheck.test.ts - a sidestep this machine signed is checked at
 * Level 1 (cyberspace-core verifySidestepLevel1) off the main thread, and
 * where no worker can run, here.
 *
 * Under vitest there is no Worker, so the store's tests reach only the
 * inline path. This drives the rest: the verify worker answering a
 * `sidestep` message, the page posting one (a claim that survives the
 * structured clone, BigInts and all) and taking its answer, the fallback
 * when the worker's file cannot load, and a signed event whose tags are not
 * a sidestep's at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const posts = vi.hoisted(() => {
  const posts: unknown[] = []
  const g = globalThis as unknown as { self?: unknown; postMessage?: (m: unknown) => void }
  g.self = globalThis
  g.postMessage = (m: unknown) => { posts.push(m) }
  return posts
})

import { bytesToHex, computeSidestepProof, encodeNonce, encodeOpenings } from 'cyberspace-core'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { positionHex, sidestepTemplate, type NostrEvent } from '../events'
import { localSidestepFailures, sidestepClaimOf } from '../sidestepCheck'
import type { VerifyRequest } from '../../workers/verify.worker'

const sk = generateSecretKey()
const PREV = '5a'.repeat(32)
// The leaf touching an h6 wall, and the leaf just past it.
const from = { x: (1n << 40n) + 31n, y: 5n, z: 9n }
const to = { ...from, x: from.x + 1n }

/** A sidestep signed here, proved for `proved`'s move and previous event. */
function signed(proved: { from: typeof from; prev: string } = { from, prev: PREV }): NostrEvent {
  const p = computeSidestepProof(proved.from.x, proved.from.y, proved.from.z, to.x, to.y, to.z, 0, proved.prev)
  const t = sidestepTemplate({
    createdAt: 1_000, genesisId: 'aa'.repeat(32), previousId: PREV, prevCoordHex: positionHex(from, 0), to, plane: 0, proofHash: p.proofHash,
    merkleRoots: [bytesToHex(p.merkleX), bytesToHex(p.merkleY), bytesToHex(p.merkleZ)],
    openings: [encodeOpenings(p.openings.x), encodeOpenings(p.openings.y), encodeOpenings(p.openings.z)],
    mnHex: encodeNonce(p.nonce), lcaHeights: p.lcaHeights,
  })
  return JSON.parse(JSON.stringify(finalizeEvent(t, sk))) as NostrEvent
}

const claimOf = (e: NostrEvent) => {
  const c = sidestepClaimOf(e, positionHex(from, 0), to, 0, PREV)
  if (Array.isArray(c)) throw new Error(`no claim: ${c.join(', ')}`)
  return c
}

afterEach(() => { delete (globalThis as { Worker?: unknown }).Worker })

describe('the verify worker, for a sidestep this machine signed', () => {
  it('answers a sidestep message with what failed: nothing for a sound proof, the names for one made under another head', async () => {
    await import('../../workers/verify.worker')
    const onmessage = (globalThis as unknown as { onmessage: (e: { data: VerifyRequest }) => Promise<void> }).onmessage
    // Through the structured clone, as postMessage would carry it.
    await onmessage({ data: structuredClone({ id: 7, kind: 'sidestep' as const, claim: claimOf(signed()) }) })
    await onmessage({ data: structuredClone({ id: 8, kind: 'sidestep' as const, claim: claimOf(signed({ from, prev: 'ab'.repeat(32) })) }) })
    expect(posts).toContainEqual({ id: 7, failed: [] })
    const bad = posts.find((p) => (p as { id: number }).id === 8) as { failed: string[] }
    expect(bad.failed).toContain('openings:x')
  })
})

describe('localSidestepFailures, on the page', () => {
  it('posts the claim to the verify worker and takes its answer', async () => {
    const sent: unknown[] = []
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null
      onerror: (() => void) | null = null
      terminated = false
      postMessage(m: { id: number }) { sent.push(m); queueMicrotask(() => this.onmessage?.({ data: { id: m.id, failed: ['from the worker'] } })) }
      terminate() { this.terminated = true }
    }
    ;(globalThis as { Worker?: unknown }).Worker = FakeWorker
    const failed = await localSidestepFailures(signed(), positionHex(from, 0), to, 0, PREV)
    expect(failed).toEqual(['from the worker'])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ kind: 'sidestep', claim: { from: { x: from.x }, to: { x: to.x }, previousEventIdHex: PREV } })
  })

  it('checks here when the worker file cannot load', async () => {
    class BrokenWorker {
      onmessage: unknown = null
      onerror: (() => void) | null = null
      postMessage() { queueMicrotask(() => this.onerror?.()) }
      terminate() {}
    }
    ;(globalThis as { Worker?: unknown }).Worker = BrokenWorker
    expect(await localSidestepFailures(signed(), positionHex(from, 0), to, 0, PREV)).toEqual([])
    // The N1 shape: proved from a position the chain does not stand at.
    expect(await localSidestepFailures(signed({ from: { ...from, y: from.y + 1n }, prev: PREV }), positionHex(from, 0), to, 0, PREV)).toContain('hy')
  })

  it('names what is missing when the signed tags are not a sidestep\'s', async () => {
    const e = signed()
    const stripped = { ...e, tags: e.tags.filter((t) => t[0] !== 'mr' && t[0] !== 'hz') }
    expect(await localSidestepFailures(stripped, positionHex(from, 0), to, 0, PREV)).toEqual(['mr', 'hz'])
    expect(await localSidestepFailures(e, '', to, 0, PREV)).toEqual(['c'])
  })
})
