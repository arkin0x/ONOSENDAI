/**
 * agentUpdateDb.ts: the AGENTS panel's update notices, kept in IndexedDB per
 * identity (arkinox, 2026-11-19: all local data per npub, in IndexedDB, and
 * a switch to another key never deletes it).
 *
 * | Store | Key | Holds |
 * |---|---|---|
 * | dismissed | owner:agent:version | an "I'VE UPDATED": the latest version the notice named, how loud it was, what the agent ran, when |
 * | seen | owner:release key | the highest min_allowed_version and the highest security release seen, never lowered |
 *
 * Both are indexed by `owner`, so one identity's rows come back in one read
 * and another identity's never do. The `seen` row is keyed by the release key
 * too, so a build with another release key starts over (as cyberspace-mcp's
 * update.json does). Nothing here knows about zustand; store/useAgentUpdates.ts
 * decides when to read and write.
 */

import { openDatabase, request } from './idb'
import { higherVersion, type Dismissal, type NoticeLevel } from './mcpUpdates'

export const AGENT_UPDATE_DB = 'onosendai:agent-updates'
const DB_VERSION = 1
const DISMISSED = 'dismissed'
const SEEN = 'seen'
const BY_OWNER = 'byOwner'
const OPEN_TIMEOUT_MS = 8000

interface DismissedRow extends Dismissal { rowKey: string; owner: string }
interface SeenRow { rowKey: string; owner: string; releasePubkey: string; minSafe: string | null; security: string | null }

export function openAgentUpdateDb(timeoutMs: number = OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  const opening = openDatabase(AGENT_UPDATE_DB, DB_VERSION, [
    [DISMISSED, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }]],
    [SEEN, 'rowKey', [{ name: BY_OWNER, keyPath: 'owner' }]],
  ])
  // As the other small databases do: a blocked upgrade or a browser that
  // never answers must not hold the panel, and a late connection is closed.
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(new Error('IndexedDB did not open in time')) }, timeoutMs)
  })
  opening.then((db) => { if (timedOut) db.close() }, () => { /* the race reports it */ })
  return Promise.race([opening, timeout]).finally(() => clearTimeout(timer))
}

function write(db: IDBDatabase, store: string, row: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

const LEVELS: readonly NoticeLevel[] = ['must', 'available']

/** This identity's dismissals, by agent: for each agent, the one for the highest version. */
export async function readDismissals(db: IDBDatabase, owner: string): Promise<Record<string, Dismissal>> {
  const rows = await request(db.transaction(DISMISSED, 'readonly').objectStore(DISMISSED).index(BY_OWNER).getAll(owner)) as DismissedRow[]
  const out: Record<string, Dismissal> = {}
  for (const r of rows) {
    if (r.owner !== owner || typeof r.agent !== 'string' || typeof r.target !== 'string' || typeof r.from !== 'string' || typeof r.at !== 'number' || !LEVELS.includes(r.level)) continue
    const prior = out[r.agent]
    if (!prior || higherVersion(prior.target, r.target) !== prior.target || (prior.target === r.target && r.at > prior.at)) {
      out[r.agent] = { agent: r.agent, target: r.target, level: r.level, from: r.from, at: r.at }
    }
  }
  return out
}

/** Keep one "I'VE UPDATED" for this identity, by agent and version. */
export function putDismissal(db: IDBDatabase, owner: string, d: Dismissal): Promise<void> {
  const row: DismissedRow = { rowKey: `${owner}:${d.agent}:${d.target}`, owner, ...d }
  return write(db, DISMISSED, row)
}

/** The minimum and security marks this identity has seen from this release key, or nothing. */
export async function readSeenMarks(db: IDBDatabase, owner: string, releasePubkey: string): Promise<{ minSafe: string | null; security: string | null }> {
  const row = await request(db.transaction(SEEN, 'readonly').objectStore(SEEN).get(`${owner}:${releasePubkey}`)) as SeenRow | undefined
  if (!row || row.owner !== owner || row.releasePubkey !== releasePubkey) return { minSafe: null, security: null }
  return { minSafe: higherVersion(null, row.minSafe), security: higherVersion(null, row.security) }
}

/** Keep the marks, never lower than what is kept: read and written in one transaction, so two tabs cannot lower them. */
export function putSeenMarks(db: IDBDatabase, owner: string, releasePubkey: string, marks: { minSafe: string | null; security: string | null }): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SEEN, 'readwrite')
    const os = tx.objectStore(SEEN)
    const rowKey = `${owner}:${releasePubkey}`
    const get = os.get(rowKey)
    get.onsuccess = () => {
      const row = get.result as SeenRow | undefined
      const kept = row && row.owner === owner && row.releasePubkey === releasePubkey ? row : null
      const minSafe = higherVersion(higherVersion(null, kept?.minSafe ?? null), marks.minSafe)
      const security = higherVersion(higherVersion(null, kept?.security ?? null), marks.security)
      // Nothing new to keep.
      if (kept && minSafe === kept.minSafe && security === kept.security) return
      if (!kept && minSafe === null && security === null) return
      os.put({ rowKey, owner, releasePubkey, minSafe, security } satisfies SeenRow)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}
