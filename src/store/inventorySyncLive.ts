/**
 * inventorySyncLive.ts: store/inventorySync.ts wired to the app: the relays,
 * the signer, the tutorial, MINING's Compiler date, and the moments it reads
 * (the identity on screen, LIVE again, the page back in view or focus) and
 * writes (the page going hidden). Started once from App, beside MINING's.
 */

import { CYBERSPACE_RELAY, publishMany, queryChecked, relaySet } from '../lib/relay'
import { useCyberspace } from './useCyberspace'
import { tutorialRunFor } from './useTutorial'
import { miningRecordFor } from './miningStats'
import { identityChanged, nudgeInventory, schedule, setInventoryDeps, type InventoryDeps } from './inventorySync'

const sameRelay = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/\/+$/, '') === b.trim().toLowerCase().replace(/\/+$/, '')
/** A person may be reading the signer's prompt. */
const SIGN_PATIENCE_MS = 120_000

let started = false

export function startInventorySync(): void {
  if (started) return
  started = true
  const deps: Partial<InventoryDeps> = {
    self: () => useCyberspace.getState().identity.pubkey,
    live: () => useCyberspace.getState().live,
    tutorial: (me) => tutorialRunFor(me),
    crypto: () => {
      const c = useCyberspace.getState().selfCrypto()
      return { nip44Encrypt: c.nip44Encrypt, nip44Decrypt: c.nip44Decrypt }
    },
    fetch: async (filter) => { const r = await queryChecked(filter); return { events: r.events, trouble: !!r.trouble } },
    sign: (template) => useCyberspace.getState().signEvent(template, SIGN_PATIENCE_MS),
    // Saved means the canonical relay took it, as for MINING and the hidden list.
    publish: async (event) => {
      const res = await publishMany(relaySet(), event)
      if (res.ok && res.accepted && !res.accepted.some((u) => sameRelay(u, CYBERSPACE_RELAY))) return { ok: false, reason: `${CYBERSPACE_RELAY.replace('wss://', '')} did not take it` }
      return res
    },
    crafted: (me) => miningRecordFor(me).first.compiler,
  }
  setInventoryDeps(deps)

  useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey !== prev.identity.pubkey) identityChanged()
    // LIVE again: what LOCAL held back, and what the other devices did meanwhile.
    else if (s.live && !prev.live) { schedule(); nudgeInventory('read') }
  })

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => nudgeInventory(document.visibilityState === 'hidden' ? 'hide' : 'read'))
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => nudgeInventory('hide'))
    window.addEventListener('focus', () => nudgeInventory('read'))
  }
  // Anything left from the last visit, and the other devices' numbers.
  schedule()
  nudgeInventory('read')
}
