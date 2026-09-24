/**
 * blossom.ts - putting a file on a public Blossom server.
 *
 * A profile picture has to live somewhere a stranger's client can fetch it,
 * and nostr has settled on Blossom for that (BUD-01, BUD-02): PUT the bytes
 * to `/upload`, signed with a kind 24242 event that names the file by its
 * sha256, and get back a URL that ends in that hash. Any Blossom server will
 * do, so the person picks one: their own list first (kind 10063, BUD-03),
 * then a few public servers that answered a HEAD probe with a Blossom 401 and
 * `Access-Control-Allow-Origin: *` on 2026-09-24, which is what a browser
 * upload needs.
 *
 * The question before the upload (BUD-06, HEAD /upload) lets a server refuse
 * the size or the type before the bytes travel. A server without it answers
 * 404 or 405, or its CORS rejects the probe outright; neither is a refusal, and
 * the upload goes ahead.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from './events'
import type { EventTemplate, NostrEvent } from './events'

export const BLOSSOM_AUTH_KIND = 24242
export const SERVER_LIST_KIND = 10063

/** Public servers that took a browser's HEAD /upload with CORS on 2026-09-24. */
export const DEFAULT_BLOSSOM_SERVERS = [
  'https://blossom.band',
  'https://nostr.download',
  'https://cdn.nostrcheck.me',
  'https://24242.io',
]

/** How long an upload token stays valid. The upload is one request; minutes are plenty. */
export const AUTH_TTL_S = 5 * 60

/** `https://host[:port][/path]`, no trailing slash, or null. http only for a local server. */
export function normalizeServer(input: string): string | null {
  const s = input.trim()
  if (!s || /\s/.test(s)) return null
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    const local = u.hostname === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(u.hostname)
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
    if (!u.hostname.includes('.') && !local) return null
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes))
}

/** The event a server wants signed before it takes a blob: what, which bytes, until when. */
export function uploadAuthTemplate(hash: string, createdAt: number, reason = 'Upload a profile image from ONOSENDAI'): EventTemplate {
  return {
    kind: BLOSSOM_AUTH_KIND,
    created_at: createdAt,
    tags: [['t', 'upload'], ['x', hash], ['expiration', String(createdAt + AUTH_TTL_S)]],
    content: reason,
  }
}

/** `Authorization: Nostr <base64 of the signed event's JSON>` (BUD-01). */
export function authHeader(event: NostrEvent): string {
  const bytes = new TextEncoder().encode(JSON.stringify(event))
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `Nostr ${btoa(bin)}`
}

/** The servers a kind 10063 names, first the most trusted, each once. */
export function serversFromList(ev: { tags: string[][] } | null | undefined): string[] {
  const out: string[] = []
  for (const t of ev?.tags ?? []) {
    if (t[0] !== 'server' || typeof t[1] !== 'string') continue
    const url = normalizeServer(t[1])
    if (url && !out.includes(url)) out.push(url)
  }
  return out
}

export interface BlobDescriptor {
  url: string
  sha256: string
  size: number
  type: string
}

/** The blob descriptor a server answers an upload with (BUD-02), or null. */
export function parseDescriptor(json: unknown): BlobDescriptor | null {
  if (!json || typeof json !== 'object') return null
  const d = json as Record<string, unknown>
  if (typeof d.url !== 'string' || typeof d.sha256 !== 'string') return null
  return {
    url: d.url,
    sha256: d.sha256.toLowerCase(),
    size: typeof d.size === 'number' ? d.size : 0,
    type: typeof d.type === 'string' ? d.type : 'application/octet-stream',
  }
}

/** A server said no. `reason` is its X-Reason header, for a person to read, never to branch on. */
export class BlossomRefusal extends Error {
  constructor(readonly status: number, readonly reason: string | null) {
    super(reason ?? `HTTP ${status}`)
    this.name = 'BlossomRefusal'
  }
}

export type Sign = (template: EventTemplate) => Promise<NostrEvent>
type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** Put one file on a server. Resolves to where it now lives; throws a BlossomRefusal or a network error. */
export async function uploadBlob(server: string, file: Blob, sign: Sign, fetchImpl: FetchLike = fetch): Promise<BlobDescriptor> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const hash = sha256Hex(bytes)
  const type = file.type || 'application/octet-stream'
  const auth = await sign(uploadAuthTemplate(hash, Math.floor(Date.now() / 1000)))
  const headers: Record<string, string> = { Authorization: authHeader(auth), 'X-SHA-256': hash }
  const endpoint = `${server}/upload`

  // Ask first. A refusal here saves sending the bytes; a missing HEAD does not stop anything.
  try {
    const probe = await fetchImpl(endpoint, {
      method: 'HEAD',
      headers: { ...headers, 'X-Content-Type': type, 'X-Content-Length': String(bytes.byteLength) },
    })
    if (!probe.ok && probe.status !== 404 && probe.status !== 405 && probe.status !== 501) {
      throw new BlossomRefusal(probe.status, probe.headers.get('X-Reason'))
    }
  } catch (err) {
    if (err instanceof BlossomRefusal) throw err
    // A network or CORS failure on the probe: the server may still take the PUT.
  }

  const res = await fetchImpl(endpoint, { method: 'PUT', headers: { ...headers, 'Content-Type': type }, body: bytes })
  if (!res.ok) throw new BlossomRefusal(res.status, res.headers.get('X-Reason'))
  const desc = parseDescriptor(await res.json().catch(() => null))
  if (!desc) throw new BlossomRefusal(res.status, 'the server answered without a blob descriptor')
  if (desc.sha256 !== hash) throw new BlossomRefusal(res.status, 'the server stored different bytes than were sent')
  return desc
}

/** What to tell a person when an upload fails. */
export function explainUpload(err: unknown): string {
  if (err instanceof BlossomRefusal) {
    const why = err.reason ? ` (${err.reason})` : ''
    switch (err.status) {
      case 401: return `The server did not accept the signature${why}.`
      case 402: return `That server wants payment for storage${why}. Pick another.`
      case 403: return `That server does not take uploads from this key${why}.`
      case 413: return `The file is too large for that server${why}.`
      case 415: return `That server does not take this kind of file${why}.`
      case 429: return `That server is rate-limiting uploads${why}. Try again in a minute.`
      default: return `The server refused the upload: HTTP ${err.status}${why}.`
    }
  }
  if (err instanceof TypeError) return 'The server could not be reached, or it does not allow uploads from a browser.'
  return err instanceof Error && err.message ? err.message : 'The upload failed.'
}
