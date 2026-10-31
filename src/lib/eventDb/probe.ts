/**
 * probe.ts - whether the store works on this browser, tried for real before
 * anyone's chain is moved into it. iPhone Safari cannot be tested from where
 * this is built, and the store relies on things an engine could get wrong:
 * [tag, time] pairs as multi-entry keys read by a reverse range, compound keys,
 * a unique index on a field most rows lack, and all of it inside a Web Worker.
 *
 * So a throwaway database gets the real stores and the real code, with made-up
 * events, and every answer is compared with what it must be. Nothing here
 * touches `onosendai:events`, and the throwaway is deleted afterwards. A browser
 * that fails stays on the old stores, as if this PR had not shipped.
 */

import { openDatabase } from '../idb'
import type { NostrEvent } from '../events'
import { EVENT_DB_STORES, EVENT_DB_VERSION, EVENTS } from './schema'
import { byAddress, byTag, getRows, ingest } from './store'
import { commitChain, migrateChain, partedBranches, readChain, setAsideBranch, type ChainCommit } from './chainRows'

export const PROBE_DB = 'onosendai:events-probe'
/** Bump when the probe asks for more: every browser is asked again. */
export const PROBE_VERSION = `1.${EVENT_DB_VERSION}`

const hex = (c: string): string => c.repeat(64)
const fake = (id: string, created_at: number, kind: number, tags: string[][], pubkey = hex('a')): NostrEvent => ({ id: hex(id), pubkey, created_at, kind, tags, content: 'probe', sig: 'f'.repeat(128) })
const ids = (events: NostrEvent[] | undefined): string => (events ?? []).map((e) => e.id[0]).join('')

function removeProbe(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(PROBE_DB)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    } catch { resolve() }
  })
}

/** The first thing that did not answer as it must, or null when all did. */
async function firstFailure(db: IDBDatabase): Promise<string | null> {
  const old = fake('1', 100, 3333, [['X', '1'], ['S', '1-2-3'], ['e', hex('9')]])
  const fresh = fake('2', 200, 3333, [['X', '1'], ['S', '1-2-3']])
  const neighbor = fake('3', 300, 3333, [['X', '10']])
  await ingest(db, [old, fresh, neighbor].map((event) => ({ event, nip01: 1 as const, pin: true })), 1_000_000)
  if (ids(await byTag(db, 'X:1', 10, 1_000_000)) !== '21') return 'a reverse range over [tag, time] keys'
  if (ids(await byTag(db, 'X:1', 1, 1_000_000)) !== '2') return 'a limited read of the tag index'
  if (ids(await byTag(db, 'S:1-2-3', 10, 1_000_000)) !== '21') return 'the combined sector tag'

  const entries = await new Promise<number>((resolve, reject) => {
    const req = db.transaction(EVENTS).objectStore(EVENTS).index('byTag').count(IDBKeyRange.bound(['X:1', -Infinity], ['X:1', Infinity]))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  if (entries !== 2) return 'multi-entry keys'

  const addr = `33331:${hex('a')}:x`
  await ingest(db, [{ event: fake('4', 100, 33331, [['d', 'x']]), nip01: 1 }], 1_000_000)
  await ingest(db, [{ event: fake('5', 200, 33331, [['d', 'x']]), nip01: 1 }], 1_000_000)
  if ((await byAddress(db, addr, 1_000_000))?.id !== hex('5')) return 'the unique address index'
  if ((await getRows(db, [hex('4')]))[0]?.addr !== undefined) return 'a row leaving the unique index'

  const pubkey = hex('b')
  const a = fake('6', 100, 3333, [], pubkey)
  const b = fake('7', 101, 3333, [], pubkey)
  const c = fake('8', 101, 3333, [['n', 'x']], pubkey)
  const commit = (events: NostrEvent[], keep: number, expectHead: string | null): ChainCommit => ({ pubkey, expectHead, keep, rows: events.slice(keep).map((event) => ({ event, nip01: 1, acked: false })), acks: [], length: events.length, headId: events[events.length - 1].id, spawnId: events[0].id, savedAt: 1, held: false, stats: {} })
  await commitChain(db, commit([a], 0, null))
  await commitChain(db, commit([a, b], 1, a.id))
  if ((await commitChain(db, commit([a, c], 1, a.id))).status !== 'lost') return 'the head compared in a transaction'
  if (ids((await readChain(db, pubkey))?.events) !== '67') return 'a chain read back in order'
  if ((await commitChain(db, commit([a], 1, b.id))).status !== 'ok' || ids((await readChain(db, pubkey))?.events) !== '6') return 'a fold taking a place away'

  const moved = hex('c')
  const m = [fake('a', 1, 3333, [], moved), fake('b', 2, 3333, [], moved)]
  const source = { events: m, published: [m[0].id], stats: { n: 1 }, held: false, savedAt: 3 }
  if ((await migrateChain(db, { pubkey: moved, source, parted: [], from: ['probe'] })).status !== 'switched') return 'a move into rows'
  const read = await readChain(db, moved)
  if (ids(read?.events) !== 'ab' || read?.published.length !== 1) return 'a moved chain read back'
  await setAsideBranch(db, moved, { events: [fake('d', 9, 3333, [], moved)], published: [], stats: {}, held: false, savedAt: 1 }, 50)
  await setAsideBranch(db, moved, { events: [fake('e', 9, 3333, [], moved)], published: [], stats: {}, held: false, savedAt: 1 }, 50)
  if ((await partedBranches(db, moved)).length !== 2) return 'branches under the three-part key'
  return null
}

/** Whether the store works here. Never rejects. What failed is said, because it is the one thing nobody can see from here. */
export async function probeStore(): Promise<boolean> {
  let db: IDBDatabase | null = null
  try {
    await removeProbe()
    db = await openDatabase(PROBE_DB, EVENT_DB_VERSION, EVENT_DB_STORES)
    const failed = await firstFailure(db)
    if (failed) console.warn(`[chain] the event database does not work on this browser (${failed}): the chain stays in the old stores`)
    return failed === null
  } catch (err) {
    console.warn('[chain] the event database could not be tried on this browser: the chain stays in the old stores', err)
    return false
  } finally {
    try { db?.close() } catch { /* already closed */ }
    await removeProbe()
  }
}
