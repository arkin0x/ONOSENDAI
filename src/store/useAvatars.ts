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
 * is kept in localStorage as well, per identity, so it is on screen before
 * the relay answers, and adopting a shard refuses it over the size limit, signs (with
 * a long patience, since a person is reading the prompt), publishes the
 * event unless you are LOCAL, and keeps the copy. An avatar adopted while
 * LOCAL is kept whole, and `broadcastMine` sends that same event once you
 * are LIVE. `phase` says which of those is happening, so the workshop can
 * keep the button down and say where things are.
 *
 * Newest wins, everywhere (lib/avatar avatarReplaces, NIP-01): what is drawn
 * for a pubkey is the newest avatar event seen for it, from the relays, this
 * device's copies or a signature just made, and a copy that is not newer
 * never draws over it. Your own kept copy follows the relays when they hold
 * a newer one, so an avatar adopted on another device is the one on screen
 * at the next start, not the one this device signed last (arkinox,
 * 2026-11-17: "every time I start onosendai it shows my previous avatar for
 * about 30 seconds and then finally shows my more recently updated one").
 */

import { withoutCarried } from '../lib/carried'
import { useEffect } from 'react'
import { create } from 'zustand'
import { verifyAvatar } from 'cyberspace-core'
import { AVATAR_KIND, avatarReplaces, avatarShard, avatarSize, avatarTemplate, newestAvatar } from '../lib/avatar'
import type { NostrEvent } from '../lib/events'
import { publish, query } from '../lib/relay'
import { SignerAccountMismatch } from '../lib/signers'
import { fromPayload, type ShardModel } from 'sno-core/shards'
import { keepOwnTable } from '../lib/carried'
import { useCyberspace } from './useCyberspace'

/** The one slot your own avatar was kept in before each identity had its own: still read, for the identity it names. */
const MINE_KEY = 'onosendai:avatar'
/** Where `pubkey`'s own avatar is kept on this device: one slot per identity, so switching keys and back keeps each one's. */
export function mineKey(pubkey: string): string { return `${MINE_KEY}:${pubkey}` }
const REFRESH_MS = 5 * 60_000

/** Your own avatar as kept: the event whole, and whether a relay took it. `payload` is from before the event was kept. */
interface KeptMine { pubkey?: string; payload?: unknown; event?: NostrEvent | null; published?: boolean }

/** What this device keeps as `pubkey`'s own avatar: its own slot or the older single one, whichever holds the newer event. */
function readMine(pubkey: string): KeptMine | null {
  const read = (key: string): KeptMine | null => {
    try {
      const raw = localStorage.getItem(key)
      const kept = raw ? (JSON.parse(raw) as KeptMine) : null
      return kept && kept.pubkey === pubkey && (!kept.event || kept.event.pubkey === pubkey) ? kept : null
    } catch { return null }
  }
  const own = read(mineKey(pubkey))
  const legacy = read(MINE_KEY)
  if (!own || !legacy) return own ?? legacy
  return legacy.event && avatarReplaces(legacy.event, own.event) ? legacy : own
}

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

/** The kept avatar events still fresh at `now`, by pubkey, a dodecahedron's included. */
export function loadAvatarCacheEvents(now = Date.now()): Record<string, NostrEvent> {
  try {
    const raw = localStorage.getItem(AVATARS_CACHE_KEY)
    const kept = raw ? (JSON.parse(raw) as Record<string, KeptAvatar>) : {}
    const out: Record<string, NostrEvent> = {}
    for (const [pubkey, k] of Object.entries(kept ?? {})) {
      if (!k?.event || k.event.pubkey !== pubkey || k.event.kind !== AVATAR_KIND || !(now - k.at <= AVATARS_CACHE_MAX_AGE_MS)) continue
      out[pubkey] = k.event
    }
    return out
  } catch { return {} }
}

/** The kept avatars still fresh at `now`, as shards by pubkey. */
export function loadAvatarCache(now = Date.now()): Record<string, ShardModel | null> {
  const out: Record<string, ShardModel | null> = {}
  for (const [pubkey, event] of Object.entries(loadAvatarCacheEvents(now))) {
    const shard = avatarShard(event)
    if (shard) out[pubkey] = shard
  }
  return out
}

/**
 * Keep `event` as its author's avatar, fetched at `now`; the oldest fall off
 * past AVATARS_KEPT. A kept event newer than `event` stays (avatarReplaces):
 * a relay that is behind does not take a newer shape off the device.
 */
export function keepAvatar(event: NostrEvent, now = Date.now()): void {
  try {
    const raw = localStorage.getItem(AVATARS_CACHE_KEY)
    const old = raw ? (JSON.parse(raw) as Record<string, KeptAvatar>) : {}
    const prior = old[event.pubkey]?.event
    const winner = prior && prior.pubkey === event.pubkey && avatarReplaces(prior, event) ? prior : event
    const kept = { ...old, [event.pubkey]: { event: winner, at: now } }
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
  /**
   * By pubkey: the avatar event the drawn shape comes from, the newest seen
   * from the relays, this device's copies or your own signature (the avatar
   * card's event data). A copy that does not replace it (avatarReplaces) is
   * not drawn.
   */
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
  /** Your own from localStorage, before the relay answers, unless something newer is already drawn. */
  loadMine: () => void
}

type Held = Pick<AvatarsState, 'shards' | 'events' | 'mineEvent' | 'minePublished'>

/**
 * `held` with `me`'s own kept avatar taken in: drawn when it is the newest
 * copy here; when the copy already drawn is newer (it came from a relay),
 * that one becomes yours, published, and is kept in place of the old.
 */
function withMine(held: Held, me: string): Partial<Held> {
  const kept = readMine(me)
  if (!kept) return {}
  const drawn = held.events[me]
  if (kept.event) {
    if (drawn && avatarReplaces(drawn, kept.event)) {
      remember(drawn, true)
      return { shards: { ...held.shards, [me]: avatarShard(drawn) }, mineEvent: drawn, minePublished: true }
    }
    // The kept event is checked as everyone else's is, so you are not drawn
    // in a shape no one else sees.
    return {
      shards: { ...held.shards, [me]: avatarShard(kept.event) },
      events: { ...held.events, [me]: kept.event },
      mineEvent: kept.event,
      // Anything kept before this field existed was published as it was adopted.
      minePublished: kept.published ?? true,
    }
  }
  // Only a payload, kept before the event was: drawn when nothing else is.
  if (drawn || !kept.payload) return {}
  // sno-core's fromPayload turns a version 1 payload's eye into the version 2 frame itself.
  const read = fromPayload(kept.payload, `avatar:${me}`)
  return { shards: { ...held.shards, [me]: read && keepOwnTable(read, me) }, minePublished: kept.published ?? true }
}

/**
 * What is drawn the moment the store is made, before any effect runs or any
 * relay answers: everyone's kept avatars, and your own kept one, newest wins.
 * No frame shows a shape the device already knows to be old.
 */
function heldAtStart(): Held {
  const events = loadAvatarCacheEvents()
  const shards: Record<string, ShardModel | null> = {}
  for (const [pubkey, event] of Object.entries(events)) {
    const shard = avatarShard(event)
    if (shard) shards[pubkey] = shard
  }
  const held: Held = { shards, events, mineEvent: null, minePublished: false }
  let me = ''
  try { me = useCyberspace.getState().identity.pubkey } catch { /* not made yet: App's loadMine takes it in */ }
  return me ? { ...held, ...withMine(held, me) } : held
}

export const useAvatars = create<AvatarsState>((set, get) => ({
  // Kept shapes first; `asked` stays empty, so each is still refreshed.
  ...heldAtStart(),
  asked: {},
  phase: null,
  adoptError: null,

  ensure: (pubkey) => {
    const now = Date.now()
    const last = get().asked[pubkey] ?? 0
    if (now - last < REFRESH_MS) return
    set({ asked: { ...get().asked, [pubkey]: now } })
    query({ kinds: [AVATAR_KIND], authors: [pubkey] })
      .then((events) => {
        const newest = newestAvatar(events.filter((e) => e.pubkey === pubkey && e.kind === AVATAR_KIND))
        // An empty answer says nothing: a relay that is down, or has not seen
        // the event yet, must not turn a known avatar back into the dodecahedron.
        if (!newest) {
          if (!(pubkey in get().shards)) set({ shards: { ...get().shards, [pubkey]: null } })
          return
        }
        const s = get()
        const mine = pubkey === useCyberspace.getState().identity.pubkey
        // Older than what is drawn (a relay that is behind, or one LOCAL
        // avatar not yet sent): the newer stays, and nothing is kept over it.
        const held = newestAvatar([s.events[pubkey], mine ? s.mineEvent : null])
        if (held && avatarReplaces(held, newest)) return
        set({ shards: { ...s.shards, [pubkey]: avatarShard(newest) }, events: { ...s.events, [pubkey]: newest } })
        // Yours is kept whole in its own slot; everyone else's here, a
        // dodecahedron included, so a dropped shape is not drawn from the cache.
        if (!mine) { keepAvatar(newest); return }
        // A relay holds this one, so it is yours and published, and it is the
        // copy drawn at the next start: it may come from another device.
        set({ mineEvent: newest, minePublished: true })
        remember(newest, true)
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
    // Later than any avatar held for you, so it replaces it everywhere
    // (avatarReplaces), even one adopted this same second or on a device
    // whose clock runs ahead.
    const held = newestAvatar([get().events[me], get().mineEvent])
    const template = avatarTemplate(shard, Math.max(Math.floor(Date.now() / 1000), held ? held.created_at + 1 : 0))
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
      set({ phase: null, shards: { ...get().shards, [me]: shard }, events: { ...get().events, [me]: event }, asked: { ...get().asked, [me]: Date.now() }, mineEvent: event, minePublished: false })
      remember(event, false)
      return true
    }
    set({ phase: 'publishing' })
    const result = await publish(event)
    // Switched identity while the relays answered: kept for the identity that
    // signed it, and not drawn as the one on screen now.
    if (useCyberspace.getState().identity.pubkey !== me) {
      set({ phase: null })
      remember(event, result.ok)
      return result.ok
    }
    if (!result.ok) {
      set({ phase: null, mineEvent: event, minePublished: false, adoptError: 'No relay took the avatar. Try again when one is reachable.' })
      remember(event, false)
      return false
    }
    set({ phase: null, shards: { ...get().shards, [me]: shard }, events: { ...get().events, [me]: event }, asked: { ...get().asked, [me]: Date.now() }, mineEvent: event, minePublished: true })
    remember(event, true)
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
    if (useCyberspace.getState().identity.pubkey !== event.pubkey) {
      set({ phase: null })
      remember(event, true)
      return true
    }
    set({ phase: null, minePublished: true, asked: { ...get().asked, [event.pubkey]: Date.now() } })
    remember(event, true)
    return true
  },

  loadMine: () => {
    const me = useCyberspace.getState().identity.pubkey
    try { set(withMine(get(), me)) } catch { /* nothing kept */ }
  },
}))

/**
 * Keep `event` as its author's own avatar, in that identity's slot (mineKey),
 * unless the slot already holds a newer one.
 */
function remember(event: NostrEvent, published: boolean): void {
  const prior = readMine(event.pubkey)?.event
  if (prior && avatarReplaces(prior, event)) return
  // Kept whole, signature and all, so an avatar adopted while LOCAL can
  // be broadcast later without asking the signer again.
  const kept = JSON.stringify({ pubkey: event.pubkey, event, published })
  const key = mineKey(event.pubkey)
  try {
    localStorage.setItem(key, kept)
  } catch {
    // Full: everyone else's kept avatars give way to yours, which may exist nowhere else.
    try {
      localStorage.removeItem(AVATARS_CACHE_KEY)
      localStorage.setItem(key, kept)
    } catch { /* private mode */ }
  }
}

let unwatchMine: (() => void) | null = null

/**
 * Take your own kept avatar in now and again on every identity switch (a
 * new key, a login, signing out), so each identity is drawn as its own and
 * BROADCAST never offers another identity's avatar. Started once, by App.
 */
export function watchMyAvatar(): () => void {
  useAvatars.getState().loadMine()
  unwatchMine ??= useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey === prev.identity.pubkey) return
    useAvatars.setState({ mineEvent: null, minePublished: false, adoptError: null })
    useAvatars.getState().loadMine()
  })
  return () => { unwatchMine?.(); unwatchMine = null }
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
