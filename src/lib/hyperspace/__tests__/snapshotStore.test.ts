/**
 * The stop index's snapshot leaves the main thread: slices, then a worker
 * (snapshotStore). Written here it blocked for 0.4 to 4 s. What is stored must
 * stay exactly what serializeIndex would have stored.
 */
import fs from 'node:fs'
import path from 'node:path'
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { SLICE_BYTES, copySliced, getSnapshot, putSnapshot } from '../snapshotStore'
import { SNAPSHOT_KEY, buffersOfRecord, type SnapshotRecord } from '../snapshotRecord'
import { adoptSnapshot, appendStops, createStopIndex, mergeAll, serializeIndex, serializeIndexSliced } from '../compactIndex'
import { getMeta, openDb } from '../idb'
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
const bytes = (b: ArrayBuffer): number[] => [...new Uint8Array(b)]

describe('copying a column in slices', () => {
  it('copies every byte', async () => {
    const column = Uint8Array.from({ length: 1000 }, (_, i) => i % 251)
    expect(bytes(await copySliced(column, 960, 32, async () => {}))).toEqual([...column.subarray(0, 960)])
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
    for (const k of ['keys', 'coords', 'merkles', 'hashes', 'kinds', 'heights', 'perm'] as const) expect(bytes(sliced[k])).toEqual(bytes(whole[k]))
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
    const stored = await getMeta(database, SNAPSHOT_KEY) as SnapshotRecord
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
