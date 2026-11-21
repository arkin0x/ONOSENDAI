/**
 * hudFlags.ts: debug switches that take a HUD piece off the page, to test
 * whether it is what makes WALK stutter on a phone (arkinox, 2026-11-21:
 * "maybe if we have a setting or query param to turn it off we could see if
 * that helps").
 *
 * | Query | What goes |
 * |---|---|
 * | ?nochip=1 | the CHAIN chip and its edge bar (hud/ChainExplorer.tsx, hud/ChainAhead.tsx), with everything only they run |
 * | ?nosyncwarn=1 | the LOSING SYNC warning and its fade (hud/SyncWarning.tsx) |
 *
 * Each is unmounted, not hidden: its hooks, store subscriptions, timers and
 * animations do not run. Neither changes the walk: the slowdown and the stop
 * still apply. They work with ?diag=1 (lib/diag.ts), and its report says
 * which were on.
 *
 * Like ?diag=1 (lib/diagGate.ts), each stays on through reloads of this tab
 * (sessionStorage), so an address the app rewrites or a reload it asks for
 * does not end the test. `=0` turns it off; closing the tab does too. Read
 * once per load: a switch never changes under a mounted HUD.
 */

import type { DiagStore } from './diagGate'

export interface HudFlags {
  /** ?nochip=1: the CHAIN chip and its edge bar are not mounted. */
  nochip: boolean
  /** ?nosyncwarn=1: the LOSING SYNC warning is not mounted. */
  nosyncwarn: boolean
}

const FLAGS = ['nochip', 'nosyncwarn'] as const

export const hudFlagKey = (name: keyof HudFlags): string => `onosendai:hud:${name}`

/** The flags, given the page's query string and the tab's storage. A tab that refuses storage still takes them for this load. */
export function hudFlagsFrom(search: string, store: DiagStore | null): HudFlags {
  const q = new URLSearchParams(search)
  const out: HudFlags = { nochip: false, nosyncwarn: false }
  for (const name of FLAGS) {
    const asked = q.get(name)
    try {
      if (asked === '1') store?.setItem(hudFlagKey(name), '1')
      else if (asked === '0') store?.removeItem(hudFlagKey(name))
      out[name] = asked === '1' || (asked !== '0' && store?.getItem(hudFlagKey(name)) === '1')
    } catch {
      out[name] = asked === '1'
    }
  }
  return out
}

let latched: HudFlags | null = null

/** This load's flags: read on the first call (main.tsx, before the first render) and kept. */
export function hudFlags(): HudFlags {
  if (latched) return latched
  let store: Storage | null = null
  try { store = sessionStorage } catch { /* refused */ }
  latched = typeof location === 'undefined' ? { nochip: false, nosyncwarn: false } : hudFlagsFrom(location.search, store)
  return latched
}

/** Tests only: set this load's flags, or null to read them again. */
export function setHudFlagsForTest(flags: HudFlags | null): void {
  latched = flags
}
