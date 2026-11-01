/**
 * mineRollback.ts - the way back from the per-identity record of what you hid, for
 * a revert of it.
 *
 * Code from before it reads only `onosendai:deployments` and
 * `onosendai:door-secrets`, which it left frozen. So a revert keeps this file and
 * lib/hiddenDb.ts, and awaits this at load for the identity signed in, before the
 * old code reads, or that identity's newer rows are not found. Nothing else
 * imports it, so it stays out of every bundle until then.
 *
 * It only adds, by id, and never overwrites. The database and the per-identity
 * keys stay as they are, so going forward again loses nothing. It takes only `me`:
 * every identity's rows would bring the shared list back for all of them.
 *
 * Its limits:
 * - A row deleted while rolled back comes back on going forward, because its copy
 *   in the database is still there.
 * - LIVE LINK rows still unclaimed are not restored, and the old code does not read them.
 * - It returns false when the merged list does not fit in localStorage, which is
 *   the very case that prompted the move. The rows stay safe in the database, but the
 *   old code cannot see them, so a revert on a full device loses sight of them
 *   until a build that reads the database is back.
 */

import { openHiddenDb, readEverything } from '../lib/hiddenDb'

const BARE = 'onosendai:deployments'
const SECRETS = 'onosendai:door-secrets'

function readList(key: string): Array<{ eventId?: string }> {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

export async function rollbackMineToBare(me: string): Promise<boolean> {
  const fromDb: Array<{ eventId?: string }> = []
  const known: Record<string, string> = {}
  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await openHiddenDb()
      const all = await readEverything(db)
      db.close()
      for (const r of [...all.rows].sort((a, b) => a.seq - b.seq)) {
        if (r.bucket !== me) continue
        try { fromDb.push(JSON.parse(r.json) as { eventId?: string }) } catch { /* unreadable: left in the database */ }
      }
      for (const s of all.secrets) if (s.owner === me) known[s.doorId] = s.secret
    } catch { /* no database to read: localStorage is all there is */ }
  }
  const deleted = new Set<unknown>(readList(`${BARE}-deleted`) as unknown[])
  const bare = readList(BARE)
  const have = new Set(bare.map((d) => d?.eventId))
  const back = [...fromDb, ...readList(`${BARE}:${me}`)].filter((d) => {
    if (!d?.eventId || have.has(d.eventId) || deleted.has(d.eventId)) return false
    have.add(d.eventId)
    return true
  })
  // Secrets first: small, and a door cannot be edited without one, so a full list of rows must not cost them.
  try {
    let all: Record<string, Record<string, string>> = {}
    try { all = JSON.parse(localStorage.getItem(SECRETS) ?? '{}') as typeof all } catch { /* unreadable: replaced only if there is something to add */ }
    const mine = { ...known, ...(all[me] ?? {}) }
    if (Object.keys(mine).length > Object.keys(all[me] ?? {}).length) localStorage.setItem(SECRETS, JSON.stringify({ ...all, [me]: mine }))
    if (back.length > 0) localStorage.setItem(BARE, JSON.stringify([...bare, ...back]))
    return true
  } catch { return false }
}
