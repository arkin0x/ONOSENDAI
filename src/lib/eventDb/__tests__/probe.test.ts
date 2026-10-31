/**
 * probe.test.ts - the store is tried on a throwaway database before anyone's
 * chain goes near it, and an engine that gets any of it wrong is told apart.
 * The engine faults are made here by bending what fake-indexeddb is given.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROBE_DB, probeStore } from '../probe'
import { EVENT_DB } from '../schema'

/** Run with one prototype method bent, and put it back. */
async function bent<T>(proto: object, name: string, fn: (real: (...a: unknown[]) => unknown) => (this: unknown, ...a: unknown[]) => unknown, run: () => Promise<T>): Promise<T> {
  const p = proto as Record<string, (...a: unknown[]) => unknown>
  const real = p[name]
  p[name] = fn(real)
  try { return await run() } finally { p[name] = real }
}

beforeEach(() => {
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('the store probe', () => {
  it('passes where the store works, and leaves no database behind, the real one included', async () => {
    expect(await probeStore()).toBe(true)
    const names = (await indexedDB.databases()).map((d) => d.name)
    expect(names).not.toContain(PROBE_DB)
    expect(names).not.toContain(EVENT_DB)
  })

  it('fails where a put throws', async () => {
    const r = await bent(IDBObjectStore.prototype, 'put', () => function () { throw new DOMException('no', 'DataError') }, probeStore)
    expect(r).toBe(false)
  })

  it('fails where nested keys silently do not index: the rows are there and nothing finds them', async () => {
    const r = await bent(IDBIndex.prototype, 'openCursor', (real) => function (this: unknown, range, dir) {
      const name = (this as IDBIndex).name
      return real.call(this, name === 'byTag' ? IDBKeyRange.only(['nothing', 0]) : range, dir)
    }, probeStore)
    expect(r).toBe(false)
  })

  it('fails where an abort leaves the row behind', async () => {
    const r = await bent(IDBTransaction.prototype, 'abort', () => function () { /* an engine that ignores it */ }, probeStore)
    expect(r).toBe(false)
  })

  it('fails where a duplicate address is taken', async () => {
    const r = await bent(IDBObjectStore.prototype, 'createIndex', (real) => function (this: unknown, name, key, opts) { return real.call(this, name, key, name === 'byAddr' ? { ...(opts as object), unique: false } : opts) }, probeStore)
    expect(r).toBe(false)
  })

  it('reopens before it passes: rows only in a connection\'s memory do not count', async () => {
    const proto = IDBFactory.prototype as unknown as { open: (...a: unknown[]) => unknown }
    const real = proto.open
    const opened: unknown[] = []
    proto.open = function (this: unknown, ...a: unknown[]) { opened.push(a[0]); return real.apply(this, a) }
    try { expect(await probeStore()).toBe(true) } finally { proto.open = real }
    expect(opened.filter((n) => n === PROBE_DB)).toHaveLength(2)
  })

  it('fails where nested arrays do not work as multi-entry keys', async () => {
    const r = await bent(IDBObjectStore.prototype, 'createIndex', (real) => function (this: unknown, name, key, opts) { return real.call(this, name, key, name === 'byTag' ? { ...(opts as object), multiEntry: false } : opts) }, probeStore)
    expect(r).toBe(false)
  })

  it('fails where a reverse range misreads compound keys', async () => {
    const r = await bent(IDBIndex.prototype, 'openCursor', (real) => function (this: unknown, range) { return real.call(this, range, 'next') }, probeStore)
    expect(r).toBe(false)
  })

  it('fails where a unique index is not held', async () => {
    const r = await bent(IDBObjectStore.prototype, 'createIndex', (real) => function (this: unknown, name, key, opts) { return real.call(this, name === 'byAddr' ? 'byAddr' : name, name === 'byAddr' ? 'nothing' : key, opts) }, probeStore)
    expect(r).toBe(false)
  })

  it('fails where compound store keys are not held', async () => {
    const r = await bent(IDBDatabase.prototype, 'createObjectStore', (real) => function (this: unknown, name, opts) { return real.call(this, name, name === 'parted' ? { keyPath: 'pubkey' } : opts) }, probeStore)
    expect(r).toBe(false)
  })

  it('fails, and does not throw, where nothing can be opened', async () => {
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new DOMException('no', 'InvalidStateError') }, deleteDatabase: () => { throw new DOMException('no', 'InvalidStateError') } }
    expect(await probeStore()).toBe(false)
  })

  it('a database left by an earlier probe does not count against this one', async () => {
    await new Promise<void>((resolve) => { const r = indexedDB.open(PROBE_DB, 9); r.onupgradeneeded = () => r.result.createObjectStore('old'); r.onsuccess = () => { r.result.close(); resolve() } })
    expect(await probeStore()).toBe(true)
  })
})
