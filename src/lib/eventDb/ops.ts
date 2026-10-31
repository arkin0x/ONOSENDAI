/**
 * ops.ts - everything the database can be asked, by name, so a call is the
 * same whether the event worker or the main thread runs it (client.ts).
 */

import { withEventDb } from './connection'
import { postNote } from './channel'
import { budget, byAddress, byAuthorKind, byKind, byTag, getRows, ingest, type IngestItem } from './store'

export const eventDbOps = {
  async ingest(by: string, items: IngestItem[]) {
    const result = await withEventDb((db) => ingest(db, items))
    if (result.added.length > 0 || result.struck.length > 0) postNote({ kind: 'events', by, ids: result.added, struck: result.struck })
    return result
  },
  getRows: (ids: string[]) => withEventDb((db) => getRows(db, ids)),
  byAuthorKind: (pubkey: string, kind: number, limit?: number) => withEventDb((db) => byAuthorKind(db, pubkey, kind, limit)),
  byKind: (kind: number, limit?: number) => withEventDb((db) => byKind(db, kind, limit)),
  byTag: (tag: string, limit?: number) => withEventDb((db) => byTag(db, tag, limit)),
  byAddress: (addr: string) => withEventDb((db) => byAddress(db, addr)),
  budget: () => withEventDb((db) => budget(db)),
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
