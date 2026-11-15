/**
 * hidesSyncLive.ts: store/hidesSync.ts wired to the app: the relays, the
 * signer, your list (useShards `mine`) and the way a bag of yours is opened
 * from another device. Started once from App.
 */

import { CYBERSPACE_RELAY, onResume, publishMany, query, queryChecked, relaySet } from '../lib/relay'
import { holdingBroadcast } from '../lib/noBroadcast'
import { adoptEntries } from '../lib/hidesAdopt'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { noteListChange, requestSync, setHidesDeps, type HidesDeps } from './hidesSync'

const sameRelay = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/\/+$/, '') === b.trim().toLowerCase().replace(/\/+$/, '')

/** A person may be reading the signer's prompt. */
const SIGN_PATIENCE_MS = 120_000
let started = false

export function startHidesSync(): void {
  if (started) return
  started = true
  const deps: Partial<HidesDeps> = {
    self: () => useCyberspace.getState().identity.pubkey,
    live: () => useCyberspace.getState().live,
    tutorial: (me) => holdingBroadcast(me),
    crypto: () => {
      const c = useCyberspace.getState().selfCrypto()
      return { nip44Encrypt: c.nip44Encrypt, nip44Decrypt: c.nip44Decrypt }
    },
    fetch: async (filter) => { const r = await queryChecked(filter); return { events: r.events, trouble: !!r.trouble } },
    sign: (template) => useCyberspace.getState().signEvent(template, SIGN_PATIENCE_MS),
    // Saved means the canonical relay took it: one other relay holding it is not the record.
    publish: async (event) => {
      const res = await publishMany(relaySet(), event)
      if (res.ok && res.accepted && !res.accepted.some((u) => sameRelay(u, CYBERSPACE_RELAY))) return { ok: false, reason: `${CYBERSPACE_RELAY.replace('wss://', '')} did not take it` }
      return res
    },
    rows: (me) => (useCyberspace.getState().identity.pubkey === me ? useShards.getState().mine : null),
    adopt: async (entries, me) => {
      const { found, state } = await adoptEntries(entries, me, { checked: queryChecked, any: query })
      if (found.length > 0 && useCyberspace.getState().identity.pubkey === me) useShards.getState().addDiscovered(found)
      return state
    },
  }
  setHidesDeps(deps)
  // Your list changed: what left it is tombstoned, and a write follows the last change.
  let owner = useCyberspace.getState().identity.pubkey
  useShards.subscribe((s, prev) => {
    const me = useCyberspace.getState().identity.pubkey
    if (s.mine === prev.mine) return
    if (me !== owner) { owner = me; return }
    noteListChange(me, prev.mine, s.mine)
    requestSync()
  })
  useCyberspace.subscribe((s, prev) => {
    // The owner of the list is followed where the list changes (above): a switch is never read as deletions.
    if (s.identity.pubkey !== prev.identity.pubkey) requestSync(1500)
    // LIVE again: what LOCAL held back.
    else if (s.live && !prev.live) requestSync()
  })
  onResume(() => requestSync(1500))
  requestSync(2500)
}
