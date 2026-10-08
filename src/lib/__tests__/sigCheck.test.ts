/**
 * sigCheck.test.ts - a saved chain's signatures are checked in a Web Worker
 * where there is one, and on the main thread, a chunk at a time, where there
 * is none or it fails; either way the answer is the same.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, verifyEvent, type VerifiedEvent } from 'nostr-tools/pure'
import { checkSignatures } from '../sigCheck'
import type { NostrEvent } from '../events'

const sk = generateSecretKey()
const signed = (n: number): NostrEvent => JSON.parse(JSON.stringify(finalizeEvent({ kind: 1, created_at: n, tags: [], content: String(n) }, sk))) as NostrEvent
const spoiled = (e: NostrEvent): NostrEvent => ({ ...e, sig: e.sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) })

const realWorker = (globalThis as { Worker?: unknown }).Worker
afterEach(() => { (globalThis as { Worker?: unknown }).Worker = realWorker })

/** A stand-in Worker that answers as workers/sig.worker.ts does, or fails. */
function fakeWorker(made: string[], fail = false): unknown {
  return class {
    onmessage: ((m: { data: { bad: string[] } }) => void) | null = null
    onerror: (() => void) | null = null
    constructor(url: URL) { made.push(String(url)) }
    postMessage(request: { events: NostrEvent[] }): void {
      setTimeout(() => {
        if (fail) { this.onerror?.(); return }
        this.onmessage?.({ data: { bad: request.events.filter((e) => !verifyEvent({ ...e } as VerifiedEvent)).map((e) => e.id) } })
      }, 0)
    }
    terminate(): void {}
  }
}

describe('checking signatures off the main thread', () => {
  const events = [signed(1), spoiled(signed(2)), signed(3), spoiled(signed(4))]
  const bad = [events[1].id, events[3].id]

  it('uses the sig worker where there is one', async () => {
    const made: string[] = []
    ;(globalThis as { Worker?: unknown }).Worker = fakeWorker(made)
    expect([...await checkSignatures(events)].sort()).toEqual(bad.sort())
    expect(made).toHaveLength(1)
    expect(made[0]).toMatch(/workers\/sig\.worker\.ts$/)
  })

  it('falls back to the main thread when the worker fails, with the same answer', async () => {
    const made: string[] = []
    ;(globalThis as { Worker?: unknown }).Worker = fakeWorker(made, true)
    expect([...await checkSignatures(events)].sort()).toEqual(bad.sort())
    expect(made).toHaveLength(1)
  })

  it('checks in chunks, after yielding, where there is no Worker: nothing is checked during the call itself', async () => {
    ;(globalThis as { Worker?: unknown }).Worker = undefined
    const many = Array.from({ length: 60 }, (_, i) => (i === 41 ? spoiled(signed(100 + i)) : signed(100 + i)))
    const pending = checkSignatures(many)
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect([...await pending]).toEqual([many[41].id])
  })

  it('asks nothing for nothing', async () => {
    expect((await checkSignatures([])).size).toBe(0)
  })
})
