/**
 * useRelays.ts — which relays this client talks to.
 *
 * The canonical relay (DEFAULT_RELAY) is the default for everyone and is
 * always present: it is where the shared world lives, so it cannot be removed.
 * The former canonical relay (SECOND_RELAY) is pinned after it while the
 * 2026-11-05 switch settles. On top of them you
 * add your own, and everything the client does — publishing movement and
 * hidden content, discovering it, reading other chains — fans out across the
 * whole set. Persisted locally, so your relays survive a reload.
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
 * The former canonical relay, pinned second for about two weeks after the
 * switch (the owner, 2026-11-05): every action still reaches people and
 * clients that read only it, and a chain whose newest moves reached only it
 * (before the history catch-up) is still found. It also counts as holding
 * every chain (chainHolders.ts). It gates reads with NIP-42 AUTH and refuses
 * events over about 262 KB. Ending the window is deleting this constant and
 * its uses; nothing saved names it, because the pinned relays are never saved.
 */
export const SECOND_RELAY = 'wss://cyberspace.nostr1.com'

/** The relays every list starts with, in order, and that cannot be removed. */
export const PINNED_RELAYS: readonly string[] = [DEFAULT_RELAY, SECOND_RELAY]

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

/** The current relay set, for the non-React relay helpers. */
export function currentRelays(): string[] {
  return useRelays.getState().relays
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __relays: typeof useRelays }).__relays = useRelays
}
