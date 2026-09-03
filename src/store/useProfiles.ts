/**
 * useProfiles.ts — who a pubkey is, cached.
 *
 * A pubkey is intelligible only with its kind:0: a name, a picture, maybe a
 * nip05. Components ask for one by pubkey; this batches the misses into a
 * single relay query, caches what comes back, and keeps it in localStorage so
 * a reload does not refetch the world. Profiles live on the general relays
 * (primal, damus, nos.lol), so it asks those alongside every configured one:
 * the cyberspace relay and any you added.
 *
 * The whole cache is one reactive record: a component that reads get(pubkey)
 * re-renders when that profile arrives, without every row holding a
 * subscription of its own.
 */

import { create } from 'zustand'
import { queryAny, relaySet } from '../lib/relay'
import { GENERAL_RELAYS } from '../lib/contacts'
import type { NostrEvent } from '../lib/events'

export interface Profile {
  pubkey: string
  name: string | null
  picture: string | null
  about: string | null
  nip05: string | null
  /** created_at of the kind:0 we parsed, so a newer one wins. */
  at: number
}

interface ProfilesState {
  /** null = fetched, none found; undefined = not fetched. */
  profiles: Record<string, Profile | null>
  /** Ask for a profile; a miss is queued and fetched in the next batch. */
  request: (pubkey: string) => void
  get: (pubkey: string) => Profile | null | undefined
}

const STORAGE = 'onosendai:profiles'
const HEX = /^[0-9a-f]{64}$/
/** Refetch a cached profile after this, in case it changed. */
const TTL_MS = 24 * 60 * 60 * 1000
/** How many authors to ask for in one query. */
const CHUNK = 100
const FLUSH_MS = 250
/** Profiles live on the general relays; the cyberspace relay is auth-gated and
 * slow, and rarely holds kind:0, so a short wait on the general set is enough. */
const PROFILE_WAIT_MS = 4000

function loadCache(): Record<string, Profile | null> {
  try {
    const raw = localStorage.getItem(STORAGE)
    const data = raw ? JSON.parse(raw) : {}
    return data && typeof data === 'object' ? data : {}
  } catch { return {} }
}

let saveHandle: number | null = null
function saveCacheSoon(cache: Record<string, Profile | null>): void {
  if (saveHandle !== null) return
  saveHandle = window.setTimeout(() => {
    saveHandle = null
    try {
      // Only real profiles are worth persisting; misses can be retried.
      const keep: Record<string, Profile> = {}
      for (const [pk, p] of Object.entries(cache)) if (p) keep[pk] = p
      localStorage.setItem(STORAGE, JSON.stringify(keep))
    } catch { /* quota or private mode */ }
  }, 1000)
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
    }
  } catch { return null }
}

const pending = new Set<string>()
let flushHandle: number | null = null

export const useProfiles = create<ProfilesState>((set, get) => {
  const initial = loadCache()

  async function flush(): Promise<void> {
    flushHandle = null
    const want = [...pending]
    pending.clear()
    if (want.length === 0) return

    for (let i = 0; i < want.length; i += CHUNK) {
      const authors = want.slice(i, i + CHUNK)
      let events: NostrEvent[] = []
      try {
        events = await queryAny([...new Set([...GENERAL_RELAYS, ...relaySet()])], { kinds: [0], authors }, PROFILE_WAIT_MS)
      } catch { /* relays down */ }

      const newest = new Map<string, Profile>()
      for (const ev of events) {
        const p = parseProfile(ev)
        if (p && (!newest.has(p.pubkey) || p.at > newest.get(p.pubkey)!.at)) newest.set(p.pubkey, p)
      }
      const next = { ...get().profiles }
      for (const pk of authors) next[pk] = newest.get(pk) ?? null
      set({ profiles: next })
      saveCacheSoon(next)
    }
  }

  return {
    profiles: initial,

    request: (pubkey) => {
      if (!HEX.test(pubkey)) return
      const have = get().profiles[pubkey]
      const stamp = withStamp.get(pubkey)
      const fresh = have && stamp !== undefined && Date.now() - stamp < TTL_MS
      if (fresh || pending.has(pubkey)) return
      pending.add(pubkey)
      if (flushHandle === null) flushHandle = window.setTimeout(() => void flush(), FLUSH_MS)
    },

    get: (pubkey) => get().profiles[pubkey],
  }
})

if (import.meta.env.DEV && typeof window !== "undefined") { (window as unknown as { __profiles?: unknown }).__profiles = useProfiles }

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
