/**
 * avatarDb.ts - avatar events kept on this device, in the event database
 * (`onosendai:events`, lib/eventDb), never in localStorage (arkinox,
 * 2026-11-17: "i dont want to use local storage if we can avoid it, it fills
 * up too fast"; an avatar may be 128 KB).
 *
 * An avatar is a replaceable event, and the event database already holds a
 * replaceable event to one current version per address, the newer
 * `created_at` winning and the lower id on a tie (NIP-01, eventDb/store.ts):
 * so what is read back is always the newest avatar this device has seen for
 * that pubkey, whichever copy arrived first. Your own are pinned, so they are
 * never evicted; whether a relay has yours is the row's `acked`, which is
 * what lets an avatar adopted while LOCAL still offer BROADCAST after a reload.
 *
 * Everything here is best effort: no IndexedDB (a test, a private window
 * that refuses it) or a failure reads as nothing kept and writes nothing.
 */

import { AVATAR_KIND } from './avatar'
import type { NostrEvent } from './events'
import { TAB_ID, callEventDb, eventDbAvailable } from './eventDb/client'

/** The address of `pubkey`'s avatar: a replaceable kind has no `d`. */
export const avatarAddress = (pubkey: string): string => `${AVATAR_KIND}:${pubkey}:`

/** An avatar event kept here, and whether a relay is known to have it. */
export interface KeptAvatarEvent { event: NostrEvent; published: boolean }

/**
 * Keep `event` as its author's avatar. `mine` pins it (your own is never
 * evicted); `published` says a relay took it or answered with it. The
 * database keeps it as the current version only when it is the newest.
 */
export async function keepAvatarEvent(event: NostrEvent, opts: { mine: boolean; published: boolean }): Promise<void> {
  if (!eventDbAvailable() || event.kind !== AVATAR_KIND) return
  try {
    await callEventDb('ingest', [TAB_ID, [{ event, nip01: 1, pin: opts.mine, acked: opts.published }]])
  } catch { /* a full disk or no database: kept nowhere, drawn all the same */ }
}

/** The newest avatar event this device keeps for `pubkey`, or null. */
export async function readKeptAvatar(pubkey: string): Promise<KeptAvatarEvent | null> {
  if (!eventDbAvailable()) return null
  // What localStorage held is read too, once it has moved in.
  await migrateAvatarStorage()
  try {
    const event = await callEventDb('byAddress', [avatarAddress(pubkey)])
    if (!event || event.pubkey !== pubkey || event.kind !== AVATAR_KIND) return null
    const [row] = await callEventDb('getRows', [[event.id]])
    return { event, published: row?.acked === 1 || (row?.seen.length ?? 0) > 0 }
  } catch { return null }
}

/** Where avatars were kept in localStorage before: your own (one slot, `{ pubkey, event, published }`), and everyone else's. */
export const LEGACY_MINE_KEY = 'onosendai:avatar'
export const LEGACY_OTHERS_KEY = 'onosendai:avatars'

let migrating: Promise<void> | null = null

/**
 * Once per page: move the avatars localStorage held into the event database,
 * then clear those keys. A key is cleared only after its events are in, so a
 * failure leaves it to be moved on the next load; an avatar adopted while
 * LOCAL may exist nowhere else.
 */
export function migrateAvatarStorage(): Promise<void> {
  migrating ??= (async () => {
    if (!eventDbAvailable() || typeof localStorage === 'undefined') return
    const read = (key: string): unknown => {
      try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null } catch { return null }
    }
    const isAvatar = (e: unknown): e is NostrEvent => !!e && typeof e === 'object' && (e as NostrEvent).kind === AVATAR_KIND
    try {
      const mine = read(LEGACY_MINE_KEY) as { event?: unknown; published?: boolean } | null
      if (mine) {
        // An identity of this device: pinned, as your own always is.
        if (isAvatar(mine.event)) await callEventDb('ingest', [TAB_ID, [{ event: mine.event, nip01: 1, pin: true, acked: mine.published ?? true }]])
        localStorage.removeItem(LEGACY_MINE_KEY)
      }
    } catch { /* left for the next load */ }
    try {
      const others = read(LEGACY_OTHERS_KEY) as Record<string, { event?: unknown }> | null
      if (others) {
        const events = Object.values(others).map((k) => k?.event).filter(isAvatar)
        if (events.length > 0) await callEventDb('ingest', [TAB_ID, events.map((event) => ({ event, nip01: 1 as const, acked: true }))])
        localStorage.removeItem(LEGACY_OTHERS_KEY)
      }
    } catch { /* left for the next load */ }
  })()
  return migrating
}

/** For tests: let the migration run again, as a reload does. */
export function resetAvatarMigration(): void { migrating = null }
