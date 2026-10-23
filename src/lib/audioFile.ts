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

import { sha256Hex, uploadBlob, type Sign } from './blossom'
import { decryptAudioFile, encryptAudioFile, MAX_AUDIO_BYTES, type AudioItem } from './audioItem'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** What sealing and uploading a file gives the item: everything but the hider's choices. */
export type UploadedAudio = Pick<AudioItem, 'url' | 'mime' | 'hash' | 'originalHash' | 'size' | 'keyHex' | 'nonceHex'>

/** What the signer shows for the upload token. */
export const AUDIO_UPLOAD_REASON = 'Upload an encrypted file from ONOSENDAI'

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
    url: desc.url,
    mime: (file.type || 'audio/mpeg').toLowerCase(),
    hash: desc.sha256,
    originalHash: sha256Hex(plain),
    size: sealed.cipher.byteLength,
    keyHex: sealed.keyHex,
    nonceHex: sealed.nonceHex,
  }
}

/** Why a file could not be opened, for a person to read. */
export class AudioFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioFetchError'
  }
}

/** The few files heard last, decrypted, by their ciphertext's hash. */
const opened = new Map<string, Promise<Blob>>()
const KEEP = 6

/**
 * The decrypted file of an item, as a Blob of its type. Fetched once and
 * kept for the few heard last; a failure is not kept, so a second tap tries
 * again.
 */
export function openAudio(a: Pick<AudioItem, 'url' | 'hash' | 'originalHash' | 'keyHex' | 'nonceHex' | 'mime'>, fetchImpl: FetchLike = fetch): Promise<Blob> {
  const held = opened.get(a.hash)
  if (held) {
    // Most recently heard last, so the oldest is the one dropped.
    opened.delete(a.hash)
    opened.set(a.hash, held)
    return held
  }
  const p = (async (): Promise<Blob> => {
    let res: Response
    try {
      res = await fetchImpl(a.url, { referrerPolicy: 'no-referrer' })
    } catch {
      throw new AudioFetchError('The file’s server could not be reached.')
    }
    if (!res.ok) throw new AudioFetchError(`The file’s server answered HTTP ${res.status}.`)
    const cipher = new Uint8Array(await res.arrayBuffer())
    if (sha256Hex(cipher) !== a.hash) throw new AudioFetchError('The server sent other bytes than the ones hidden here.')
    const plain = await decryptAudioFile(cipher, a.keyHex, a.nonceHex)
    if (!plain) throw new AudioFetchError('The file does not open with the key hidden here.')
    if (a.originalHash && sha256Hex(plain) !== a.originalHash) throw new AudioFetchError('The file opened, but it is not the one hidden here.')
    return new Blob([plain as BlobPart], { type: a.mime })
  })()
  opened.set(a.hash, p)
  while (opened.size > KEEP) opened.delete(opened.keys().next().value as string)
  p.catch(() => { if (opened.get(a.hash) === p) opened.delete(a.hash) })
  return p
}

/** Forget the opened files (tests). */
export function forgetOpenedAudio(): void {
  opened.clear()
}
