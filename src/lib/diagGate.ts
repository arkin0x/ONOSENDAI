/**
 * diagGate.ts: whether this tab runs the capture in lib/diag.ts.
 *
 * ?diag=1 turns it on and it stays on through reloads of this tab. ?diag=0
 * turns it off. Off, this check is all that runs: lib/diag.ts is a chunk of its
 * own that is never fetched, and nothing in the page is wrapped.
 */

export const DIAG_KEY = 'onosendai:diag'
/** The report as last kept, for a tab that crashes, and the one a load found. */
export const DIAG_LAST_KEY = 'onosendai:diag:last'
export const DIAG_FOUND_KEY = 'onosendai:diag:found'

/** Turn the capture off in this tab, with what it kept. */
export function diagForget(store: DiagStore | null): void {
  for (const key of [DIAG_KEY, DIAG_LAST_KEY, DIAG_FOUND_KEY]) store?.removeItem(key)
}

/** As much of sessionStorage as the gate touches. A tab that refuses storage still turns on for this load. */
export interface DiagStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Whether the capture runs, given the page's query string and the tab's storage. */
export function diagWanted(search: string, store: DiagStore | null): boolean {
  const asked = new URLSearchParams(search).get('diag')
  try {
    if (asked === '1') store?.setItem(DIAG_KEY, '1')
    else if (asked === '0') diagForget(store)
    if (asked === '1') return true
    if (asked === '0') return false
    return store?.getItem(DIAG_KEY) === '1'
  } catch {
    return asked === '1'
  }
}
