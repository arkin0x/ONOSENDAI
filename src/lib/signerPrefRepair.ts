/**
 * signerPrefRepair.ts: before the app loads (main.tsx), the one signer pref
 * slot ('onosendai:signer', lib/signers.ts) is checked against the identities
 * store (lib/identitiesDb.ts), so a load never says a key is not on this
 * device while the device holds a way back to that identity.
 *
 * Why. A pref that names a local key with no key beside it is read as "a
 * password was declined", and the load locks the identity behind "Log in
 * again: KEY NOT SAVED ON THIS DEVICE" (store pickInitialSigner, hud/KeyLock).
 * The owner signs with Amber over NIP-46 and saw it (2026-11-22). Such a pref
 * also comes from a slot write that never landed: before the move to
 * IndexedDB (#839) his localStorage was full, and a write that grew the slot
 * (a bunker session is a few hundred characters) was refused in silence while
 * a shorter one had landed before it. The identities store, in IndexedDB,
 * kept the identity's bunker session all along.
 *
 * What changes, and only for the same pubkey the pref names:
 * - a pref with no key at all: the identity comes back the way the store
 *   holds it, a key this app generated first (nothing to ask), then the
 *   bunker session (it reconnects as any saved bunker does, and refuses a
 *   signer now on another account), then the key sealed with its password
 *   (the lock asks for the password instead of saying the key is gone).
 *   Nothing held: the pref stays, and the lock says so as before.
 * - a plain key the marks do not say this app generated (MINTED_KEY, the
 *   device's first key) while the store holds it as generated: marked as
 *   generated, as a key that comes back from the list is (store
 *   markGeneratedBack), so the load does not ask for a password for it, and
 *   NOT NOW never ends in the lock above.
 *
 * It waits for the store at most `waitMs` past `writable`, and only when the
 * pref is one of those two; any other pref is left alone at once. Never
 * throws.
 *
 * It runs beside the kv read (lib/bootSequence.ts), not after it: the read of
 * the identities store overlaps the kv one. Its writes still wait for
 * `writable` (the kv read and move), because a localStorage left full by
 * older builds has room only once the move has freed it, and a write refused
 * for room is a repair lost. Its time on the identities store counts from
 * `writable` too: every database of a site answers from one queue, so on a
 * phone the identities read waits behind the kv one, and a clock started
 * beside it would run out on a read that was only queued. Once `late()` says
 * the app has loaded without it, it writes nothing: the store has already
 * read the pref.
 */

import { nip19 } from 'nostr-tools'
import { getPublicKey } from 'nostr-tools/pure'
import { generatedKeyOf, readHeld, type HeldIdentity } from './identitiesDb'

/** The signer pref slot (lib/signers.ts PREF_KEY), read here without loading the signers. */
export const PREF_KEY = 'onosendai:signer'
/** The last key this app generated (store/useCyberspace.ts MINTED_KEY). */
export const MINTED_KEY = 'onosendai:mintedKey'
/** A key made or taken back on purpose, never a first arrival (store/useCyberspace.ts CHOSEN_KEY). */
export const CHOSEN_KEY = 'onosendai:keyByChoice'
/** The device's first generated key (store/useCyberspace.ts STORAGE_KEY). */
export const FIRST_KEY = 'onosendai:nsec'
/** How long the load waits on the identities store (store/useCyberspace.ts HELD_LOOKUP_MS). */
export const REPAIR_WAIT_MS = 1500

const HEX64 = /^[0-9a-f]{64}$/

export type PrefRepair = 'kept' | 'generated' | 'bunker' | 'sealed' | 'marked'

interface Pref { kind?: unknown; pubkey?: unknown; nsec?: unknown; ncryptsec?: unknown; bunkerUri?: unknown }

function ls(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

function readPref(): Pref | null {
  try {
    const raw = ls()?.getItem(PREF_KEY)
    const pref = raw ? (JSON.parse(raw) as unknown) : null
    return pref && typeof pref === 'object' ? (pref as Pref) : null
  } catch { return null }
}

function write(key: string, value: string): boolean {
  try { ls()?.setItem(key, value); return true } catch { return false }
}

/** Whether the marks a load reads say this app generated the key of `pubkey` (store generatedHere). */
function markedGenerated(pubkey: string): boolean {
  try {
    if (ls()?.getItem(MINTED_KEY) === pubkey) return true
    const first = ls()?.getItem(FIRST_KEY)
    if (!first) return false
    const { type, data } = nip19.decode(first)
    return type === 'nsec' && getPublicKey(data as Uint8Array) === pubkey
  } catch { return false }
}

/** Mark `pubkey` as the generated key in use, as store markGeneratedBack does. */
function markGenerated(pubkey: string): boolean {
  const ok = write(MINTED_KEY, pubkey)
  write(CHOSEN_KEY, pubkey)
  return ok
}

/** Check the signer pref against the identities store, and say what was done (see the header). */
export async function repairSignerPref(waitMs = REPAIR_WAIT_MS, late: () => boolean = () => false, writable: Promise<unknown> = Promise.resolve()): Promise<PrefRepair> {
  try {
    const settled = writable.catch(() => undefined)
    // Every write waits for room (the kv move), and none happens once the app has loaded without this.
    const mayWrite = async (): Promise<boolean> => { await settled; return !late() }
    // Asked at once; given up on `waitMs` after the kv step, not after the ask (see the header).
    const held = (pubkey: string): Promise<HeldIdentity | null> => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let answered = false
      // A read that answered before the kv step sets no clock at all.
      const out = settled.then(() => (answered ? null : new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs) })))
      return Promise.race([readHeld(pubkey).catch(() => null), out]).finally(() => { answered = true; clearTimeout(timer) })
    }
    const unchanged = (): boolean => JSON.stringify(readPref()) === JSON.stringify(pref)
    const pref = readPref()
    if (!pref || pref.kind !== 'local' || typeof pref.pubkey !== 'string' || !HEX64.test(pref.pubkey)) return 'kept'
    const pubkey = pref.pubkey
    if (typeof pref.ncryptsec === 'string' && pref.ncryptsec) return 'kept'

    if (typeof pref.nsec === 'string' && pref.nsec) {
      if (markedGenerated(pubkey)) return 'kept'
      const row = await held(pubkey)
      // The store holds a plain key only for a key this app generated (identitiesDb heldFromPref).
      return row && generatedKeyOf(row) && row.nsec === pref.nsec && await mayWrite() && unchanged() && markGenerated(pubkey) ? 'marked' : 'kept'
    }

    // No key beside it: what pickInitialSigner would lock as 'gone'.
    const row = await held(pubkey)
    if (!row) return 'kept'
    const wantsWrite = !!generatedKeyOf(row) || !!row.bunker?.bunkerUri || (typeof row.ncryptsec === 'string' && row.ncryptsec.startsWith('ncryptsec1'))
    if (!wantsWrite || !(await mayWrite())) return 'kept'
    // The pref may have changed while this waited (another tab, a login): only the pref read above is repaired.
    if (!unchanged()) return 'kept'
    if (generatedKeyOf(row)) {
      // Marked first: a pref with the key and no mark would ask a password for it.
      if (!markGenerated(pubkey)) return 'kept'
      return write(PREF_KEY, JSON.stringify({ kind: 'local', pubkey, nsec: row.nsec })) ? 'generated' : 'kept'
    }
    const bunker = row.bunker
    if (bunker && typeof bunker.bunkerUri === 'string' && bunker.bunkerUri) {
      const next: Record<string, unknown> = { kind: 'nip46', pubkey, bunkerUri: bunker.bunkerUri }
      if (bunker.clientNsec) next.clientNsec = bunker.clientNsec
      if (bunker.nostrConnectSession) next.nostrConnectSession = true
      return write(PREF_KEY, JSON.stringify(next)) ? 'bunker' : 'kept'
    }
    if (typeof row.ncryptsec === 'string' && row.ncryptsec.startsWith('ncryptsec1')) {
      return write(PREF_KEY, JSON.stringify({ kind: 'local', pubkey, ncryptsec: row.ncryptsec })) ? 'sealed' : 'kept'
    }
    return 'kept'
  } catch {
    return 'kept'
  }
}
