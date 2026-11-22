/**
 * idbPaged.test.ts: a paged read of a bounded stretch that holds an exact
 * multiple of the page reads every row and ends, rather than asking for the
 * empty range after the top key, which IndexedDB refuses (DataError): the
 * hyperspace cache replay stopped there and never read the stretches after.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { getRangePaged, openDatabase, putMany } from '../idb'

describe('getRangePaged', () => {
  it('a stretch of exactly two pages is read whole, with no error', async () => {
    const db = await openDatabase('onosendai:test-paged', 1, [['rows', 'height']])
    await putMany(db, 'rows', Array.from({ length: 20 }, (_, i) => ({ height: i })))
    const seen: number[] = []
    await getRangePaged<{ height: number }>(db, 'rows', 5, 14, 5, (r) => r.height, (rows) => { for (const r of rows) seen.push(r.height) })
    expect(seen).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    // Open above, as the tail is read.
    const tail: number[] = []
    await getRangePaged<{ height: number }>(db, 'rows', 10, null, 5, (r) => r.height, (rows) => { for (const r of rows) tail.push(r.height) })
    expect(tail).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
    db.close()
  })
})
