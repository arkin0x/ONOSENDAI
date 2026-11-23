/**
 * hopRecovery.test.ts - the store and the real worker layer together, a fake
 * Worker underneath: a hop whose worker fails ends in words, and the next press
 * lands it, with no refresh (arkinox, 2026-11-01).
 */

import { provedFor } from '../fixtures/provedHop'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})

const made = vi.hoisted(() => [] as unknown[])
vi.hoisted(() => {
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: ((e: { message: string }) => void) | null = null
    onmessageerror: (() => void) | null = null
    posted: unknown[] = []
    terminated = false
    constructor() { made.push(this) }
    postMessage(m: unknown): void { this.posted.push(m) }
    terminate(): void { this.terminated = true }
    addEventListener(): void {}
  }
  ;(globalThis as { Worker?: unknown }).Worker = FakeWorker
})

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
vi.mock('../../lib/chains', async (orig) => ({
  ...(await orig() as object),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => []),
}))

import { useCyberspace } from '../useCyberspace'
import { PROOF_WORKER_FAILED_MESSAGE, setProofHandler } from '../../lib/workers'
import { placeSpawn } from '../fixtures/placeSpawn'
import { moveDirection } from '../../lib/moves'

interface Fake {
  onmessage: (e: { data: unknown }) => void
  onerror: (e: { message: string }) => void
  posted: Array<{ id: number; mode: string; prevEventId: string }>
  terminated: boolean
}
const S = () => useCyberspace.getState()
const latest = (): Fake => made[made.length - 1] as Fake
const settle = async (): Promise<void> => { for (let i = 0; i < 40; i++) await Promise.resolve() }

beforeEach(async () => {
  setProofHandler((msg) => S().applyProofMessage(msg))
  await placeSpawn()
  S().clearFocus()
  useCyberspace.setState({ proof: { ...S().proof, status: 'idle', message: null }, transit: null, pendingTarget: null, chainConflict: null })
})
afterAll(() => setProofHandler(null))

describe('a hop whose proof worker fails', () => {
  it('ends in words, and the next press lands it', async () => {
    S().moveCursor(moveDirection(S().axes(), 'right'))
    await S().commit()
    expect(S().proof.status).toBe('computing')
    latest().onerror({ message: 'failed to load' })
    latest().onerror({ message: 'failed to load' })
    await settle()
    expect(S().proof).toMatchObject({ status: 'infeasible', message: PROOF_WORKER_FAILED_MESSAGE })

    const events = S().events.length
    await S().commit()
    expect(S().proof.status).toBe('computing')
    const worker = latest()
    expect(worker.terminated).toBe(false)
    const request = worker.posted[worker.posted.length - 1]
    worker.onmessage({ data: { type: 'started', id: request.id } })
    worker.onmessage({ data: { type: 'done', id: request.id, mode: 'hop', elapsedMs: 5, ...provedFor(request), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: request.prevEventId } })
    await vi.waitFor(() => expect(S().events).toHaveLength(events + 1))
    expect(S().proof).toMatchObject({ status: 'done', progress: 1, message: null })
  })

  it('survives a first failure with no word at all: the replacement simply answers', async () => {
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const events = S().events.length
    await S().commit()
    latest().onerror({ message: 'failed to load' })
    const worker = latest()
    const request = worker.posted[worker.posted.length - 1]
    expect(S().proof.status).toBe('computing')
    worker.onmessage({ data: { type: 'done', id: request.id, mode: 'hop', elapsedMs: 5, ...provedFor(request), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: request.prevEventId } })
    await vi.waitFor(() => expect(S().events).toHaveLength(events + 1))
  })
})
