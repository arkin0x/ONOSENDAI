/**
 * taskStats.test.ts: the diagnostics name the work after an IndexedDB answer
 * by its database and store, and the work after a yielded task by what
 * yielded (owner's phone diag of 2026-11-22: "an IndexedDB answer" of 229 to
 * 270 ms while walking, with nothing to say whose).
 */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { countTasks, idbLabel } from '../taskStats'
import { openDatabase, request } from '../idb'
import { yieldTask } from '../hopStage'
import { taskRow } from '../diagCore'

const nextTask = () => new Promise((r) => setTimeout(r, 5))

afterEach(async () => { await nextTask() })

describe('labelled tasks', () => {
  it('a read is told by its database and store, and the time includes what its awaiter ran', async () => {
    const db = await openDatabase('onosendai:test-tasks', 1, [['things', 'key', [{ name: 'byAt', keyPath: 'at' }]]])
    const tasks = countTasks()
    tasks.take()
    const store = db.transaction('things', 'readwrite').objectStore('things')
    await request(store.put({ key: 'a', at: 1 }))
    await request(db.transaction('things', 'readonly').objectStore('things').index('byAt').getAll())
    const busy = Date.now() + 20
    while (Date.now() < busy) { /* the awaiter's own work */ }
    await nextTask()
    const got = tasks.take()
    expect([...got.keys()].sort()).toEqual(['idb:onosendai:test-tasks.things', 'idb:onosendai:test-tasks.things.byAt'])
    expect(got.get('idb:onosendai:test-tasks.things.byAt')!.max).toBeGreaterThanOrEqual(15)
    db.close()
  })

  it('reads answered one after another are timed one at a time: no window overlaps the next', async () => {
    const db = await openDatabase('onosendai:test-overlap', 1, [['things', 'key']])
    const tasks = countTasks()
    await request(db.transaction('things', 'readwrite').objectStore('things').put({ key: 'a' }))
    // The put's own measurement ends at the next task.
    await nextTask()
    tasks.take()
    const t0 = performance.now()
    const os = db.transaction('things', 'readonly').objectStore('things')
    await Promise.all(Array.from({ length: 6 }, () => request(os.get('a'))))
    await nextTask()
    const elapsed = performance.now() - t0
    const got = tasks.take().get('idb:onosendai:test-overlap.things')!
    expect(got.n).toBe(6)
    expect(got.ms).toBeLessThanOrEqual(elapsed + 1)
    db.close()
  })

  it('a yield is told by what yielded', async () => {
    const tasks = countTasks()
    tasks.take()
    await yieldTask('land')
    await yieldTask()
    await nextTask()
    expect([...tasks.take().keys()].sort()).toEqual(['yield:land', 'yield:yield'])
  })

  it('a row keeps the labels through the diagnostics\' label filter', () => {
    const row = taskRow(5, new Map([['idb:onosendai:hyperspace.stops', { n: 2, ms: 500.04, max: 260.06 }]]))
    expect(row).toEqual([5, [['idb:onosendai:hyperspace.stops', 2, 500, 260.1]]])
    expect(taskRow(5, new Map())).toBeNull()
  })

  it('an index label names its store too', () => {
    const fake = { source: { name: 'byAt', objectStore: { name: 'things', transaction: { db: { name: 'onosendai:x' } } } } } as unknown as IDBRequest
    expect(idbLabel(fake)).toBe('idb:onosendai:x.things.byAt')
  })
})
