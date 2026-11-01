/**
 * proofWorkerRecovery.test.ts - a move's proof always ends in an answer.
 *
 * The store waits in 'computing' for the worker, and a worker that never
 * loaded or has died never answers, so without this the move read 0% until a
 * refresh (arkinox, 2026-11-01).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProofRequest, ProofResponse } from '../workers'

class FakeWorker {
  static made: FakeWorker[] = []
  static failToConstruct = 0
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  posted: ProofRequest[] = []
  terminated = false
  constructor() {
    if (FakeWorker.failToConstruct > 0) {
      FakeWorker.failToConstruct--
      throw new Error('cannot start a worker')
    }
    FakeWorker.made.push(this)
  }
  postMessage(request: ProofRequest): void { this.posted.push(request) }
  terminate(): void { this.terminated = true }
  addEventListener(): void {}
  say(data: unknown): void { this.onmessage?.({ data }) }
  fail(message = 'failed to load'): void { this.onerror?.({ message }) }
}

const request = (id: number): ProofRequest => ({
  id, mode: 'hop', from: { x: 0n, y: 0n, z: 0n }, to: { x: 1n, y: 0n, z: 0n }, plane: 0, prevEventId: 'a'.repeat(64), maxComputeHeight: 17,
})
const done = (id: number): ProofResponse => ({ type: 'done', id, mode: 'hop', elapsedMs: 1, proofHash: 'b'.repeat(64), terrainK: 1, lca: { x: 1, y: 0, z: 0 }, totalOps: 1 })

let w: typeof import('../workers')
let heard: ProofResponse[]
const latest = (): FakeWorker => FakeWorker.made[FakeWorker.made.length - 1]

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  FakeWorker.made = []
  FakeWorker.failToConstruct = 0
  vi.stubGlobal('Worker', FakeWorker)
  w = await import('../workers')
  heard = []
  w.setProofHandler((msg) => heard.push(msg))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the proof worker', () => {
  it('passes a normal run through, and keeps "started" to itself', () => {
    w.postProof(request(1))
    latest().say({ type: 'started', id: 1 })
    latest().say({ type: 'progress', id: 1, fraction: 0.5, elapsedMs: 1 })
    latest().say(done(1))
    expect(heard.map((m) => m.type)).toEqual(['progress', 'done'])
    vi.advanceTimersByTime(w.PROOF_QUIET_MS * 2)
    expect(heard).toHaveLength(2)
    expect(FakeWorker.made).toHaveLength(1)
  })

  it('replaces a worker whose file failed to load, and sends the same request', () => {
    w.postProof(request(1))
    const first = latest()
    first.fail()
    expect(first.terminated).toBe(true)
    expect(FakeWorker.made).toHaveLength(2)
    expect(latest().posted).toEqual([request(1)])
    latest().say(done(1))
    expect(heard.map((m) => m.type)).toEqual(['done'])
  })

  it('answers with an error when the replacement fails too', () => {
    w.postProof(request(1))
    latest().fail()
    latest().fail()
    expect(heard).toEqual([expect.objectContaining({ type: 'error', id: 1, message: w.PROOF_WORKER_FAILED_MESSAGE })])
    expect(FakeWorker.made).toHaveLength(2)
  })

  it('replaces a worker that never says it started, with no error event at all', () => {
    w.postProof(request(1))
    vi.advanceTimersByTime(w.PROOF_START_MS - 1)
    expect(FakeWorker.made).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWorker.made).toHaveLength(2)
    vi.advanceTimersByTime(w.PROOF_START_MS)
    expect(heard).toEqual([expect.objectContaining({ type: 'error', id: 1 })])
  })

  it('does not rerun a proof whose worker died after starting', () => {
    w.postProof(request(1))
    latest().say({ type: 'started', id: 1 })
    latest().fail('out of memory')
    expect(FakeWorker.made).toHaveLength(1)
    expect(heard).toEqual([expect.objectContaining({ type: 'error', id: 1 })])
  })

  it('gives up on a started worker gone silent, and each message buys it more time', () => {
    w.postProof(request(1))
    latest().say({ type: 'started', id: 1 })
    vi.advanceTimersByTime(w.PROOF_QUIET_MS - 1)
    latest().say({ type: 'progress', id: 1, fraction: 0.1, elapsedMs: 1 })
    vi.advanceTimersByTime(w.PROOF_QUIET_MS - 1)
    expect(heard.map((m) => m.type)).toEqual(['progress'])
    vi.advanceTimersByTime(1)
    expect(heard.map((m) => m.type)).toEqual(['progress', 'error'])
  })

  it('answers when no worker can even be constructed', () => {
    FakeWorker.failToConstruct = 2
    w.postProof(request(1))
    expect(heard).toEqual([expect.objectContaining({ type: 'error', id: 1 })])
  })

  it('says nothing after a cancel, and has the next worker ready', () => {
    w.postProof(request(1))
    const first = latest()
    w.cancelProof()
    expect(first.terminated).toBe(true)
    expect(FakeWorker.made).toHaveLength(2)
    vi.advanceTimersByTime(w.PROOF_START_MS * 3)
    expect(heard).toEqual([])
    expect(FakeWorker.made).toHaveLength(2)
  })

  it('a preloaded worker that fails is nobody\'s move, and the next move gets a new one', () => {
    w.preloadProofWorker()
    latest().fail()
    expect(heard).toEqual([])
    w.postProof(request(1))
    expect(FakeWorker.made).toHaveLength(2)
    expect(latest().posted).toEqual([request(1)])
  })
})
