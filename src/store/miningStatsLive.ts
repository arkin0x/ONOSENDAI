/**
 * miningStatsLive.ts: store/miningStats.ts wired to the app: the relays, the
 * signer, the tutorial, the page going hidden, and the clock of time spent in
 * TERRAIN. Started once from App.
 *
 * TIME IN TERRAIN. Counted while TERRAIN is the mode and the tab is on
 * screen, for the identity on screen as it started: every TICK_MS, and at
 * once whenever TERRAIN, the tab or the identity changes.
 */

import { CYBERSPACE_RELAY, publishMany, queryChecked, relaySet } from '../lib/relay'
import { useCyberspace } from './useCyberspace'
import { useTerrain } from './useTerrain'
import { tutorialRunFor } from './useTutorial'
import { addTerrainTime, identityChanged, nudgeMining, schedule, setMiningDeps, type MiningDeps } from './miningStats'

const sameRelay = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/\/+$/, '') === b.trim().toLowerCase().replace(/\/+$/, '')
/** A person may be reading the signer's prompt. */
const SIGN_PATIENCE_MS = 120_000
/** How often time in TERRAIN is added up while it runs. */
export const TICK_MS = 30_000

let started = false

export function startMiningStats(): void {
  if (started) return
  started = true
  const deps: Partial<MiningDeps> = {
    self: () => useCyberspace.getState().identity.pubkey,
    live: () => useCyberspace.getState().live,
    tutorial: (me) => tutorialRunFor(me),
    crypto: () => {
      const c = useCyberspace.getState().selfCrypto()
      return { nip44Encrypt: c.nip44Encrypt, nip44Decrypt: c.nip44Decrypt }
    },
    fetch: async (filter) => { const r = await queryChecked(filter); return { events: r.events, trouble: !!r.trouble } },
    sign: (template) => useCyberspace.getState().signEvent(template, SIGN_PATIENCE_MS),
    // Saved means the canonical relay took it, as for the hidden list.
    publish: async (event) => {
      const res = await publishMany(relaySet(), event)
      if (res.ok && res.accepted && !res.accepted.some((u) => sameRelay(u, CYBERSPACE_RELAY))) return { ok: false, reason: `${CYBERSPACE_RELAY.replace('wss://', '')} did not take it` }
      return res
    },
  }
  setMiningDeps(deps)

  // Time in TERRAIN, on screen.
  let since: number | null = null
  let owner = ''
  const visible = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  const tick = (): void => {
    const now = Date.now()
    if (since !== null && owner) addTerrainTime((now - since) / 1000, owner)
    const on = useTerrain.getState().active && visible()
    since = on ? now : null
    owner = on ? useCyberspace.getState().identity.pubkey : ''
  }
  setInterval(tick, TICK_MS)
  useTerrain.subscribe((t, prev) => { if (t.active !== prev.active) tick() })

  useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey !== prev.identity.pubkey) { tick(); identityChanged() }
    // LIVE again: what LOCAL held back.
    else if (s.live && !prev.live) schedule()
  })

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      tick()
      if (document.visibilityState === 'hidden') nudgeMining('hide')
    })
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { tick(); nudgeMining('hide') })
  // Anything left from the last visit.
  schedule()
}
