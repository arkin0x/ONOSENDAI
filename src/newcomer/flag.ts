/**
 * flag.ts: ?newcomer=1, the newcomer view tried without a new key (owner,
 * 2026-11-23: a way to start as a newcomer on the preview). Kept apart from
 * the store (newcomer/useNewcomer.ts) so boot.tsx reads the address before
 * the first render without loading the app's stores.
 *
 * Like ?nochip=1 (lib/hudFlags.ts) it holds for this tab through reloads, in
 * sessionStorage, and only there: the identity's stored record is never
 * touched, and closing the tab, or ?newcomer=0, ends it.
 */

import { askTutorialRun } from '../tutorial/gate'

/** sessionStorage: this tab plays a newcomer (?newcomer=1). */
export const SESSION_FLAG = 'onosendai:newcomer-session'
/** sessionStorage: the record this tab plays with, per pubkey. */
export const SESSION_PREFIX = 'onosendai:newcomer-session:'

export function session(): Storage | null {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null } catch { return null }
}

/** Whether this tab plays a newcomer (?newcomer=1). */
export function sessionNewcomer(): boolean {
  try { return session()?.getItem(SESSION_FLAG) === '1' } catch { return false }
}

/**
 * ?newcomer=1: this tab plays a newcomer from the first step, its record
 * kept for the tab only (sessionStorage), and a tour run asked for, as
 * /tutorial asks (tutorial/gate.ts askTutorialRun). ?newcomer=0 ends it.
 * The flag comes off the address (replaceState). Before the first render
 * (boot.tsx). Returns what it set, or null when the address had no flag.
 */
export function applyNewcomerFlag(loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location, history: Pick<History, 'replaceState' | 'state'> = window.history): boolean | null {
  let params: URLSearchParams
  try { params = new URLSearchParams(loc.search) } catch { return null }
  if (!params.has('newcomer')) return null
  const raw = (params.get('newcomer') ?? '').trim().toLowerCase()
  const on = raw === '1' || raw === 'on' || raw === 'true' || raw === '' ? true : raw === '0' || raw === 'off' || raw === 'false' ? false : null
  if (on === null) return null
  const store = session()
  try {
    if (store) {
      // Every identity starts over, either way.
      const old: string[] = []
      for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(SESSION_PREFIX)) old.push(k) }
      for (const k of old) store.removeItem(k)
      if (on) store.setItem(SESSION_FLAG, '1')
      else store.removeItem(SESSION_FLAG)
    }
  } catch { /* refused: nothing to play with */ }
  if (on) askTutorialRun()
  params.delete('newcomer')
  const search = params.toString()
  try { history.replaceState(history.state, '', `${loc.pathname}${search ? `?${search}` : ''}${loc.hash}`) } catch { /* no history here */ }
  return on
}
