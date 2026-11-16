/**
 * useAvatars.ts - who looks like what.
 *
 * Every avatar drawn asks here for its shape: the kind 11333 event of that
 * pubkey (lib/avatar), fetched once and refreshed now and then, null meaning
 * the dodecahedron. An avatar is drawn only when it is one (spec 8.10,
 * cyberspace-core's verifyAvatar): kind 11333, content within the 128 KB size
 * limit, a shard payload this client can read. Anything else is the
 * dodecahedron to everyone. There is no work to check: a nonce tag on an
 * avatar published while avatars were paid for in work is ignored. Your own
 * is kept in localStorage as well, so it is on screen before the relay
 * answers, and adopting a shard refuses it over the size limit, signs (with
 * a long patience, since a person is reading the prompt), publishes the
 * event unless you are LOCAL, and keeps the copy. An avatar adopted while
 * LOCAL is kept whole, and `broadcastMine` sends that same event once you
 * are LIVE. `phase` says which of those is happening, so the workshop can
 * keep the button down and say where things are.
 */

import { withoutCarried } from '../lib/carried'
import { useEffect } from 'react'
import { create } from 'zustand'
import { verifyAvatar } from 'cyberspace-core'
import { AVATAR_KIND, avatarShard, avatarSize, avatarTemplate } from '../lib/avatar'
import type { NostrEvent } from '../lib/events'
import { publish, query } from '../lib/relay'
import { SignerAccountMismatch } from '../lib/signers'
import { fromPayload, toPayload, type ShardModel } from 'sno-core/shards'
import { keepOwnTable } from '../lib/carried'
import { useCyberspace } from './useCyberspace'

const MINE_KEY = 'onosendai:avatar'
const REFRESH_MS = 5 * 60_000

/**
 * Everyone else's avatar events, kept on the device so a reload draws the
 * people around you in their own shapes at once, not as dodecahedra until
 * the relay answers (arkinox, 2026-10-12: "when I refresh the page XOR
 * disappears until it loads"). Read synchronously as the store is made;
 * `ensure` still asks the relay, which replaces a kept shape with a newer one.
 * The whole event is kept and checked again on load (avatarShard), so the
 * cache cannot draw a shape the relay copy would not.
 */
export const AVATARS_CACHE_KEY = 'onosendai:avatars'
/** The most avatars kept, the most recently fetched first: shards can be large, and localStorage is a few megabytes. */
export const AVATARS_KEPT = 60
/**
 * The most characters the kept avatars take, the newest kept first: an avatar
 * may be up to 128 KB, and sixty of those would fill localStorage and leave
 * no room for your own (remember).
 */
export const AVATARS_KEPT_CHARS = 1_500_000
/** An avatar fetched longer ago than this is not drawn from the cache. */
export const AVATARS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface KeptAvatar { event: NostrEvent; at: number }

/** The kept avatars still fresh at `now`, as shards by pubkey. */
export function loadAvatarCache(now = Date.now()): Record<string, ShardModel | null> {
  try {
    const raw = localStorage.getItem(AVATARS_CACHE_KEY)
    const kept = raw ? (JSON.parse(raw) as Record<string, KeptAvatar>) : {}
    const out: Record<string, ShardModel | null> = {}
    for (const [pubkey, k] of Object.entries(kept ?? {})) {
      if (!k?.event || k.event.pubkey !== pubkey || !(now - k.at <= AVATARS_CACHE_MAX_AGE_MS)) continue
      const shard = avatarShard(k.event)
      if (shard) out[pubkey] = shard
    }
    return out
  } catch { return {} }
}

/** Keep `event` as its author's avatar, fetched at `now`; the oldest fall off past AVATARS_KEPT. */
export function keepAvatar(event: NostrEvent, now = Date.now()): void {
  try {
    const raw = localStorage.getItem(AVATARS_CACHE_KEY)
    const kept = { ...(raw ? (JSON.parse(raw) as Record<string, KeptAvatar>) : {}), [event.pubkey]: { event, at: now } }
    let chars = 0
    const newest = Object.entries(kept).sort((a, b) => b[1].at - a[1].at).slice(0, AVATARS_KEPT)
    const trimmed = Object.fromEntries(newest.filter(([, k], i) => { chars += JSON.stringify(k).length; return i === 0 || chars <= AVATARS_KEPT_CHARS }))
    localStorage.setItem(AVATARS_CACHE_KEY, JSON.stringify(trimmed))
  } catch { /* quota or private mode */ }
}

/** Where an adopt is: the signer, then the relays. */
export type AdoptPhase = 'signing' | 'publishing'

/** How long to wait for a remote signer here: a person is reading the prompt, not a hop. */
export const AVATAR_SIGN_PATIENCE_MS = 120_000

interface AvatarsState {
  /** By pubkey: the shard, null for the dodecahedron; absent until asked. */
  shards: Record<string, ShardModel | null>
  /** By pubkey: the avatar event the relay answered with this session (the avatar card's event data). */
  events: Record<string, NostrEvent>
  /** When each pubkey was last asked for, so the relay is not asked per frame. */
  asked: Record<string, number>
  /** Your own avatar event, signed and kept, whether or not a relay has it. */
  mineEvent: NostrEvent | null
  /** Whether a relay took your avatar. False for one adopted while LOCAL. */
  minePublished: boolean
  /** What adopt is doing now, null when idle; the button stays down through all of it. */
  phase: AdoptPhase | null
  /** Why the last adopt failed, for the notice; null when it succeeded or was cancelled. */
  adoptError: string | null
  /** Look a pubkey's avatar up, once per refresh window. */
  ensure: (pubkey: string) => void
  /** Publish this shard as your avatar (null for the dodecahedron); true when a relay took it. */
  adopt: (shard: ShardModel | null) => Promise<boolean>
  /** Send the avatar you adopted while LOCAL to the relays now. */
  broadcastMine: () => Promise<boolean>
  /** Your own from localStorage, before the relay answers. */
  loadMine: () => void
}

export const useAvatars = create<AvatarsState>((set, get) => ({
  // Kept shapes first; `asked` stays empty, so each is still refreshed.
  shards: loadAvatarCache(),
  events: {},
  asked: {},
  mineEvent: null,
  minePublished: false,
  phase: null,
  adoptError: null,

  ensure: (pubkey) => {
    const now = Date.now()
    const last = get().asked[pubkey] ?? 0
    if (now - last < REFRESH_MS) return
    set({ asked: { ...get().asked, [pubkey]: now } })
    query({ kinds: [AVATAR_KIND], authors: [pubkey] })
      .then((events) => {
        const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0]
        // An empty answer says nothing: a relay that is down, or has not seen
        // the event yet, must not turn a known avatar back into the dodecahedron.
        if (!newest) {
          if (!(pubkey in get().shards)) set({ shards: { ...get().shards, [pubkey]: null } })
          return
        }
        const shard = avatarShard(newest)
        set({ shards: { ...get().shards, [pubkey]: shard }, events: { ...get().events, [pubkey]: newest } })
        const mine = pubkey === useCyberspace.getState().identity.pubkey
        // Yours is kept whole under MINE_KEY; everyone else's here, a
        // dodecahedron included, so a dropped shape is not drawn from the cache.
        if (!mine) keepAvatar(newest)
        if (mine) {
          // The relay has it, so it is published, whatever this device thought.
          set({ minePublished: true })
          remember(shard, get().mineEvent, true)
        }
      })
      .catch(() => { if (!(pubkey in get().shards)) set({ shards: { ...get().shards, [pubkey]: null } }) })
  },

  adopt: async (chosen) => {
    // An avatar is public: what came to you sealed stays out of it.
    const shard = chosen ? withoutCarried(chosen) : chosen
    // One adopt at a time, through signing and publishing: a second press
    // while the signer's prompt is open would ask again.
    if (get().phase) return false
    if (chosen && shard && shard !== chosen && shard.vertices.length === 0 && (shard.parts?.length ?? 0) === 0) {
      set({ adoptError: 'Without what came to you sealed, this shard has no vertices and places nothing.' })
      return false
    }
    const cs = useCyberspace.getState()
    const me = cs.identity.pubkey
    const template = avatarTemplate(shard, Math.floor(Date.now() / 1000))
    // Over the size limit no client draws it (spec 8.10), so it is not signed.
    if (shard && avatarSize(template.content).over) {
      set({ adoptError: 'This shard is over the 128 KB size limit for an avatar.' })
      return false
    }
    set({ adoptError: null, phase: 'signing' })
    let event
    try {
      event = await cs.signEvent(template, AVATAR_SIGN_PATIENCE_MS)
    } catch (err) {
      // Signed as another account, it would be someone else's avatar: say that.
      set({ phase: null, adoptError: err instanceof SignerAccountMismatch ? err.message : 'The signer did not sign the avatar.' })
      return false
    }
    // What the signer returned must still be an avatar every client draws.
    if (shard && !verifyAvatar(event).ok) {
      set({ phase: null, adoptError: 'The signer returned an avatar no client can draw. Try again.' })
      return false
    }
    // LOCAL means LOCAL. The avatar is signed, kept and drawn for you, and it
    // goes out the moment you broadcast it or adopt again while LIVE; publishing
    // it anyway would have been the one action that ignored the setting.
    if (!cs.live) {
      set({ phase: null, shards: { ...get().shards, [me]: shard }, asked: { ...get().asked, [me]: Date.now() }, mineEvent: event, minePublished: false })
      remember(shard, event, false)
      return true
    }
    set({ phase: 'publishing' })
    const result = await publish(event)
    if (!result.ok) {
      set({ phase: null, mineEvent: event, minePublished: false, adoptError: 'No relay took the avatar. Try again when one is reachable.' })
      remember(shard, event, false)
      return false
    }
    set({ phase: null, shards: { ...get().shards, [me]: shard }, asked: { ...get().asked, [me]: Date.now() }, mineEvent: event, minePublished: true })
    remember(shard, event, true)
    return true
  },

  broadcastMine: async () => {
    const cs = useCyberspace.getState()
    const event = get().mineEvent
    if (!event) return false
    if (!cs.live) {
      set({ adoptError: 'Nothing is published while you are LOCAL. Switch to LIVE and try again.' })
      return false
    }
    if (get().phase) return false
    set({ phase: 'publishing', adoptError: null })
    const result = await publish(event)
    if (!result.ok) {
      set({ phase: null, adoptError: 'No relay took the avatar. Try again when one is reachable.' })
      return false
    }
    const shard = get().shards[cs.identity.pubkey] ?? null
    set({ phase: null, minePublished: true, asked: { ...get().asked, [cs.identity.pubkey]: Date.now() } })
    remember(shard, event, true)
    return true
  },

  loadMine: () => {
    const me = useCyberspace.getState().identity.pubkey
    try {
      const raw = localStorage.getItem(MINE_KEY)
      if (!raw) return
      const kept = JSON.parse(raw) as { pubkey?: string; payload?: unknown; event?: NostrEvent; published?: boolean }
      if (kept.pubkey !== me) return
      // The kept event is checked as everyone else's is, so you are not drawn
      // in a shape no one else sees; the payload only for a copy kept before
      // the event was.
      const read = kept.event ? null : kept.payload ? fromPayload(kept.payload, `avatar:${me}`) : null
      const shard = kept.event ? avatarShard(kept.event) : read && keepOwnTable(read, me)
      set({
        shards: { ...get().shards, [me]: shard },
        mineEvent: kept.event ?? null,
        // Anything kept before this field existed was published as it was adopted.
        minePublished: kept.published ?? true,
      })
    } catch { /* nothing kept */ }
  },
}))

function remember(shard: ShardModel | null, event: NostrEvent | null, published: boolean): void {
  const kept = JSON.stringify({
    pubkey: useCyberspace.getState().identity.pubkey,
    payload: shard ? toPayload(shard) : null,
    // Kept whole, signature and all, so an avatar adopted while LOCAL can
    // be broadcast later without asking the signer again.
    event,
    published,
  })
  try {
    localStorage.setItem(MINE_KEY, kept)
  } catch {
    // Full: everyone else's kept avatars give way to yours, which may exist nowhere else.
    try {
      localStorage.removeItem(AVATARS_CACHE_KEY)
      localStorage.setItem(MINE_KEY, kept)
    } catch { /* private mode */ }
  }
}

/** The shard a pubkey is drawn as, or null for the dodecahedron; asks the relay as needed. */
export function useAvatarShard(pubkey: string): ShardModel | null {
  const shard = useAvatars((s) => s.shards[pubkey])
  useEffect(() => { if (pubkey) useAvatars.getState().ensure(pubkey) }, [pubkey])
  return shard ?? null
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __avatars?: unknown }).__avatars = useAvatars
}
