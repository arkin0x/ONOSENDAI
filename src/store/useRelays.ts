/**
 * useRelays.ts — which relays this client talks to.
 *
 * cyberspace.nostr1.com is the default for everyone and is always present: it
 * is where the shared world lives, so it cannot be removed. On top of it you
 * add your own, and everything the client does — publishing movement and
 * hidden content, discovering it, reading other chains — fans out across the
 * whole set. Persisted locally, so your relays survive a reload.
 */

import { create } from 'zustand'

/** The default for everyone; always in the list, never removed. */
export const DEFAULT_RELAY = 'wss://cyberspace.nostr1.com'

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

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    const urls = Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? normalizeRelay(x) : null)).filter((x): x is string => !!x) : []
    // The default is always first and always present.
    return [DEFAULT_RELAY, ...urls.filter((u) => u !== DEFAULT_RELAY)]
  } catch {
    return [DEFAULT_RELAY]
  }
}

function save(relays: string[]): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(relays.filter((r) => r !== DEFAULT_RELAY))) } catch { /* private mode */ }
}

export const useRelays = create<RelaysState>((set, get) => ({
  relays: load(),

  add: (url) => {
    const norm = normalizeRelay(url)
    if (!norm) return null
    if (get().relays.includes(norm)) return norm
    const relays = [...get().relays, norm]
    set({ relays })
    save(relays)
    return norm
  },

  remove: (url) => {
    if (url === DEFAULT_RELAY) return
    const relays = get().relays.filter((r) => r !== url)
    set({ relays })
    save(relays)
  },

  reset: () => { set({ relays: [DEFAULT_RELAY] }); save([DEFAULT_RELAY]) },
}))

/** The current relay set, for the non-React relay helpers. */
export function currentRelays(): string[] {
  return useRelays.getState().relays
}
