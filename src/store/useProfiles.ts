/**
 * useProfiles.ts — who a pubkey is, cached.
 *
 * A pubkey is intelligible only with its kind:0: a name, a picture, maybe a
 * nip05. Components ask for one by pubkey; this batches the misses into
 * queries of CHUNK authors, caches what comes back, and keeps it on the
 * device (IndexedDB, lib/deviceCache.ts; localStorage until 2026-11, moved
 * once by takeLocal) so a reload paints names at once and then refreshes them.
 * Profiles live on the general relays (primal, damus, nos.lol), so it asks
 * those alongside every configured one: the cyberspace relay and any you
 * added. Each relay is asked on its own (relay.ts askEach) and each profile
 * lands the moment a relay sends it, so a slow relay never holds back the
 * names a fast one already gave.
 *
 * A kind 0 is replaceable, so one rule decides which copy is kept
 * (newerProfile): the newer created_at; on a tie, NIP-01's lowest id; and
 * the same event again is taken, so a change in how it is parsed reaches a
 * cache that already holds it. An older copy, or a fetch that found
 * nothing, never replaces a profile in hand.
 *
 * The whole cache is one reactive record: a component that reads get(pubkey)
 * re-renders when that profile arrives, without every row holding a
 * subscription of its own.
 */

import { create } from 'zustand'
import { askEach, relaySet } from '../lib/relay'
import { GENERAL_RELAYS } from '../lib/contacts'
import type { NostrEvent } from '../lib/events'
import { readCached, takeLocal, writeCachedSoon } from '../lib/deviceCache'

export interface Profile {
  pubkey: string
  name: string | null
  picture: string | null
  about: string | null
  nip05: string | null
  /** created_at of the kind:0 we parsed, so a newer one wins. */
  at: number
  /** The kind:0's id, for NIP-01's tie rule; absent on a profile cached before it was kept. */
  id?: string
  /**
   * The kind:0 says `bot: true`: an agent (lib/agentInvite.ts isBotProfile).
   * Present only when true, so the chat's @ list can badge it (arkinox, 2026-10-11).
   */
  bot?: true
  /**
   * For a bot, the pubkey its kind:0 names as operator: a `p` tag marked
   * `operator` in its last place (lib/agentInvite.ts isOperatorTag). Shown on
   * the avatar's profile card; a one-sided claim, so it says who the agent
   * names, nothing more (arkinox, 2026-10-11).
   */
  operator?: string
}

interface ProfilesState {
  /** null = fetched, none found; undefined = not fetched. */
  profiles: Record<string, Profile | null>
  /** Ask for a profile; a miss is queued and fetched in the next batch. */
  request: (pubkey: string) => void
  get: (pubkey: string) => Profile | null | undefined
  /** A kind 0 in hand (one you just published): cached now, not after the next batch. */
  remember: (ev: NostrEvent) => void
}

/** Where older builds kept the profiles: moved to the device cache once (takeLocal). */
const STORAGE = 'onosendai:profiles'
/** The device cache's record for them. */
export const PROFILES_CACHE_KEY = 'profiles'
const HEX = /^[0-9a-f]{64}$/
/** Refetch a cached profile after this, in case it changed. */
const TTL_MS = 24 * 60 * 60 * 1000
/** How many authors to ask for in one query. */
export const CHUNK = 100
/** How many of those queries are out at once: a relay caps the subscriptions one connection may hold. */
const CHUNKS_AT_ONCE = 2
const FLUSH_MS = 250
/** Profiles arriving from relays are applied together, this often, rather than one render each. */
const APPLY_MS = 50
/** The most profiles kept on the device: the ones fetched most recently this session first. */
export const PROFILES_KEPT = 1000
/** Profiles live on the general relays; the cyberspace relay is auth-gated and
 * slow, and rarely holds kind:0, so a short wait on the general set is enough. */
const PROFILE_WAIT_MS = 4000

/** Only well-formed profiles from a kept record, by pubkey. */
function keptProfiles(data: unknown): Record<string, Profile> {
  const out: Record<string, Profile> = {}
  if (!data || typeof data !== 'object') return out
  for (const [pk, p] of Object.entries(data as Record<string, unknown>)) {
    const x = p as Profile
    if (HEX.test(pk) && x && typeof x === 'object' && x.pubkey === pk && typeof x.at === 'number') out[pk] = x
  }
  return out
}

/** What an older build left in localStorage, moved to the device cache (takeLocal): read now, so the first frame has the names. */
function loadCache(): Record<string, Profile | null> {
  return keptProfiles(takeLocal(STORAGE, PROFILES_CACHE_KEY))
}

/** Keep the profiles shortly: the record as it stands when the write goes (lib/deviceCache.ts writeCachedSoon), flushed when the page is hidden. */
function saveCacheSoon(): void {
  writeCachedSoon(PROFILES_CACHE_KEY, () => profilesToKeep(useProfiles.getState().profiles))
}

/**
 * The profiles worth persisting: only real ones (a miss can be retried), at
 * most PROFILES_KEPT, those fetched this session first, newest fetch first.
 * Unbounded, the record grew with every key ever seen until localStorage
 * refused the write, and then no profile was saved at all.
 */
export function profilesToKeep(cache: Record<string, Profile | null>, stamps: Map<string, number> = withStamp): Record<string, Profile> {
  const real = Object.entries(cache).filter((e): e is [string, Profile] => e[1] !== null)
  const kept = real.length <= PROFILES_KEPT ? real : real.sort((a, b) => (stamps.get(b[0]) ?? 0) - (stamps.get(a[0]) ?? 0)).slice(0, PROFILES_KEPT)
  return Object.fromEntries(kept)
}

/**
 * Whether `incoming` should replace `have` (NIP-01, replaceable events): a
 * newer created_at wins and an older one never does; on the same second the
 * lowest id is kept. The same event again is taken, since a fresh parse of
 * it may read more than the cached one did (a cached profile whose parse
 * predates a parser fix must still be able to get the fix), and so is a
 * same-second copy when the cached one has no id to compare.
 */
export function newerProfile(have: Profile | null | undefined, incoming: Profile): boolean {
  if (!have) return true
  if (incoming.at !== have.at) return incoming.at > have.at
  if (!incoming.id || !have.id || incoming.id === have.id) return true
  return incoming.id < have.id
}

/** The pubkey a kind:0's `p` tag marked `operator` names, if any. */
export function operatorOf(tags: readonly string[][] | undefined): string | null {
  const t = (tags ?? []).find((tag) => tag.length >= 3 && tag[0] === 'p' && /^[0-9a-f]{64}$/.test(tag[1] ?? '') && tag[tag.length - 1] === 'operator')
  return t ? t[1] : null
}

/** Parse a kind:0 into a Profile; null if the content is not usable JSON. */
export function parseProfile(ev: NostrEvent): Profile | null {
  try {
    const meta = JSON.parse(ev.content) as Record<string, unknown>
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return {
      pubkey: ev.pubkey,
      name: str(meta.display_name) ?? str(meta.name),
      picture: str(meta.picture),
      about: str(meta.about),
      nip05: str(meta.nip05),
      at: ev.created_at,
      id: ev.id,
      ...(meta.bot === true ? { bot: true as const } : {}),
      ...(meta.bot === true && operatorOf(ev.tags) ? { operator: operatorOf(ev.tags) as string } : {}),
    }
  } catch { return null }
}

/** Asked for and waiting for the next batch. */
const pending = new Set<string>()
/** In a batch whose relays have not all answered yet: not asked for again meanwhile. */
const inFlight = new Set<string>()
let flushHandle: number | null = null

export const useProfiles = create<ProfilesState>((set, get) => {
  const initial = loadCache()

  /** Profiles that have arrived and are not yet in the record, newest copy per pubkey. */
  const staged = new Map<string, Profile>()
  let applyHandle: ReturnType<typeof setTimeout> | null = null

  function apply(): void {
    if (applyHandle !== null) { clearTimeout(applyHandle); applyHandle = null }
    if (staged.size === 0) return
    const cur = get().profiles
    let next: Record<string, Profile | null> | null = null
    for (const [pk, p] of staged) {
      if (!newerProfile(cur[pk], p)) continue
      next ??= { ...cur }
      next[pk] = p
    }
    staged.clear()
    if (!next) return
    set({ profiles: next })
    saveCacheSoon()
  }

  /** One kind 0 from a relay: staged if it is the newest copy seen, applied with the others shortly. */
  function take(ev: NostrEvent, authors: Set<string>): void {
    if (ev.kind !== 0 || !authors.has(ev.pubkey)) return
    const p = parseProfile(ev)
    if (!p || !newerProfile(staged.get(p.pubkey), p)) return
    staged.set(p.pubkey, p)
    applyHandle ??= setTimeout(apply, APPLY_MS)
  }

  async function fetchChunk(authors: string[]): Promise<void> {
    const wanted = new Set(authors)
    let answers: Awaited<ReturnType<typeof askEach>> = []
    try {
      answers = await askEach([...new Set([...GENERAL_RELAYS, ...relaySet()])], { kinds: [0], authors }, (ev) => take(ev, wanted), { maxWait: PROFILE_WAIT_MS, skipDead: true })
    } catch { /* relays down */ }
    apply()
    // Only an answer says "none": a key no relay could be asked about stays
    // unknown and is asked again, and a profile in hand is never replaced by
    // a fetch that found nothing.
    if (!answers.some((a) => a.outcome === 'answered')) return
    const now = Date.now()
    const cur = get().profiles
    let next: Record<string, Profile | null> | null = null
    for (const pk of authors) {
      withStamp.set(pk, now)
      if (cur[pk] !== undefined) continue
      next ??= { ...cur }
      next[pk] = null
    }
    if (next) set({ profiles: next })
  }

  async function flush(): Promise<void> {
    flushHandle = null
    const want = [...pending]
    pending.clear()
    if (want.length === 0) return
    for (const pk of want) inFlight.add(pk)
    const chunks: string[][] = []
    for (let i = 0; i < want.length; i += CHUNK) chunks.push(want.slice(i, i + CHUNK))
    // CHUNKS_AT_ONCE at a time, each relay answering each on its own.
    const next = async (): Promise<void> => {
      for (let authors = chunks.shift(); authors; authors = chunks.shift()) {
        try { await fetchChunk(authors) } finally { for (const pk of authors) inFlight.delete(pk) }
      }
    }
    await Promise.all(Array.from({ length: CHUNKS_AT_ONCE }, next))
  }

  return {
    profiles: initial,

    request: (pubkey) => {
      if (!HEX.test(pubkey)) return
      const have = get().profiles[pubkey]
      const stamp = withStamp.get(pubkey)
      const fresh = have && stamp !== undefined && Date.now() - stamp < TTL_MS
      if (fresh || pending.has(pubkey) || inFlight.has(pubkey)) return
      pending.add(pubkey)
      if (flushHandle === null) flushHandle = window.setTimeout(() => void flush(), FLUSH_MS)
    },

    get: (pubkey) => get().profiles[pubkey],

    remember: (ev) => {
      if (ev.kind !== 0) return
      const p = parseProfile(ev)
      if (!p) return
      const have = get().profiles[ev.pubkey]
      // A newer kind 0 than the one just handed in is already the truth.
      if (!newerProfile(have, p)) return
      const next = { ...get().profiles, [ev.pubkey]: p }
      set({ profiles: next })
      saveCacheSoon()
    },
  }
})

if (import.meta.env.DEV && typeof window !== "undefined") { (window as unknown as { __profiles?: unknown }).__profiles = useProfiles }

/**
 * The profiles kept on the device, read into the record once at start, a
 * moment after the first frame: newest wins per pubkey (newerProfile), so a
 * profile a relay already gave this visit is never replaced by an older kept one.
 */
export const profilesHydrated: Promise<void> = readCached(PROFILES_CACHE_KEY).then((data) => {
  const kept = keptProfiles(data)
  const cur = useProfiles.getState().profiles
  let next: Record<string, Profile | null> | null = null
  for (const [pk, p] of Object.entries(kept)) {
    if (cur[pk] !== undefined && cur[pk] !== null && !newerProfile(cur[pk], p)) continue
    if (cur[pk] && cur[pk]!.id === p.id && cur[pk]!.at === p.at) continue
    next ??= { ...cur }
    next[pk] = p
  }
  if (next) {
    useProfiles.setState({ profiles: next })
    // Kept is not fetched: a kept profile is still asked for again this visit, as before.
    for (const pk of Object.keys(kept)) if (next[pk] === kept[pk]) withStamp.delete(pk)
  }
  // The merged record, in place of any write made before the kept one was read.
  saveCacheSoon()
}, () => undefined)

/** When each profile was fetched, so the TTL can refetch a stale one. */
const withStamp = new Map<string, number>()
useProfiles.subscribe((s, prev) => {
  if (s.profiles === prev.profiles) return
  const now = Date.now()
  for (const pk of Object.keys(s.profiles)) if (s.profiles[pk] !== prev.profiles[pk]) withStamp.set(pk, now)
})

/** A short, human label for a pubkey: its name, or a shortened npub. */
export function profileLabel(profile: Profile | null | undefined, npub: string): string {
  return profile?.name ?? `${npub.slice(0, 12)}…${npub.slice(-4)}`
}
