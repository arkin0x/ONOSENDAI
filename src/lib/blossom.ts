/**
 * blossom.ts - putting a file on a public Blossom server.
 *
 * A profile picture has to live somewhere a stranger's client can fetch it
 * (and hidden audio's encrypted file, DECK-0007),
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

/**
 * `https://host[:port][/path]`, no trailing slash, or null. http only for a
 * local server; `http://` on any other host is read as `https://` (owner
 * 2026-11-10 typed http://blossom.oslim.dev, which answers on https), since a
 * page on https cannot upload over http anyway.
 */
export function normalizeServer(input: string): string | null {
  const s = input.trim()
  if (!s || /\s/.test(s)) return null
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(withScheme)
    const local = u.hostname === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(u.hostname)
    if (u.protocol === 'http:' && !local) u.protocol = 'https:'
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

/**
 * How long a transfer may go with nothing arriving before it is given up. A
 * server that never answers used to hold whatever waited on it for good, the
 * bag lock among them (HIDE AGAIN of hidden audio reseals the file through
 * here; review of #599). Never a limit on the whole transfer: a 25 MiB file on
 * a slow line takes as long as it takes, so long as bytes keep coming.
 */
export const IDLE_TIMEOUT_MS = 30_000
/** The upload's HEAD: an answer with no body, or nothing. */
export const PROBE_TIMEOUT_MS = 15_000
/**
 * An upload's bytes going out cannot be watched through fetch, so until the
 * server answers it is waited for as if at this rate, the slowest line this
 * allows for: a 25 MiB file, about 53 minutes; anything, at least IDLE_TIMEOUT_MS.
 */
export const MIN_UPLOAD_BYTES_PER_S = 8 * 1024

/** The wait for an upload's answer: its bytes at MIN_UPLOAD_BYTES_PER_S, at least IDLE_TIMEOUT_MS. */
export function uploadWaitMs(bytes: number): number {
  return Math.max(IDLE_TIMEOUT_MS, Math.ceil(bytes / MIN_UPLOAD_BYTES_PER_S) * 1000)
}

/** A transfer given up, with the words why. */
export class TransferTimeout extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransferTimeout'
  }
}

/** Seconds or minutes, as a person reads them. */
export function spanWords(ms: number): string {
  return ms >= 120_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`
}

/**
 * Run `work` with an abort signal and a watchdog: given up, aborted and rejected
 * as a TransferTimeout with `words(ms)`, once `ms` pass with no `alive()`. Each
 * `alive(next)` gives it `next` more (the same `ms` when left out).
 */
export function watched<T>(ms: number, words: (ms: number) => string, work: (signal: AbortSignal, alive: (next?: number) => void) => Promise<T>): Promise<T> {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let fail: (err: TransferTimeout) => void = () => {}
  const late = new Promise<never>((_, reject) => { fail = reject })
  const alive = (next = ms): void => {
    clearTimeout(timer)
    timer = setTimeout(() => { abort.abort(); fail(new TransferTimeout(words(next))) }, next)
  }
  alive(ms)
  return Promise.race([work(abort.signal, alive), late]).finally(() => clearTimeout(timer))
}

/**
 * Put one file on a server. Resolves to where it now lives; throws a
 * BlossomRefusal or a network error. `reason` is the sentence the signer
 * shows for the upload token (kind 24242 content).
 */
export async function uploadBlob(server: string, file: Blob, sign: Sign, fetchImpl: FetchLike = fetch, reason?: string): Promise<BlobDescriptor> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const hash = sha256Hex(bytes)
  const type = file.type || 'application/octet-stream'
  const auth = await sign(uploadAuthTemplate(hash, Math.floor(Date.now() / 1000), reason))
  const headers: Record<string, string> = { Authorization: authHeader(auth), 'X-SHA-256': hash }
  const endpoint = `${server}/upload`

  // Ask first. A refusal here saves sending the bytes; a missing HEAD does not stop anything.
  try {
    const probe = await watched(PROBE_TIMEOUT_MS, (ms) => `The server did not answer within ${spanWords(ms)}.`, (signal) => fetchImpl(endpoint, {
      method: 'HEAD',
      headers: { ...headers, 'X-Content-Type': type, 'X-Content-Length': String(bytes.byteLength) },
      signal,
    }))
    if (!probe.ok && probe.status !== 404 && probe.status !== 405 && probe.status !== 501) {
      throw new BlossomRefusal(probe.status, probe.headers.get('X-Reason'))
    }
  } catch (err) {
    if (err instanceof BlossomRefusal) throw err
    // A network or CORS failure on the probe, or no answer in time: the server may still take the PUT.
  }

  // Until the server answers, as long as the bytes could take at the slowest
  // line allowed; then its answer, so long as it keeps coming.
  const { res, body } = await watched(uploadWaitMs(bytes.byteLength), (ms) => `The server did not take the file within ${spanWords(ms)}.`, async (signal, alive) => {
    const res = await fetchImpl(endpoint, { method: 'PUT', headers: { ...headers, 'Content-Type': type }, body: bytes, signal })
    alive(IDLE_TIMEOUT_MS)
    return { res, body: res.ok ? await res.json().catch(() => null) : null }
  })
  if (!res.ok) throw new BlossomRefusal(res.status, res.headers.get('X-Reason'))
  const desc = parseDescriptor(body)
  if (!desc) throw new BlossomRefusal(res.status, 'the server answered without a blob descriptor')
  if (desc.sha256 !== hash) throw new BlossomRefusal(res.status, 'the server stored different bytes than were sent')
  return desc
}

/**
 * A Blossom server answered the upload with a refusal (such as 402 for one
 * that wants a subscription), so it is a real server the person meant: the
 * picker keeps it (owner 2026-11-10). Not when it could not be reached or
 * never answered, and not for "no upload here" (404, 405, 501): that is a
 * wrong address, such as one pasted with /upload on the end.
 */
export function serverAnswered(err: unknown): boolean {
  return err instanceof BlossomRefusal && err.status !== 404 && err.status !== 405 && err.status !== 501
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
