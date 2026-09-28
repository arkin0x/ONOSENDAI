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

/** A signer relay must be a WebSocket URL. Returns one stable URL for the QR. */
export function normalizeSignerRelay(value: string): string {
  const raw = value.trim()
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Signer relay must be a valid wss:// URL.') }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') throw new Error('Signer relay must use wss:// or ws://.')
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}
