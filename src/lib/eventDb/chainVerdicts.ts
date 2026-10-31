/**
 * chainVerdicts.ts - whether a chain holds, kept on its rows: the chain flag of
 * design 3.5, with today's structural rules (links, sectors, brackets, rides).
 * Hop proofs are not checked here yet: their verdict joins this when residue
 * verification lands, on the same rows.
 *
 * A verdict says which epoch it was reached under. When CHAIN_RULES_EPOCH rises,
 * every older verdict reads as "not checked" and nothing is rewritten for that:
 * the rows are flagged again as the chain is next loaded. So a rules change costs
 * one fold, and flags are written only where they differ, in batches, so a long
 * chain is never one long transaction.
 *
 * A row's verdict is transitive. Valid means it and every action before it hold.
 * Broken means it or something before it does not. A fork ends the whole chain,
 * from its spawn (the ruling of 2026-10-08): buildChain says so on the spawn's
 * row, and every row then reads broken, with nothing valid.
 */

import { request } from '../idb'
import { buildChain, CHAIN_RULES_REVISION, firstBreak } from '../events'
import { CHAINS, EVENTS, eventOf, type ChainFlag, type EventRow } from './schema'
import { inTransaction } from './store'
import type { ChainRecord } from './chainRows'

/** Where a chain's verdicts stand, on its record. */
export interface ChainVerdict {
  epoch: number
  /** The head the verdict was reached at. */
  headId: string
  /** The newest action valid under `epoch`, and its place. Null when not even the spawn is. */
  validThrough: { id: string; n: number } | null
  /** The first action that does not hold, with the rule's reason, or null. */
  firstBreak: { id: string; n: number; reason: string } | null
}

export interface VerdictRun {
  verdict: ChainVerdict | null
  /** How many rows were written: only where a flag differed. */
  written: number
}

const VERDICT_BATCH = 100
const placesOf = (pubkey: string): IDBKeyRange => IDBKeyRange.bound([pubkey, 0], [pubkey, Infinity])

/** What each action of a chain's rows reads as, by id. Pure, for the tests. */
export function verdictsFor(pubkey: string, rows: EventRow[]): { flags: Map<string, ChainFlag>; validThrough: ChainVerdict['validThrough']; firstBreak: ChainVerdict['firstBreak'] } {
  const flags = new Map<string, ChainFlag>()
  for (const r of rows) flags.set(r.id, -1)
  const place = new Map(rows.map((r) => [r.id, r.chainN ?? 0]))
  const actions = buildChain(rows.map(eventOf), pubkey)
  const broke = firstBreak(actions)
  const end = broke ? broke.index : actions.length
  for (let i = 0; i < end; i++) flags.set(actions[i].id, 1)
  const lastValid = end > 0 ? actions[end - 1] : null
  return {
    flags,
    validThrough: lastValid ? { id: lastValid.id, n: place.get(lastValid.id) ?? end - 1 } : null,
    firstBreak: broke ? { id: broke.action.id, n: place.get(broke.action.id) ?? broke.index, reason: String(broke.action.breaks ?? 'broken') } : null,
  }
}

/**
 * Bring a chain's flags up to `epoch` and its head. Cheap when nothing changed:
 * only the record is read. The record's verdict is only written when the chain
 * is still at the head it was reached at: a move made meanwhile has its turn
 * next time, and its row simply reads as not checked until then.
 */
export async function markChainVerdicts(db: IDBDatabase, pubkey: string, epoch: number): Promise<VerdictRun> {
  const first = db.transaction([CHAINS, EVENTS], 'readonly')
  const record = await request(first.objectStore(CHAINS).get(pubkey)) as ChainRecord | undefined
  if (!record) return { verdict: null, written: 0 }
  if (record.verdict?.epoch === epoch && record.verdict.headId === record.headId) return { verdict: record.verdict, written: 0 }
  const rows = await request(first.objectStore(EVENTS).index('byChain').getAll(placesOf(pubkey))) as EventRow[]
  const { flags, validThrough, firstBreak: broke } = verdictsFor(pubkey, rows)
  const stale = rows.filter((r) => r.chain !== flags.get(r.id) || r.chainEpoch !== epoch)
  for (let i = 0; i < stale.length; i += VERDICT_BATCH) {
    const tx = db.transaction(EVENTS, 'readwrite')
    await inTransaction(tx, async () => {
      const os = tx.objectStore(EVENTS)
      for (const seen of stale.slice(i, i + VERDICT_BATCH)) {
        const row = await request(os.get(seen.id)) as EventRow | undefined
        if (!row) continue
        const { breakAt: _old, ...rest } = row
        void _old
        const next: EventRow = { ...rest, chain: flags.get(seen.id) ?? 0, chainEpoch: epoch, chainRev: CHAIN_RULES_REVISION }
        if (broke?.id === seen.id) next.breakAt = broke.reason
        os.put(next)
      }
    })
  }
  const verdict: ChainVerdict = { epoch, headId: record.headId, validThrough, firstBreak: broke }
  const last = db.transaction(CHAINS, 'readwrite')
  await inTransaction(last, async () => {
    const os = last.objectStore(CHAINS)
    const now = await request(os.get(pubkey)) as ChainRecord | undefined
    if (now && now.headId === record.headId) os.put({ ...now, verdict })
  })
  return { verdict, written: stale.length }
}

/** A row's verdict as of the running epoch: one reached under an older epoch reads as not checked. */
export function verdictOf(row: Pick<EventRow, 'chain' | 'chainEpoch'>, epoch: number): ChainFlag {
  return row.chainEpoch === epoch ? row.chain : 0
}
