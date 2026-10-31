/**
 * mineRollback.ts - the way back from per-identity deployment lists, for a
 * revert of them.
 *
 * Code from before them reads only the bare `onosendai:deployments` key. So a
 * revert keeps this one file and calls this at load, for the identity signed
 * in, or that identity's hidden things vanish from its list. Nothing else
 * imports it, so it stays out of every bundle until then.
 *
 * It only adds. The per-identity key stays as it is, so going forward again
 * loses nothing. It takes only `me`: merging every identity's list would bring
 * the shared list back for all of them.
 *
 * Its limits:
 * - A row deleted while rolled back comes back on going forward, because its
 *   per-identity copy is still there, unless the deleted list holds it.
 * - LIVE LINK rows in `onosendai:deployments-unclaimed` are not restored, and
 *   the old code does not read them.
 * - It returns false, restoring nothing, when the merged list does not fit.
 */
export function rollbackMineToBare(me: string): boolean {
  const read = (key: string): { eventId?: string }[] => {
    try {
      const list = JSON.parse(localStorage.getItem(key) ?? '[]')
      return Array.isArray(list) ? list : []
    } catch { return [] }
  }
  const BARE = 'onosendai:deployments'
  const deleted = new Set<unknown>(read(`${BARE}-deleted`) as unknown[])
  const bare = read(BARE)
  const have = new Set(bare.map((d) => d?.eventId))
  const back = read(`${BARE}:${me}`).filter((d) => d?.eventId && !have.has(d.eventId) && !deleted.has(d.eventId))
  if (back.length === 0) return true
  try {
    localStorage.setItem(BARE, JSON.stringify([...bare, ...back]))
    return true
  } catch { return false }
}
