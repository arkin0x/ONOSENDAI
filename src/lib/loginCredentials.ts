export type LoginCredentialKind = 'nsec' | 'ncryptsec' | 'bunker'

/** Identify the three credentials accepted by the identity login field. */
export function loginCredentialKind(value: string): LoginCredentialKind | null {
  const input = value.trim().toLowerCase()
  if (input.startsWith('nsec1')) return 'nsec'
  if (input.startsWith('ncryptsec1')) return 'ncryptsec'
  if (input.startsWith('bunker://')) return 'bunker'
  return null
}

/**
 * The first relay a login QR names: ONOSENDAI's own relay, which relays
 * Nostr Connect messages (kind 24133) live and never stores them.
 */
export const DEFAULT_SIGNER_RELAY = 'wss://relay.onosendai.tech'
/**
 * A second relay the default QR carries, so a session is not tied to one
 * relay for good: the handshake and every later signature can go over either.
 */
export const BACKUP_SIGNER_RELAY = 'wss://bucket.coracle.social'

/** The relays a QR names: the chosen one, plus the backup when the default was kept. */
export function signerRelays(relay: string): string[] {
  return relay === DEFAULT_SIGNER_RELAY ? [DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY] : [relay]
}

/**
 * Signer relays that no longer answer. The default QR named one of them as its
 * backup until 2026-11-19, so a session saved before then still lists it.
 */
const RETIRED_SIGNER_RELAY_HOSTS = new Set(['relay.nsec.app'])

function isRetiredSignerRelay(relay: string): boolean {
  try { return RETIRED_SIGNER_RELAY_HOSTS.has(new URL(relay.trim()).hostname.toLowerCase()) } catch { return false }
}

/**
 * A saved bunker URI without the retired relays, so a session saved with one
 * stops trying it and keeps talking over the others. A URI that names no
 * other relay is returned as it is: the signer listens only where the URI
 * says, so moving it elsewhere would end a session instead of mending it.
 * Everything else in the URI (the signer's key, a secret) is kept.
 */
export function withoutRetiredSignerRelays(bunkerUri: string): string {
  let url: URL
  try { url = new URL(bunkerUri.trim()) } catch { return bunkerUri }
  const relays = url.searchParams.getAll('relay')
  const kept = relays.filter((r) => !isRetiredSignerRelay(r))
  if (kept.length === relays.length || kept.length === 0) return bunkerUri
  url.searchParams.delete('relay')
  for (const r of kept) url.searchParams.append('relay', r)
  return url.toString()
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** A signer relay must be a WebSocket URL. Returns one stable URL for the QR. */
export function normalizeSignerRelay(value: string): string {
  const raw = value.trim()
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Signer relay must be a valid wss:// URL.') }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new Error('Signer relay must use wss:// or ws://.')
  // Unencrypted ws:// shows who talks to whom to anyone on the path; the
  // messages stay encrypted, the metadata does not. Only this machine.
  if (url.protocol === 'ws:' && !LOCAL_HOSTS.has(url.hostname)) throw new Error('Use wss:// for a signer relay; ws:// is only for localhost.')
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}
