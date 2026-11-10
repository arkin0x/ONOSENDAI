/**
 * blossomChoice.ts: which Blossom servers the upload picker offers, and which
 * one it starts on (hud/BlossomServer).
 *
 * A server someone types sticks (owner 2026-11-10: "If anyone adds any server
 * manually, it should stick."). Once an upload to it gets an answer from the
 * server, even a refusal (a server that wants a subscription answers 402), it
 * is kept on this device for this key, offered in the list as "(yours)", and
 * the picker starts on it next time. A server that never answered (a typo, a
 * host that is down) is not kept. Typed servers never join
 * DEFAULT_BLOSSOM_SERVERS: some want a subscription, and the defaults are for
 * everyone.
 *
 * Kept per key, since a Blossom subscription is per key. Nothing here
 * publishes or changes the person's kind 10063 server list.
 */

import { DEFAULT_BLOSSOM_SERVERS, normalizeServer } from './blossom'

/** Before 2026-11-10: the one server the last upload went to, for every key on the device. Read, never written, so each key migrates from it. */
export const LEGACY_SERVER_KEY = 'onosendai:blossom-server'
/** Since 2026-11-10: per key, `{ last, typed }`. */
export const CHOICE_KEY_PREFIX = 'onosendai:blossom-servers:'
/** How many servers of your own a device keeps per key, the most recent first. */
export const MAX_TYPED = 8

export interface StoredChoice {
  /** The server the last upload went to (or was answered by), or null. */
  last: string | null
  /** Servers of your own used on this device, the most recent first. Never a default. */
  typed: string[]
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

function store(): Store | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function choiceKey(pubkey: string): string {
  return CHOICE_KEY_PREFIX + (pubkey || 'anon')
}

/** Each a usable server, each once, in order, at most `max`. */
function clean(list: unknown[], max = Infinity): string[] {
  const out: string[] = []
  for (const s of list) {
    const url = typeof s === 'string' ? normalizeServer(s) : null
    if (url && !out.includes(url)) out.push(url)
    if (out.length >= max) break
  }
  return out
}

const isDefault = (s: string): boolean => DEFAULT_BLOSSOM_SERVERS.includes(s)

/** What this device kept for `pubkey`; from the old single server when it has kept nothing new yet. */
export function readChoice(pubkey: string, storage: Store | null = store()): StoredChoice {
  try {
    const raw = storage?.getItem(choiceKey(pubkey))
    if (raw) {
      const v = JSON.parse(raw) as { last?: unknown; typed?: unknown }
      const last = typeof v.last === 'string' ? normalizeServer(v.last) : null
      const typed = clean(Array.isArray(v.typed) ? v.typed : [], MAX_TYPED).filter((s) => !isDefault(s))
      return { last, typed }
    }
    const legacy = normalizeServer(storage?.getItem(LEGACY_SERVER_KEY) ?? '')
    return { last: legacy, typed: legacy && !isDefault(legacy) ? [legacy] : [] }
  } catch {
    return { last: null, typed: [] }
  }
}

/** `server` was used: it goes first, the default from now on, and joins your own unless it is a default. */
export function rememberServer(pubkey: string, server: string, storage: Store | null = store()): StoredChoice {
  const before = readChoice(pubkey, storage)
  const url = normalizeServer(server)
  if (!url) return before
  const typed = isDefault(url) ? before.typed : clean([url, ...before.typed], MAX_TYPED)
  const next = { last: url, typed }
  try { storage?.setItem(choiceKey(pubkey), JSON.stringify(next)) } catch { /* private mode, or full */ }
  return next
}

/** The select's options: the last used, your typed ones, your kind 10063 list, then the defaults; each once. */
export function serverOptions(stored: StoredChoice, mine: string[]): string[] {
  return clean([...(stored.last ? [stored.last] : []), ...stored.typed, ...mine, ...DEFAULT_BLOSSOM_SERVERS])
}

/** Where the picker starts: the last server used here, else your list's first, else the first default. */
export function initialServer(stored: StoredChoice, mine: string[]): string {
  return stored.last ?? mine[0] ?? DEFAULT_BLOSSOM_SERVERS[0]
}

/**
 * Your kind 10063 arrived (late, from the relays). Its first server becomes
 * the choice only when this device has none of its own and the person has not
 * picked one in the meantime; otherwise the choice stays.
 */
export function serverAfterList(current: string, stored: StoredChoice, mine: string[], picked: boolean): string {
  if (picked || stored.last) return current
  return mine[0] ?? current
}
