/**
 * The stop index's snapshot leaves the main thread: slices, then a worker
 * (snapshotStore). Written here it blocked for 0.4 to 4 s. What is stored must
 * stay exactly what serializeIndex would have stored.
 */
import fs from 'node:fs'
import path from 'node:path'
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { READ_WAIT_MS, SLICE_BYTES, copySliced, getSnapshot, putSnapshot } from '../snapshotStore'
import { MAX_PUT_BYTES, SNAPSHOT_COLUMNS, SNAPSHOT_KEY, buffersOfRecord, readSnapshotRecord, type SnapshotRecord } from '../snapshotRecord'
import { adoptSnapshot, appendStops, createStopIndex, mergeAll, serializeIndex, serializeIndexSliced } from '../compactIndex'
import { getMeta, openDb, putMeta } from '../idb'
import type { Stop } from '../stops'

const hex = (n: number): string => n.toString(16).padStart(64, '0')
function stop(height: number): Stop {
  return { height, kind: height % 2 ? 'port' : 'landfall', coordApprox: BigInt(height * 977 + 13), merkleRoot: hex(height + 1), blockHash: height % 3 ? hex(height + 7) : null } as unknown as Stop
}
function indexOf(n: number): ReturnType<typeof createStopIndex> {
  const index = createStopIndex()
  appendStops(index, Array.from({ length: n }, (_, i) => stop(i)))
  mergeAll(index)
  return index
}
const bytes_ = (b: ArrayBuffer): number[] => [...new Uint8Array(b)]

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

describe('the store', () => {
  const record = (): SnapshotRecord => ({ snapshot: serializeIndex(indexOf(8))!, coveredAtSnapshot: [[0, 7]] })

  it('hands a worker the buffers rather than copying them, and terminates it', async () => {
    const database = await openDb()
    let transferred: Transferable[] = []
    let terminated = 0
    const r = record()
    const count = buffersOfRecord(r).length
    expect(count).toBe(7)
    const worker = { onmessage: null as ((e: MessageEvent) => void) | null, onerror: null, terminate: () => { terminated++ }, postMessage(_: unknown, t: Transferable[]) { transferred = t; queueMicrotask(() => this.onmessage!({ data: { ok: true } } as MessageEvent)) } }
    await putSnapshot(database, r, () => worker as unknown as Worker)
    expect(transferred.length).toBe(count)
    expect(terminated).toBe(1)
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

  it('a worker that fails to read falls back to this thread', async () => {
    const database = await openDb()
    await putSnapshot(database, record(), () => null)
    const worker = { onmessage: null as ((e: MessageEvent) => void) | null, onerror: null, terminate: () => {}, postMessage() { queueMicrotask(() => this.onmessage!({ data: { ok: false } } as MessageEvent)) } }
    expect((await getSnapshot(database, () => worker as unknown as Worker) as SnapshotRecord).snapshot.count).toBe(8)
    database.close()
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

  it('a write that cannot land stores nothing of itself, and says so', async () => {
    const database = await openDb()
    const good = { snapshot: serializeIndex(indexOf(8))!, coveredAtSnapshot: [[0, 7]] as Array<[number, number]> }
    await putSnapshot(database, good, () => null)
    // A column that cannot be cloned aborts the whole transaction.
    const bad = { snapshot: { ...serializeIndex(indexOf(9))!, hashes: (() => {}) as unknown as ArrayBuffer }, coveredAtSnapshot: [[0, 8]] as Array<[number, number]> }
    await expect(putSnapshot(database, bad, () => null)).rejects.toBeDefined()
    expect((await getSnapshot(database, () => null) as SnapshotRecord).snapshot.count).toBe(8)
    database.close()
  })
})

describe('a worker that never answers', () => {
  it('cannot hold up the boot: the read falls back to this thread, and the worker goes', async () => {
    const database = await openDb()
    await putSnapshot(database, { snapshot: serializeIndex(indexOf(8))!, coveredAtSnapshot: [[0, 7]] }, () => null)
    let terminated = 0
    const silent = { onmessage: null, onerror: null, terminate: () => { terminated++ }, postMessage() {} }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const read = getSnapshot(database, () => silent as unknown as Worker)
      await vi.advanceTimersByTimeAsync(READ_WAIT_MS)
      vi.useRealTimers()
      expect((await read as SnapshotRecord).snapshot.count).toBe(8)
      expect(terminated).toBe(1)
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
  it('takes the covered heights in the tick the row count is taken', () => {
    expect(text).toMatch(/const coveredAtSnapshot = effectiveCovered\(\)\n\s*const snapshot = await serializeIndexSliced\(anchorIndex, copySliced\)/)
  })
})
