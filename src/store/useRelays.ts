/**
 * useRelays.ts — which relays this client talks to.
 *
 * The canonical relay (DEFAULT_RELAY) is the default for everyone and is
 * always present: it is where the shared world lives, so it cannot be removed.
 * On top of it you add your own, and everything the client does (publishing
 * movement and hidden content, discovering it, reading other chains) fans
 * out across the whole set. Persisted locally, so your relays survive a
 * reload. The former canonical relay (READ_FALLBACK_RELAY) is read from, and
 * never written to, while it is retired.
 */

import { normalizeURL } from 'nostr-tools/utils'
import { create } from 'zustand'

/**
 * The canonical relay: the default for everyone, always in the list, never
 * removed, where every chain is published and confirmed. Its URL is defined
 * here and nowhere else; everything that needs it (confirming a head,
 * publishing and the publish retry, the live subscriptions, the chain fetch,
 * the self-check, NIP-42 auth, the panels) reads it from this constant or
 * from relay.ts CYBERSPACE_RELAY, which is this constant. Moving cyberspace
 * to another relay is a change to this line alone.
 *
 * Since 2026-11-05 it is the owner's own relay, which holds the full history
 * copied from wss://cyberspace.nostr1.com. Reads are open; it asks for NIP-42
 * AUTH only for protected (NIP-70) events, and takes events up to 512 KB.
 */
export const DEFAULT_RELAY = 'wss://relay.onosendai.tech'

/**
 * The former canonical relay, wss://cyberspace.nostr1.com, read only while it
 * is retired (the owner, 2026-11-22: "it's time to deprecate cyberspace.nostr1").
 *
 * Stage 1 of its retirement: it is not in the relay list, so nothing is
 * published there by default (an item published there before keeps its own
 * saved relays, so taking it down still reaches it), except your own
 * movement events (relay.ts mirrorToOldRelay), copied there and never trusted, so
 * a device of yours still on a build of before stage 1, which trusts it,
 * never signs on a head you already moved past; it is not pinned, so it
 * never vouches for a head (ownWatch, standingHead); it never counts as
 * holding a chain (chainHolders), so no move waits for it; and in the
 * question before a move, its answer alone never passes the move (chains.ts
 * confirmChainEvents), since the moves of this version never reach it. It is
 * still read, beside the relay list (relay.ts readRelaySet), so whatever is
 * only there (a client of before the 2026-11-05 switch, the Bitcoin anchors
 * until their publisher sends them to the canonical relay as well) is still
 * seen, and a move of yours that only it holds still stops the next one.
 *
 * It gates reads with NIP-42 AUTH. Stage 2, reading it no longer, is deleting
 * this constant and its uses; nothing saved names it.
 */
export const READ_FALLBACK_RELAY = 'wss://cyberspace.nostr1.com'

/** The relays every list starts with, in order, and that cannot be removed: the canonical relay alone. */
export const PINNED_RELAYS: readonly string[] = [DEFAULT_RELAY]

/** Whether a relay URL is the read-only former canonical relay, however it is written. */
export function isReadFallbackRelay(url: string): boolean {
  try {
    return normalizeURL(url.trim()) === normalizeURL(READ_FALLBACK_RELAY)
  } catch {
    return false
  }
}

/**
 * Hosts this client never dials, whichever list names them: a saved relay
 * list, a saved chain-holder set, a kind 10002, a kind 10050, a hint. The owner
 * ruled on 2026-10-31 that wss://onosendai.feeds.relay.tools is down
 * indefinitely: it answered HTTP 502 or refused for days, and a WALK step waited
 * on it twice. Taking a host off this list is all it takes to dial it again.
 */
export const RETIRED_HOSTS: readonly string[] = ['onosendai.feeds.relay.tools']

const STORAGE = 'onosendai:relays'

interface RelaysState {
  relays: string[]
  add: (url: string) => string | null
  remove: (url: string) => void
  reset: () => void
}

/** ws:// or wss:// with a real host; null for anything else. */
export function normalizeRelay(input: string): string | null {
  const s = input.trim()
  // A relay URL has no spaces; a "host" with one is a typo, not an address.
  if (!s || /\s/.test(s)) return null
  const withScheme = /^wss?:\/\//i.test(s) ? s : `wss://${s}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null
    // A hostname, optionally with a port: letters, digits, dots, hyphens.
    if (!/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes('.') && u.hostname !== 'localhost') return null
    const path = u.pathname === '/' ? '' : u.pathname
    return `${u.protocol}//${u.host}${path}`.replace(/\/$/, '')
  } catch {
    return null
  }
}

/**
 * Whether a relay URL is on a retired host, however it is written: by host, the
 * way nostr-tools opens it, so a scheme, a path or a trailing dot cannot get
 * around it. Not a relay URL at all: not retired.
 */
export function isRetiredRelay(url: string): boolean {
  try {
    return RETIRED_HOSTS.includes(new URL(normalizeURL(url.trim())).hostname.replace(/\.+$/, ''))
  } catch {
    return false
  }
}

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    const urls = Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? normalizeRelay(x) : null)).filter((x): x is string => !!x) : []
    // A retired relay leaves the saved list too, so this browser stops carrying it.
    const kept = urls.filter((u) => !isRetiredRelay(u))
    if (kept.length !== urls.length) save(kept)
    // The pinned relays are always first and always present, the canonical one first.
    return [...PINNED_RELAYS, ...kept.filter((u) => !PINNED_RELAYS.includes(u))]
  } catch {
    return [...PINNED_RELAYS]
  }
}

function save(relays: string[]): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(relays.filter((r) => !PINNED_RELAYS.includes(r)))) } catch { /* private mode */ }
}

export const useRelays = create<RelaysState>((set, get) => ({
  relays: load(),

  add: (url) => {
    const norm = normalizeRelay(url)
    if (!norm || isRetiredRelay(norm)) return null
    if (get().relays.includes(norm)) return norm
    const relays = [...get().relays, norm]
    set({ relays })
    save(relays)
    return norm
  },

  remove: (url) => {
    if (PINNED_RELAYS.includes(url)) return
    const relays = get().relays.filter((r) => r !== url)
    set({ relays })
    save(relays)
  },

  reset: () => { set({ relays: [...PINNED_RELAYS] }); save([...PINNED_RELAYS]) },
}))

/** The current relay set, for the non-React relay helpers: where everything is published. */
export function currentRelays(): string[] {
  return useRelays.getState().relays
}

/** Where reads go: the current relay set, then the read-only old relay (READ_FALLBACK_RELAY) unless the set names it. Never a place to publish to. */
export function readRelays(): string[] {
  const relays = currentRelays()
  return relays.some(isReadFallbackRelay) ? relays : [...relays, READ_FALLBACK_RELAY]
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __relays: typeof useRelays }).__relays = useRelays
}
