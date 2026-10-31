/**
 * The stop index's snapshot leaves the main thread: slices, then a worker
 * (snapshotStore). Written here it blocked for 0.4 to 4 s. What is stored must
 * stay exactly what serializeIndex would have stored.
 */
import fs from 'node:fs'
import path from 'node:path'
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { READ_WAIT_MS, READY_WAIT_MS, SLICE_BYTES, SNAPSHOT_GIVE_UP_AFTER, SNAPSHOT_MIN_GROWTH, bootSnapshotDue, copySliced, getSnapshot, putSnapshot, tailSnapshotDue } from '../snapshotStore'
import { MAX_PUT_BYTES, SNAPSHOT_COLUMNS, SNAPSHOT_KEY, buffersOfRecord, readSnapshotRecord, type SnapshotRecord } from '../snapshotRecord'
import { ADOPTED_GROW_ROWS, adoptSnapshot, appendStops, createStopIndex, insertRow, mergeAll, serializeIndex, serializeIndexSliced } from '../compactIndex'
import { getMeta, openDb, putMeta } from '../idb'
import type { Stop } from '../stops'

const hex = (n: number): string => n.toString(16).padStart(64, '0')
function stop(height: number, salt = 0): Stop {
  return { height, kind: height % 2 ? 'port' : 'landfall', coordApprox: BigInt(height * 977 + 13 + salt), merkleRoot: hex(height + 1 + salt), blockHash: height % 3 ? hex(height + 7) : null } as unknown as Stop
}
function indexOf(n: number, salt = 0): ReturnType<typeof createStopIndex> {
  const index = createStopIndex()
  appendStops(index, Array.from({ length: n }, (_, i) => stop(i, salt)))
  mergeAll(index)
  return index
}
const bytes_ = (b: ArrayBuffer): number[] => [...new Uint8Array(b)]
/** Clear what an earlier test stored. */
const deleteMeta = (database: IDBDatabase): Promise<void> => new Promise((resolve, reject) => {
  const tx = database.transaction('meta', 'readwrite')
  tx.objectStore('meta').clear()
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
})

describe('copying a column in slices', () => {
  it('copies every byte', async () => {
    const column = Uint8Array.from({ length: 1000 }, (_, i) => i % 251)
    expect(bytes_(await copySliced(column, 960, 32, async () => {}))).toEqual([...column.subarray(0, 960)])
  })

  it('never holds the thread for more than a slice, and ends a slice on a row', async () => {
    const rowBytes = 32
    const size = SLICE_BYTES * 3 + rowBytes * 5
    const column = new Uint8Array(size)
    let pauses = 0
    const spans: number[] = []
    const set = Uint8Array.prototype.set
    Uint8Array.prototype.set = function (this: Uint8Array, a: ArrayLike<number>, o?: number) { spans.push(a.length); return set.call(this, a, o) }
    try {
      await copySliced(column, size, rowBytes, async () => { pauses++ })
    } finally { Uint8Array.prototype.set = set }
    expect(pauses).toBe(3)
    expect(Math.max(...spans)).toBeLessThanOrEqual(SLICE_BYTES)
    for (const s of spans) expect(s % rowBytes).toBe(0)
  })
})

describe('the sliced snapshot', () => {
  it('is byte for byte what serializeIndex gives, and adopts', async () => {
    const index = indexOf(500)
    const whole = serializeIndex(index)!
    const sliced = (await serializeIndexSliced(index, (c, n, r) => copySliced(c, n, r, async () => {})))!
    for (const k of ['keys', 'coords', 'merkles', 'hashes', 'kinds', 'heights', 'perm'] as const) expect(bytes_(sliced[k])).toEqual(bytes_(whole[k]))
    expect(sliced.count).toBe(whole.count)
    expect(sliced.maxHeight).toBe(whole.maxHeight)
    const back = createStopIndex()
    expect(adoptSnapshot(back, sliced)).toBe(true)
    expect(back.size).toBe(500)
  })

  it('refuses a half-merged index, as serializeIndex does', async () => {
    const index = createStopIndex()
    appendStops(index, [stop(1), stop(2)])
    expect(await serializeIndexSliced(index, (c, n, r) => copySliced(c, n, r, async () => {}))).toBeNull()
  })

  it('rows that land during the copy stay out, and what was taken still adopts', async () => {
    const index = indexOf(100)
    const taken = serializeIndexSliced(index, async (c, n, r) => {
      // A landing mid-copy: the columns may grow and the sort moves in place.
      appendStops(index, [stop(100 + index.size)])
      mergeAll(index)
      return copySliced(c, n, r, async () => {})
    })
    const s = (await taken)!
    expect(s.count).toBe(100)
    expect(s.maxHeight).toBe(99)
    expect(index.size).toBeGreaterThan(100)
    expect(adoptSnapshot(createStopIndex(), s)).toBe(true)
  })
})

/** A worker that says it is ready, then answers each call as told. */
function fakeWorker(answer: (request: { op: string }, transfer: Transferable[]) => object | null, opened: object = { ok: true, ready: true }): Worker & { transferred: Transferable[]; terminated: number } {
  const w = {
    onmessage: null as ((e: MessageEvent) => void) | null, onerror: null, transferred: [] as Transferable[], terminated: 0,
    terminate() { w.terminated++ },
    postMessage(request: { op: string }, transfer: Transferable[] = []) {
      w.transferred.push(...transfer)
      const reply = request.op === 'open' ? opened : answer(request, transfer)
      if (reply) queueMicrotask(() => w.onmessage?.({ data: reply } as MessageEvent))
    },
  }
  return w as unknown as Worker & { transferred: Transferable[]; terminated: number }
}

describe('the store', () => {
  const record = (): SnapshotRecord => ({ snapshot: serializeIndex(indexOf(8))!, coveredAtSnapshot: [[0, 7]] })

  it('hands a worker the buffers rather than copying them, once it is ready, and terminates it', async () => {
    const database = await openDb()
    const r = record()
    const count = buffersOfRecord(r).length
    expect(count).toBe(7)
    const worker = fakeWorker(() => ({ ok: true }))
    await putSnapshot(database, r, () => worker)
    expect(worker.transferred.length).toBe(count)
    expect(worker.terminated).toBe(1)
    database.close()
  })

  it('with no worker to be had, stores it here', async () => {
    const database = await openDb()
    await putSnapshot(database, record(), () => null)
    const stored = await readSnapshotRecord(database) as SnapshotRecord
    expect(stored.snapshot.count).toBe(8)
    expect((await getSnapshot(database, () => null) as SnapshotRecord).coveredAtSnapshot).toEqual([[0, 7]])
    database.close()
  })

  it('a worker that cannot open the database hands nothing over, and this thread stores it (review of #566)', async () => {
    const database = await openDb()
    await deleteMeta(database)
    const worker = fakeWorker(() => null, { ok: false, error: 'UnknownError: no' })
    await putSnapshot(database, record(), () => worker)
    expect(worker.transferred).toEqual([])
    expect(worker.terminated).toBe(1)
    expect((await readSnapshotRecord(database) as SnapshotRecord).snapshot.count).toBe(8)
    database.close()
  })

  it('a worker that fails to load hands nothing over, and this thread stores it', async () => {
    const database = await openDb()
    await deleteMeta(database)
    const worker = fakeWorker(() => null, undefined as unknown as object)
    worker.postMessage = function () { queueMicrotask(() => (worker.onerror as unknown as (e: { message: string }) => void)?.({ message: '404' })) } as never
    await putSnapshot(database, record(), () => worker)
    expect((await readSnapshotRecord(database) as SnapshotRecord).snapshot.count).toBe(8)
    database.close()
  })

  it('a write that fails in the worker says why, so it is not silent', async () => {
    const database = await openDb()
    const worker = fakeWorker(() => ({ ok: false, error: 'UnknownError: too large' }))
    await expect(putSnapshot(database, record(), () => worker)).rejects.toThrow('UnknownError: too large')
    database.close()
  })

  it('a worker that fails to read falls back to this thread', async () => {
    const database = await openDb()
    await putSnapshot(database, record(), () => null)
    const worker = fakeWorker(() => ({ ok: false, error: 'no' }))
    expect((await getSnapshot(database, () => worker) as SnapshotRecord).snapshot.count).toBe(8)
    database.close()
  })
})

describe('when to write', () => {
  const MIN = SNAPSHOT_MIN_GROWTH
  it('a boot writes with nothing stored, or grown enough, and not for one new row (review of #566)', () => {
    expect(bootSnapshotDue(970_000, 0, 0)).toBe(true)
    expect(bootSnapshotDue(970_001, 970_000, 0)).toBe(false)
    expect(bootSnapshotDue(970_000 + MIN, 970_000, 0)).toBe(true)
    expect(bootSnapshotDue(0, 0, 0)).toBe(false)
  })
  it('a long tab waits longer after each failure, and stops for the session after three', () => {
    const ten = 10 * 60_000
    const due = (elapsed: number, failures: number): boolean => tailSnapshotDue(elapsed, 0, 970_000, 0, failures)
    expect(due(ten, 0)).toBe(true)
    expect(due(ten, 1)).toBe(false)
    expect(due(2 * ten, 1)).toBe(true)
    expect(due(2 * ten, 2)).toBe(false)
    expect(due(4 * ten, 2)).toBe(true)
    expect(due(1000 * ten, SNAPSHOT_GIVE_UP_AFTER)).toBe(false)
    expect(bootSnapshotDue(970_000, 0, SNAPSHOT_GIVE_UP_AFTER)).toBe(false)
  })
  it('needs growth as well as time', () => {
    expect(tailSnapshotDue(10 * 60_000, 0, 970_000 + MIN - 1, 970_000, 0)).toBe(false)
  })
})

describe('an adopted index in memory (review of #566)', () => {
  it('one new row grows it by a small step, not double', () => {
    const n = 200_000
    const back = createStopIndex()
    expect(adoptSnapshot(back, serializeIndex(indexOf(n))!)).toBe(true)
    appendStops(back, [stop(n)])
    expect(back.capacity).toBe(n + ADOPTED_GROW_ROWS)
    expect(back.keys.length).toBe((n + ADOPTED_GROW_ROWS) * 32)
    mergeAll(back)
    insertRow(back, stop(n + 1))
    expect(back.byHeight.length).toBeLessThanOrEqual(n + 1 + ADOPTED_GROW_ROWS)
    expect(back.perm.length).toBeLessThanOrEqual(n + 2 + ADOPTED_GROW_ROWS)
  })
  it('an index being built still doubles: a cold sync must not copy the columns at every batch', () => {
    const i = createStopIndex()
    appendStops(i, Array.from({ length: 70_000 }, (_, h) => stop(h)))
    appendStops(i, [stop(70_000)])
    expect(i.capacity).toBeGreaterThanOrEqual(70_000)
    expect(i.growStep).toBe(0)
  })
  it('refuses a sorted view that does not sort its keys', () => {
    const s = serializeIndex(indexOf(50))!
    const perm = new Uint32Array(s.perm)
    const t = perm[10]; perm[10] = perm[40]; perm[40] = t
    expect(adoptSnapshot(createStopIndex(), s)).toBe(false)
  })
})

describe('what fits in a put (Chromium refused the whole record past about 972,000 rows)', () => {
  const ROW = 32 * 4 + 1 + 4 + 4
  const bytes: Record<(typeof SNAPSHOT_COLUMNS)[number], number> = { keys: 32, coords: 32, merkles: 32, hashes: 32, kinds: 1, heights: 4, perm: 4 }

  it('the whole record is past the limit at the line\'s size today, so it cannot go in one put', () => {
    expect(ROW * 972_100).toBeGreaterThan(MAX_PUT_BYTES)
  })

  it('every column fits at four million rows', () => {
    for (const name of SNAPSHOT_COLUMNS) expect(bytes[name] * 4_000_000).toBeLessThan(MAX_PUT_BYTES)
  })

  it('no record larger than a column is written: a put never carries two', async () => {
    const database = await openDb()
    const r = { snapshot: serializeIndex(indexOf(8))!, coveredAtSnapshot: [[0, 7]] as Array<[number, number]> }
    await putSnapshot(database, r, () => null)
    const head = await getMeta(database, SNAPSHOT_KEY) as Record<string, unknown>
    expect(buffersOfRecord({ snapshot: head })).toEqual([])
    expect(head.split).toBe(1)
    for (const name of SNAPSHOT_COLUMNS) expect(await getMeta(database, `${SNAPSHOT_KEY}:${name}`)).toBeInstanceOf(ArrayBuffer)
    database.close()
  })

  it('comes back as it went in, and adopts', async () => {
    const database = await openDb()
    const source = serializeIndex(indexOf(300))!
    const expected = Object.fromEntries(SNAPSHOT_COLUMNS.map((c) => [c, bytes_(source[c])]))
    await putSnapshot(database, { snapshot: source, coveredAtSnapshot: [[0, 299]] }, () => null)
    const back = await getSnapshot(database, () => null) as SnapshotRecord
    for (const c of SNAPSHOT_COLUMNS) expect(bytes_(back.snapshot[c])).toEqual(expected[c])
    expect(back.coveredAtSnapshot).toEqual([[0, 299]])
    const index = createStopIndex()
    expect(adoptSnapshot(index, back.snapshot)).toBe(true)
    expect(index.size).toBe(300)
    database.close()
  })

  it('a record from before this, whole under one key, is still read and adopts', async () => {
    const database = await openDb()
    // Written over by the columns' header above, so this stands in the old way.
    await putMeta(database, SNAPSHOT_KEY, { snapshot: serializeIndex(indexOf(40))!, coveredAtSnapshot: [[0, 39]] })
    const back = await getSnapshot(database, () => null) as SnapshotRecord
    expect(back.snapshot.count).toBe(40)
    expect(adoptSnapshot(createStopIndex(), back.snapshot)).toBe(true)
    database.close()
  })

  it('a write that cannot land stores none of itself: every column stays the last good one (review of #566)', async () => {
    const database = await openDb()
    const good = serializeIndex(indexOf(8))!
    const expected = Object.fromEntries(SNAPSHOT_COLUMNS.map((c) => [c, bytes_(good[c])]))
    await putSnapshot(database, { snapshot: good, coveredAtSnapshot: [[0, 7]] }, () => null)
    // Same row count, other content; a later column that cannot be cloned, with earlier ones already queued.
    const bad = { ...serializeIndex(indexOf(8, 1000))!, merkles: (() => {}) as unknown as ArrayBuffer }
    await expect(putSnapshot(database, { snapshot: bad, coveredAtSnapshot: [[0, 7]] }, () => null)).rejects.toBeDefined()
    await new Promise((r) => setTimeout(r, 20))
    const after = await getSnapshot(database, () => null) as SnapshotRecord
    for (const c of SNAPSHOT_COLUMNS) expect(bytes_(after.snapshot[c])).toEqual(expected[c])
    expect(after.coveredAtSnapshot).toEqual([[0, 7]])
    database.close()
  })
})

describe('a worker that never answers', () => {
  it('cannot hold up the boot: the read falls back to this thread, and the worker goes', async () => {
    const database = await openDb()
    await putSnapshot(database, { snapshot: serializeIndex(indexOf(8))!, coveredAtSnapshot: [[0, 7]] }, () => null)
    const silent = fakeWorker(() => null)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const read = getSnapshot(database, () => silent)
      await vi.advanceTimersByTimeAsync(READ_WAIT_MS + 1)
      vi.useRealTimers()
      expect((await read as SnapshotRecord).snapshot.count).toBe(8)
      expect(silent.terminated).toBe(1)
    } finally {
      vi.useRealTimers()
      database.close()
    }
  })

  it('one that never says it is ready keeps nothing: the buffers are still here to store', async () => {
    const database = await openDb()
    await deleteMeta(database)
    const mute = fakeWorker(() => null, undefined as unknown as object)
    mute.postMessage = function () {} as never
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const put = putSnapshot(database, { snapshot: serializeIndex(indexOf(8))!, coveredAtSnapshot: [[0, 7]] }, () => mute)
      await vi.advanceTimersByTimeAsync(READY_WAIT_MS + 1)
      vi.useRealTimers()
      await put
      expect((await readSnapshotRecord(database) as SnapshotRecord).snapshot.count).toBe(8)
    } finally {
      vi.useRealTimers()
      database.close()
    }
  })
})

describe('anchors uses it', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../anchors.ts'), 'utf8')
  it('no longer stores the snapshot on this thread directly', () => {
    expect(text).not.toMatch(/putMeta\([^)]*SNAPSHOT_KEY/)
    expect(text).not.toMatch(/getMeta\([^)]*SNAPSHOT_KEY/)
    expect(text).toMatch(/putSnapshot\(database,/)
    expect(text).toMatch(/getSnapshot\(db\)/)
  })
  it('says why when a write fails, and starts the tail before writing', () => {
    expect(text).toMatch(/console\.warn\(`\[hyperspace\] the stop index was not stored/)
    expect(text.indexOf('startTail(cb)\n  // Persist')).toBeGreaterThan(0)
    expect(text).toMatch(/if \(bootSnapshotDue\(anchorIndex\.size, snapshotSize, snapshotFailures\)\) void persistSnapshot\(\)/)
    expect(text).toMatch(/if \(tailSnapshotDue\(Date\.now\(\), snapshotAt, anchorIndex\.size, snapshotSize, snapshotFailures\)\)/)
  })
  it('takes the covered heights in the tick the row count is taken', () => {
    expect(text).toMatch(/const coveredAtSnapshot = effectiveCovered\(\)\n\s*const snapshot = await serializeIndexSliced\(anchorIndex, copySliced\)/)
  })
})
