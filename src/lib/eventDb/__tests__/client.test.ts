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

describe('a worker that answers it could not', () => {
  it('is given up, and the call runs here', async () => {
    FakeWorker.behaviour = 'quiet'
    const c = await freshClient()
    const e = event(10)
    const call = c.callEventDb('ingest', ['tab', [{ event: e, nip01: 1 }]])
    await new Promise((r) => setTimeout(r, 5))
    FakeWorker.made[0].onmessage?.({ data: { call: 1, ok: false, name: 'NotFoundError', message: 'no such store' } } as MessageEvent<EventDbResponse>)
    expect((await call).added).toEqual([e.id])
    expect(FakeWorker.made[0].terminated).toBe(true)
  })

  it('a full disk is not the worker\'s fault: it stays, and the caller hears it by name', async () => {
    FakeWorker.behaviour = 'quiet'
    const c = await freshClient()
    const call = c.callEventDb('budget', [])
    await new Promise((r) => setTimeout(r, 5))
    FakeWorker.made[0].onmessage?.({ data: { call: 1, ok: false, name: 'QuotaExceededError', message: 'full' } } as MessageEvent<EventDbResponse>)
    await expect(call).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(FakeWorker.made[0].terminated).toBe(false)
  })
})

describe('the store probe, where the database will run', () => {
  /** A worker whose probe answers as the test says. */
  const answering = (value: unknown, ok = true): void => {
    const post = FakeWorker.prototype.postMessage
    vi.spyOn(FakeWorker.prototype, 'postMessage').mockImplementation(function (this: FakeWorker, r: EventDbRequest) {
      if (r.op === 'probeStore') {
        this.got.push(r)
        setTimeout(() => this.onmessage?.({ data: ok ? { call: r.call, ok: true, value } : { call: r.call, ok: false, name: 'UnknownError', message: 'x' } } as MessageEvent<EventDbResponse>), 0)
        return
      }
      post.call(this, r)
    })
  }

  it('passes in the worker: the worker stays, and the main thread is not asked', async () => {
    answering(true)
    const c = await freshClient()
    expect(await c.probeWhereItRuns()).toBe(true)
    expect(FakeWorker.made[0].terminated).toBe(false)
  })

  it('fails in the worker and passes here: the worker is given up, and the database lives here', async () => {
    answering(false)
    const c = await freshClient()
    expect(await c.probeWhereItRuns()).toBe(true)
    expect(FakeWorker.made[0].terminated).toBe(true)
    const e = event(11)
    expect((await c.callEventDb('ingest', ['tab', [{ event: e, nip01: 1 }]])).added).toEqual([e.id])
    expect(FakeWorker.made[0].got.some((r) => r.op === 'ingest')).toBe(false)
  })

  it('a worker that answers it could not is treated the same', async () => {
    answering(null, false)
    const c = await freshClient()
    expect(await c.probeWhereItRuns()).toBe(true)
    expect(FakeWorker.made[0].terminated).toBe(true)
  })

  it('no answer from the worker in time: tried here', async () => {
    FakeWorker.behaviour = 'quiet'
    const c = await freshClient()
    expect(await c.probeWhereItRuns(50)).toBe(true)
    expect(FakeWorker.made[0].terminated).toBe(true)
  })

  it('no answer in time anywhere means it does not work', async () => {
    FakeWorker.behaviour = 'throw'
    vi.resetModules()
    vi.doMock('../ops', () => ({ answer: () => new Promise(() => {}) }))
    const c = await import('../client')
    vi.doUnmock('../ops')
    expect(await c.probeWhereItRuns(20)).toBe(false)
  })

  it('fails in both: it does not work', async () => {
    answering(false)
    const c = await freshClient()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new DOMException('no', 'InvalidStateError') }, deleteDatabase: () => { throw new DOMException('no', 'InvalidStateError') } }
    expect(await c.probeWhereItRuns()).toBe(false)
  })
})

describe('the order calls run in', () => {
  /** A fresh client over stand-in ops, whose answers the test releases one at a time. */
  async function heldClient() {
    vi.resetModules()
    const ran: number[] = []
    const release = new Map<number, () => void>()
    vi.doMock('../ops', () => ({
      answer: (r: EventDbRequest) => {
        ran.push(r.call)
        return new Promise<EventDbResponse>((resolve) => { release.set(r.call, () => resolve({ call: r.call, ok: true, value: r.call })) })
      },
    }))
    const c = await import('../client')
    vi.doUnmock('../ops')
    return { c, ran, release }
  }
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

  it('on the main thread, one at a time, in the order asked', async () => {
    vi.unstubAllGlobals()
    const { c, ran, release } = await heldClient()
    const first = c.callEventDb('budget', [])
    const second = c.callEventDb('budget', [])
    await settle()
    expect(ran).toEqual([1])
    release.get(1)!()
    await first
    await settle()
    expect(ran).toEqual([1, 2])
    release.get(2)!()
    await second
  })

  it('what a failed worker had not answered runs here oldest first, one at a time', async () => {
    FakeWorker.behaviour = 'quiet'
    const { c, ran, release } = await heldClient()
    const first = c.callEventDb('budget', [])
    const second = c.callEventDb('budget', [])
    await settle()
    expect(ran).toEqual([])
    FakeWorker.made[0].onerror?.()
    await settle()
    expect(ran).toEqual([1])
    release.get(1)!()
    await first
    await settle()
    expect(ran).toEqual([1, 2])
    release.get(2)!()
    await second
  })

  it('a worker answering is a worker alive: a long queue is not given up while answers come', async () => {
    vi.useFakeTimers()
    try {
      FakeWorker.behaviour = 'quiet'
      const { c } = await heldClient()
      const first = c.callEventDb('budget', [], 100)
      const second = c.callEventDb('budget', [], 100)
      const w = FakeWorker.made[0]
      await vi.advanceTimersByTimeAsync(80)
      w.onmessage?.({ data: { call: 1, ok: true, value: 1 } } as MessageEvent<EventDbResponse>)
      await first
      await vi.advanceTimersByTimeAsync(80)
      expect(w.terminated).toBe(false)
      w.onmessage?.({ data: { call: 2, ok: true, value: 2 } } as MessageEvent<EventDbResponse>)
      expect(await second).toBe(2)
      expect(w.terminated).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('a worker that stops answering is still given up', async () => {
    vi.useFakeTimers()
    try {
      FakeWorker.behaviour = 'quiet'
      const { c, release } = await heldClient()
      const first = c.callEventDb('budget', [], 100)
      const second = c.callEventDb('budget', [], 100)
      const w = FakeWorker.made[0]
      w.onmessage?.({ data: { call: 1, ok: true, value: 1 } } as MessageEvent<EventDbResponse>)
      await first
      await vi.advanceTimersByTimeAsync(150)
      expect(w.terminated).toBe(true)
      release.get(2)!()
      expect(await second).toBe(2)
    } finally { vi.useRealTimers() }
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
    await vi.waitFor(() => expect(others).toEqual([{ kind: 'events', by: c.TAB_ID, ids: [e.id], struck: [] }]))
    expect(heardHere).toEqual([])
    stop()
    other.close()
  })

  it('a note says what a deletion struck', async () => {
    const c = await freshClient()
    const others: unknown[] = []
    const other = new BroadcastChannel('onosendai:events')
    other.onmessage = (m) => others.push(m.data)
    const e = event(9)
    const del = finalizeEvent({ kind: 5, created_at: 2000, tags: [['e', e.id]], content: '' }, sk) as NostrEvent
    await c.callEventDb('ingest', [c.TAB_ID, [{ event: e, nip01: 1 }]])
    await c.callEventDb('ingest', [c.TAB_ID, [{ event: del, nip01: 1 }]])
    await vi.waitFor(() => expect(others).toHaveLength(2))
    expect(others[1]).toEqual({ kind: 'events', by: c.TAB_ID, ids: [del.id], struck: [e.id] })
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
