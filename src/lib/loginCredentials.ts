export type LoginCredentialKind = 'nsec' | 'ncryptsec' | 'bunker'

/** Identify the three credentials accepted by the identity login field. */
export function loginCredentialKind(value: string): LoginCredentialKind | null {
  const input = value.trim().toLowerCase()
  if (input.startsWith('nsec1')) return 'nsec'
  if (input.startsWith('ncryptsec1')) return 'ncryptsec'
  if (input.startsWith('bunker://')) return 'bunker'
  return null
}

export const DEFAULT_SIGNER_RELAY = 'wss://bucket.coracle.social'
/**
 * A second relay the default QR carries, so a session is not tied to one
 * third-party relay for good: the handshake and every later signature can go
 * over either. relay.nsec.app is run for Nostr Connect traffic.
 */
export const BACKUP_SIGNER_RELAY = 'wss://relay.nsec.app'

/** The relays a QR names: the chosen one, plus the backup when the default was kept. */
export function signerRelays(relay: string): string[] {
  return relay === DEFAULT_SIGNER_RELAY ? [DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY] : [relay]
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
