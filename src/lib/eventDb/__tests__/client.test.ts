/**
 * client.test.ts - a call reaches the database through the worker, and a
 * worker that is missing, fails or goes quiet costs nothing: the same code
 * runs on the main thread, and nothing asked is lost. Fake workers and
 * fake-indexeddb only.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../events'
import { answer, type EventDbRequest, type EventDbResponse } from '../ops'
import { closeEventDb } from '../connection'

const sk = generateSecretKey()
const event = (n: number): NostrEvent => finalizeEvent({ kind: 7, created_at: 1000 + n, tags: [], content: '' }, sk) as NostrEvent

/** A worker that answers with the real ops, or stays quiet, or fails, as a test says. */
class FakeWorker {
  static made: FakeWorker[] = []
  static behaviour: 'answer' | 'quiet' | 'fail' | 'throw' = 'answer'
  onmessage: ((m: MessageEvent<EventDbResponse>) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  got: EventDbRequest[] = []
  constructor() {
    if (FakeWorker.behaviour === 'throw') throw new Error('no worker here')
    FakeWorker.made.push(this)
  }
  postMessage(request: EventDbRequest): void {
    this.got.push(request)
    if (FakeWorker.behaviour === 'answer') void answer(request).then((r) => this.onmessage?.({ data: r } as MessageEvent<EventDbResponse>))
    if (FakeWorker.behaviour === 'fail') setTimeout(() => this.onerror?.(), 0)
  }
  terminate(): void { this.terminated = true }
}

async function freshClient() {
  vi.resetModules()
  return import('../client')
}

beforeEach(() => {
  closeEventDb()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  FakeWorker.made = []
  FakeWorker.behaviour = 'answer'
  vi.stubGlobal('Worker', FakeWorker)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('the client', () => {
  it('goes through the worker when there is one', async () => {
    const c = await freshClient()
    const e = event(1)
    expect((await c.callEventDb('ingest', ['tab', [{ event: e, nip01: 1 }]])).added).toEqual([e.id])
    expect(FakeWorker.made).toHaveLength(1)
    expect(FakeWorker.made[0].got[0].op).toBe('ingest')
    expect((await c.callEventDb('byKind', [7])).map((x) => x.id)).toEqual([e.id])
  })

  it('runs on the main thread when no worker can start', async () => {
    FakeWorker.behaviour = 'throw'
    const c = await freshClient()
    const e = event(2)
    expect((await c.callEventDb('ingest', ['tab', [{ event: e, nip01: 1 }]])).added).toEqual([e.id])
    expect(FakeWorker.made).toHaveLength(0)
  })

  it('runs on the main thread when there is no Worker at all', async () => {
    vi.unstubAllGlobals()
    const c = await freshClient()
    const e = event(3)
    expect((await c.callEventDb('ingest', ['tab', [{ event: e, nip01: 1 }]])).added).toEqual([e.id])
  })

  it('a worker that fails is given up, and what it had not answered runs here, in order', async () => {
    FakeWorker.behaviour = 'fail'
    const c = await freshClient()
    const [a, b] = [event(4), event(5)]
    const [ra, rb] = await Promise.all([
      c.callEventDb('ingest', ['tab', [{ event: a, nip01: 1 }]]),
      c.callEventDb('ingest', ['tab', [{ event: b, nip01: 1 }]]),
    ])
    expect(ra.added).toEqual([a.id])
    expect(rb.added).toEqual([b.id])
    expect(FakeWorker.made[0].terminated).toBe(true)
    // And the worker is not asked again.
    expect((await c.callEventDb('byKind', [7])).length).toBeGreaterThanOrEqual(2)
    expect(FakeWorker.made).toHaveLength(1)
  })

  it('a worker that goes quiet is given up once its patience runs out', async () => {
    FakeWorker.behaviour = 'quiet'
    const c = await freshClient()
    const e = event(6)
    expect((await c.callEventDb('ingest', ['tab', [{ event: e, nip01: 1 }]], 5)).added).toEqual([e.id])
    expect(FakeWorker.made[0].terminated).toBe(true)
  })

  it('a call that fails says by what, by name, so a full disk can be told from the rest', async () => {
    // No worker: the fresh client's own copy of the ops, with no connection open yet.
    FakeWorker.behaviour = 'throw'
    const c = await freshClient()
    const realDb = (globalThis as { indexedDB?: IDBFactory }).indexedDB
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new DOMException('full', 'QuotaExceededError') } }
    await expect(c.callEventDb('budget', [])).rejects.toMatchObject({ name: 'QuotaExceededError' })
    ;(globalThis as { indexedDB?: unknown }).indexedDB = realDb
  })
})

describe('notes', () => {
  it('another tab hears a write after it committed; the tab that wrote does not hear its own', async () => {
    const c = await freshClient()
    const heardHere: unknown[] = []
    const stop = c.onOtherTab((n) => heardHere.push(n))
    const others: unknown[] = []
    const other = new BroadcastChannel('onosendai:events')
    other.onmessage = (m) => others.push(m.data)
    const e = event(7)
    await c.callEventDb('ingest', [c.TAB_ID, [{ event: e, nip01: 1 }]])
    await vi.waitFor(() => expect(others).toEqual([{ kind: 'events', by: c.TAB_ID, ids: [e.id] }]))
    expect(heardHere).toEqual([])
    stop()
    other.close()
  })

  it('a note names only the rows that are new', async () => {
    const c = await freshClient()
    const others: unknown[] = []
    const other = new BroadcastChannel('onosendai:events')
    other.onmessage = (m) => others.push(m.data)
    const e = event(8)
    await c.callEventDb('ingest', [c.TAB_ID, [{ event: e, nip01: 1 }]])
    await vi.waitFor(() => expect(others).toHaveLength(1))
    await c.callEventDb('ingest', [c.TAB_ID, [{ event: e, nip01: 1, relay: 'wss://again/' }]])
    await new Promise((r) => setTimeout(r, 20))
    expect(others).toHaveLength(1)
    other.close()
  })
})
