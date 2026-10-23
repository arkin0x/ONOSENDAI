/**
 * audioFile.ts: hidden audio's file, on its way up and on its way back
 * (DECK-0007 §2).
 *
 * Up: the file is encrypted here with a fresh key (lib/audioItem
 * encryptAudioFile) and the ciphertext goes to the Blossom server the hider
 * picked, as `application/octet-stream`, so the server learns a size and who
 * sent it, never what it is or where it is hidden.
 *
 * Back: the ciphertext is fetched from the item's URL and checked against the
 * item's `x` before it is decrypted, and the file against `ox` after, so a
 * server that answers with other bytes is caught before anything plays. The
 * decrypted file is kept in memory for the few items heard last, so PLAY
 * after DOWNLOAD (or the other way round) fetches nothing twice.
 */

import { normalizeServer, sha256Hex, uploadBlob, type Sign } from './blossom'
import { decryptAudioFile, encryptAudioFile, fetchableUrl, MAX_AUDIO_BYTES, type AudioItem } from './audioItem'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** What sealing and uploading a file gives the item: everything but the hider's choices. */
export type UploadedAudio = Pick<AudioItem, 'url' | 'mime' | 'hash' | 'originalHash' | 'size' | 'keyHex' | 'nonceHex'>

/** What the signer shows for the upload token. */
export const AUDIO_UPLOAD_REASON = 'Upload an encrypted file from ONOSENDAI'

/** The most bytes a reader takes from a file's server: the largest file this client hides, sealed (its 16-byte tag). */
export const MAX_CIPHER_BYTES = MAX_AUDIO_BYTES + 16

/** An audio type by a file's extension, for a file the system gave no type (often .flac, .opus), or null. */
export function audioTypeOf(name: string): string | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  const known: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' }
  return known[ext] ?? null
}

/** Why a file cannot be hidden as audio, or null when it can. */
export function audioFileRefusal(file: Pick<File, 'type' | 'size'>): string | null {
  if (!file.type.toLowerCase().startsWith('audio/')) return 'Not an audio file.'
  if (file.size === 0) return 'The file is empty.'
  if (file.size > MAX_AUDIO_BYTES) return `Too large: ${Math.ceil(file.size / 1024 / 1024)} MB, and the most is ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`
  return null
}

/** Encrypt a file and put the ciphertext on a server. Throws as uploadBlob does. */
export async function sealAndUpload(file: Blob, server: string, sign: Sign, fetchImpl: FetchLike = fetch): Promise<UploadedAudio> {
  const plain = new Uint8Array(await file.arrayBuffer())
  const sealed = await encryptAudioFile(plain)
  const blob = new Blob([sealed.cipher as BlobPart], { type: 'application/octet-stream' })
  const desc = await uploadBlob(server, blob, sign, fetchImpl as (url: string, init: RequestInit) => Promise<Response>, AUDIO_UPLOAD_REASON)
  return {
    // The item must name a URL every finder will fetch (https, ending in the
    // hash: lib/audioItem fetchableUrl). A server that answers with another
    // (http behind a proxy, a path of its own) is named by its own address
    // and the hash instead, which BUD-01 serves the blob at.
    url: fetchableUrl(desc.url, desc.sha256) ? desc.url : `${server}/${desc.sha256}`,
    mime: (file.type || 'audio/mpeg').toLowerCase(),
    hash: desc.sha256,
    originalHash: sha256Hex(plain),
    size: sealed.cipher.byteLength,
    keyHex: sealed.keyHex,
    nonceHex: sealed.nonceHex,
  }
}

/**
 * The server a Blossom URL is on: the URL without its last path segment
 * (`https://host[/path]/<sha256>[.ext]`, BUD-01), or null.
 */
export function serverOf(url: string): string | null {
  const cut = url.lastIndexOf('/')
  return cut > 'https://'.length ? normalizeServer(url.slice(0, cut)) : null
}

/**
 * A fresh copy of an item's file for another placement (PLACE AGAIN): the
 * file opened with the old key (from memory when it was heard or placed
 * here), sealed again under a new key and nonce, and uploaded to the server
 * the hider picked for the first copy (`chosen`), else the one its address
 * names. Two placements never share a key, or even a
 * ciphertext, so a finder of one learns nothing about where the other is.
 */
export async function resealCopy(a: Pick<AudioItem, 'url' | 'hash' | 'originalHash' | 'keyHex' | 'nonceHex' | 'mime'>, sign: Sign, chosen?: string, fetchImpl: FetchLike = fetch): Promise<UploadedAudio> {
  // The server the hider picked for the first copy; read from its address
  // only for an item that came without one (a server may answer an upload
  // with a URL on another host, a CDN beside its API).
  const server = (chosen ? normalizeServer(chosen) : null) ?? serverOf(a.url)
  if (!server) throw new AudioFetchError('There is no server to put the copy on.')
  const file = await openAudio(a, fetchImpl)
  return sealAndUpload(new Blob([await file.arrayBuffer()], { type: a.mime }), server, sign, fetchImpl)
}

/** Why a file could not be opened, for a person to read. */
export class AudioFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioFetchError'
  }
}

/**
 * The few files heard last, decrypted: by the ciphertext's hash with the key
 * and nonce, so an item that names a known hash with another key opens
 * nothing it should not. Bounded by bytes, the oldest heard going first.
 */
const opened = new Map<string, { file: Promise<Blob>; bytes: number }>()
const KEEP_BYTES = 64 * 1024 * 1024
const cacheKey = (a: Pick<AudioItem, 'hash' | 'keyHex' | 'nonceHex' | 'originalHash' | 'mime'>): string => `${a.hash}:${a.keyHex}:${a.nonceHex}:${a.originalHash}:${a.mime}`

function trim(): void {
  let total = 0
  for (const v of opened.values()) total += v.bytes
  for (const [k, v] of opened) {
    if (total <= KEEP_BYTES || opened.size <= 1) break
    opened.delete(k)
    total -= v.bytes
  }
}

/** The body of a response, refused past `max` bytes (by its length when it says, else as it arrives). */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const said = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(said) && said > max) throw new AudioFetchError('The file is larger than any this client hides.')
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer())
    if (all.byteLength > max) throw new AudioFetchError('The file is larger than any this client hides.')
    return all
  }
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    got += value.byteLength
    if (got > max) { void reader.cancel(); throw new AudioFetchError('The file is larger than any this client hides.') }
    parts.push(value)
  }
  const out = new Uint8Array(got)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.byteLength }
  return out
}

/**
 * The decrypted file of an item, as a Blob of its type. Fetched once and
 * kept for the few heard last; a failure is not kept, so a second tap tries
 * again.
 */
export function openAudio(a: Pick<AudioItem, 'url' | 'hash' | 'originalHash' | 'keyHex' | 'nonceHex' | 'mime'> & { size?: number }, fetchImpl: FetchLike = fetch): Promise<Blob> {
  const key = cacheKey(a)
  const held = opened.get(key)
  if (held) {
    // Most recently heard last, so the oldest is the one dropped.
    opened.delete(key)
    opened.set(key, held)
    return held.file
  }
  const p = (async (): Promise<Blob> => {
    let res: Response
    try {
      res = await fetchImpl(a.url, { referrerPolicy: 'no-referrer' })
    } catch {
      throw new AudioFetchError('The file’s server could not be reached.')
    }
    if (!res.ok) throw new AudioFetchError(`The file’s server answered HTTP ${res.status}.`)
    // Never more than the largest file this client hides, or the size the item says when it says one.
    const cipher = await readCapped(res, a.size ? Math.min(a.size, MAX_CIPHER_BYTES) : MAX_CIPHER_BYTES)
    if (sha256Hex(cipher) !== a.hash) throw new AudioFetchError('The server sent other bytes than the ones hidden here.')
    const plain = await decryptAudioFile(cipher, a.keyHex, a.nonceHex)
    if (!plain) throw new AudioFetchError('The file does not open with the key hidden here.')
    if (a.originalHash && sha256Hex(plain) !== a.originalHash) throw new AudioFetchError('The file opened, but it is not the one hidden here.')
    return new Blob([plain as BlobPart], { type: a.mime })
  })()
  const entry = { file: p, bytes: a.size || 0 }
  opened.set(key, entry)
  trim()
  p.then((b) => { entry.bytes = b.size; trim() }, () => { if (opened.get(key) === entry) opened.delete(key) })
  return p
}

/** Forget the opened files (tests). */
export function forgetOpenedAudio(): void {
  opened.clear()
}
