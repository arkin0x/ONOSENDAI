/**
 * ops.ts - everything the database can be asked, by name, so a call is the
 * same whether the event worker or the main thread runs it (client.ts).
 */

import { withEventDb } from './connection'
import { postNote } from './channel'
import { budget, byAddress, byAuthorKind, byKind, byTag, getRows, ingest, type IngestItem } from './store'
import { chainHead, commitChain, migrateChain, partedBranches, readChain, setAsideBranch, type ChainCommit, type ChainMigration, type ChainSource } from './chainRows'

export const eventDbOps = {
  async ingest(by: string, items: IngestItem[]) {
    const result = await withEventDb((db) => ingest(db, items))
    if (result.added.length > 0) postNote({ kind: 'events', by, ids: result.added })
    return result
  },
  getRows: (ids: string[]) => withEventDb((db) => getRows(db, ids)),
  byAuthorKind: (pubkey: string, kind: number, limit?: number) => withEventDb((db) => byAuthorKind(db, pubkey, kind, limit)),
  byKind: (kind: number, limit?: number) => withEventDb((db) => byKind(db, kind, limit)),
  byTag: (tag: string, limit?: number) => withEventDb((db) => byTag(db, tag, limit)),
  byAddress: (addr: string) => withEventDb((db) => byAddress(db, addr)),
  budget: () => withEventDb((db) => budget(db)),
  async commitChain(by: string, c: ChainCommit) {
    const result = await withEventDb((db) => commitChain(db, c))
    // After the commit, so a note never runs ahead of the rows it names.
    if (result.status === 'ok' && result.changed) postNote({ kind: 'chain', by, pubkey: c.pubkey, headId: c.headId, generation: result.generation, length: c.length })
    return result
  },
  chainHead: (pubkey: string) => withEventDb((db) => chainHead(db, pubkey)),
  readChain: (pubkey: string) => withEventDb((db) => readChain(db, pubkey)),
  async migrateChain(by: string, m: ChainMigration) {
    const result = await withEventDb((db) => migrateChain(db, m))
    if (result.status === 'switched') postNote({ kind: 'chain', by, pubkey: m.pubkey, headId: result.headId, generation: 1, length: result.rows })
    return result
  },
  setAsideBranch: (pubkey: string, branch: ChainSource) => withEventDb((db) => setAsideBranch(db, pubkey, branch)),
  partedBranches: (pubkey: string) => withEventDb((db) => partedBranches(db, pubkey)),
}

export type EventDbOps = typeof eventDbOps
export type EventDbOp = keyof EventDbOps

export interface EventDbRequest { call: number; op: EventDbOp; args: unknown[] }
export type EventDbResponse =
  | { call: number; ok: true; value: unknown }
  | { call: number; ok: false; name: string; message: string }

/** Run one request; never rejects. */
export async function answer(request: EventDbRequest): Promise<EventDbResponse> {
  try {
    const run = eventDbOps[request.op] as (...args: unknown[]) => Promise<unknown>
    return { call: request.call, ok: true, value: await run(...request.args) }
  } catch (err) {
    const e = err as { name?: unknown; message?: unknown } | null
    return { call: request.call, ok: false, name: typeof e?.name === 'string' ? e.name : 'Error', message: typeof e?.message === 'string' ? e.message : String(err) }
  }
}
