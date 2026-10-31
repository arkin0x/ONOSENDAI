/**
 * diagGate.ts: whether this tab runs the capture in lib/diag.ts.
 *
 * ?diag=1 turns it on and it stays on through reloads of this tab. ?diag=0
 * turns it off. Off, this check is all that runs: lib/diag.ts is a chunk of its
 * own that is never fetched, and nothing in the page is wrapped.
 */

export const DIAG_KEY = 'onosendai:diag'

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
    else if (asked === '0') store?.removeItem(DIAG_KEY)
    if (asked === '1') return true
    if (asked === '0') return false
    return store?.getItem(DIAG_KEY) === '1'
  } catch {
    return asked === '1'
  }
}
