/**
 * audioItem.ts: hidden audio, an audio file hidden at a place (DECK-0007,
 * arkinox's rulings of 2026-10-23).
 *
 * The item is a NIP-94 file event, kind 1063, sealed in a bag or a chest like
 * any other item. The file itself lives on a Blossom server, and Blossom is
 * public: anyone can fetch a blob by its hash, and many servers list every
 * upload by a key. So the file is encrypted before it leaves this device,
 * with a fresh AES-256-GCM key and nonce, and the key and nonce ride in the
 * item, inside the bag. Whoever opens the bag can play the file; everyone
 * else, the server included, holds noise (D1). There is no unencrypted form
 * (D5): everything in cyberspace v2 is encrypted to a bag.
 *
 * The tags are NIP-94's (`url`, `m`, `x`, `ox`, `size`) with the encryption
 * tags NIP-17 gives an encrypted file message (`encryption-algorithm`,
 * `decryption-key`, `decryption-nonce`), so a client that knows either NIP
 * reads most of it. Ours are `title` (as keys and chests carry), the three
 * flags `autoplay`, `loop` and `walk`, `retrigger` for a one-shot, and
 * `fade`, the radius in gibsons of the full-volume sphere.
 *
 * The item is written as a rumor, never signed (DECK-0007 §3): kind 1063 is
 * a kind other clients show in a feed, so a signed copy lifted out of the bag
 * would show anywhere as the hider's own file post, with the key to play it
 * and the exact coordinate it was hidden at. The bag's signature vouches for
 * who hid it, as it does for a message.
 *
 * Pure but for WebCrypto: the hearing (gain and trigger) is in here as
 * arithmetic, so the DECK's rules and the scene's sound agree by test.
 */

import { positionHex, bytesToHex, hexToBytes, type EventTemplate, type NostrEvent } from './events'
import type { Plane } from 'cyberspace-core'
import type { Position } from './space'

/** NIP-94's file metadata event: what a hidden audio item is. */
export const AUDIO_KIND = 1063
/** NIP-17's name for the cipher: AES-GCM, here always with a 256-bit key and a 96-bit nonce. */
export const AUDIO_CIPHER = 'aes-gcm'
/** Longest title, as a key's or a chest's. */
export const MAX_AUDIO_TITLE = 64
/** Longest caption in `content`, as a key's sentence. */
export const MAX_AUDIO_ABOUT = 280
/** The largest file the composer takes. Blossom servers cap uploads too; this keeps a decode in memory sane. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export type Retrigger = 'once' | 'auto'

/** What a hidden audio item carries, read out of its event. */
export interface AudioItem {
  title: string
  /** The hider's caption, or empty. */
  about: string
  /** Where the encrypted file is (a Blossom URL ending in its hash). */
  url: string
  /** The file's type once decrypted: always audio/something. */
  mime: string
  /** sha256 of the bytes at `url`, the ciphertext: what Blossom names it by. */
  hash: string
  /** sha256 of the decrypted file, or '' when the item does not say. */
  originalHash: string
  /** Bytes at `url`, or 0 when the item does not say. */
  size: number
  keyHex: string
  nonceHex: string
  /** Plays in the world by itself, where it is heard (DECK-0007 §5). Off: only from its card. */
  autoplay: boolean
  /** Plays over and over. Off: a one-shot, started by walking into its sphere. */
  loop: boolean
  /** A one-shot's trigger: the first time only, or every time the sphere is entered. */
  retrigger: Retrigger
  /** Radius in gibsons of the full-volume sphere about the source; absent: half the way to the region's nearest wall. */
  fade?: number
  /** Heard only in first person (WALK mode). */
  walkOnly: boolean
}

const HEX_64 = /^[0-9a-f]{64}$/
const HEX_24 = /^[0-9a-f]{24}$/
/** A decimal count as the spec writes one: no sign, no leading zeros (§10). */
const COUNT = /^(0|[1-9][0-9]*)$/

function tagValue(tags: string[][], name: string): string | undefined {
  const t = tags.find((t) => Array.isArray(t) && t[0] === name)
  return t && typeof t[1] === 'string' ? t[1] : undefined
}

function has(tags: string[][], name: string): boolean {
  return tags.some((t) => Array.isArray(t) && t[0] === name)
}

/** A decimal count, or undefined when absent, malformed or past what a number holds exactly. */
function countOf(v: string | undefined): number | undefined {
  if (v === undefined || !COUNT.test(v)) return undefined
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : undefined
}

/** Whether http to this machine is allowed: only while developing, never for a finder in use. */
const LOCAL_HTTP = (() => { try { return import.meta.env?.DEV === true } catch { return false } })()

/**
 * A host a found item may never point a finder at: an IP literal (v4 or v6,
 * which covers loopback, private and link-local addresses alike: a Blossom
 * server has a name), `localhost`, a name with no dot, or a name under
 * `.local`, `.localhost`, `.internal`, `.lan` or `.home.arpa`.
 */
function privateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h.startsWith('[') || h.includes(':')) return true
  if (/^\d+(\.\d+){0,3}$/.test(h) || /^0x[0-9a-f]+$/.test(h)) return true
  if (!h.includes('.') || h === 'localhost') return true
  return /\.(local|localhost|internal|lan|home\.arpa)$/.test(h)
}

/**
 * Whether a URL may be fetched for a file (DECK-0007 §2.3): https to a
 * public host name, with no user, query or fragment, and, given the file's
 * hash, a last path segment that is that hash, optionally with an extension,
 * as a Blossom URL is (BUD-01). So the item itself can only name a blob by
 * its hash on a public server, never an endpoint with arguments or a machine
 * on the finder's own network. (The server it names can still redirect;
 * DECK-0007 §7.) http to this machine is allowed only while developing.
 */
export function fetchableUrl(url: string, hash?: string): boolean {
  try {
    const u = new URL(url)
    const localDev = LOCAL_HTTP && u.protocol === 'http:' && (u.hostname === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(u.hostname))
    if (!localDev && (u.protocol !== 'https:' || privateHost(u.hostname))) return false
    if (u.search !== '' || u.hash !== '' || u.username !== '' || u.password !== '' || /[?#]/.test(url)) return false
    if (hash === undefined) return true
    const last = u.pathname.split('/').pop() ?? ''
    return last.toLowerCase() === hash || (last.toLowerCase().startsWith(`${hash}.`) && /^[a-z0-9]{1,8}$/i.test(last.slice(hash.length + 1)))
  } catch {
    return false
  }
}

/**
 * A hidden audio item out of its event, or null when it is not one this
 * client can play (DECK-0007 §2.2): not kind 1063, not audio, not encrypted
 * with AES-GCM under a well-formed key and nonce, or with nowhere to fetch it.
 */
export function audioItemOf(ev: Pick<NostrEvent, 'kind' | 'content' | 'tags'>): AudioItem | null {
  if (ev.kind !== AUDIO_KIND || typeof ev.content !== 'string' || !Array.isArray(ev.tags)) return null
  const tags = ev.tags
  const url = tagValue(tags, 'url')?.trim()
  const mime = tagValue(tags, 'm')?.trim().toLowerCase()
  const hash = tagValue(tags, 'x')?.trim().toLowerCase()
  if (!url || !mime || !mime.startsWith('audio/') || !hash || !HEX_64.test(hash) || !fetchableUrl(url, hash)) return null
  if (tagValue(tags, 'encryption-algorithm') !== AUDIO_CIPHER) return null
  const keyHex = tagValue(tags, 'decryption-key')?.trim().toLowerCase() ?? ''
  const nonceHex = tagValue(tags, 'decryption-nonce')?.trim().toLowerCase() ?? ''
  if (!HEX_64.test(keyHex) || !HEX_24.test(nonceHex)) return null
  const ox = tagValue(tags, 'ox')?.trim().toLowerCase() ?? ''
  const fade = countOf(tagValue(tags, 'fade'))
  const loop = has(tags, 'loop')
  return {
    title: (tagValue(tags, 'title') ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_AUDIO_TITLE) || 'audio',
    about: ev.content.trim().replace(/\s+/g, ' ').slice(0, MAX_AUDIO_ABOUT),
    url,
    mime,
    hash,
    originalHash: HEX_64.test(ox) ? ox : '',
    size: countOf(tagValue(tags, 'size')) ?? 0,
    keyHex,
    nonceHex,
    autoplay: has(tags, 'autoplay'),
    loop,
    // Only a one-shot has a trigger; anything but `auto` is the default, once.
    retrigger: !loop && tagValue(tags, 'retrigger') === 'auto' ? 'auto' : 'once',
    ...(fade !== undefined ? { fade } : {}),
    walkOnly: has(tags, 'walk'),
  }
}

/**
 * The inner audio event template (kind 1063), with NIP-70's `-`. Sealed as a
 * rumor (lib/hidden.ts rumorOf), never signed (DECK-0007 §3). `retrigger` is
 * written only on a one-shot, and `fade` only when the hider chose one.
 */
export function audioInnerTemplate(a: AudioItem, at: Position, plane: Plane, createdAt: number): EventTemplate {
  const tags: string[][] = [
    ['C', positionHex(at, plane)],
    ['title', a.title.trim().slice(0, MAX_AUDIO_TITLE)],
    ['url', a.url],
    ['m', a.mime],
    ['x', a.hash],
  ]
  if (a.originalHash) tags.push(['ox', a.originalHash])
  if (a.size > 0) tags.push(['size', String(a.size)])
  tags.push(['encryption-algorithm', AUDIO_CIPHER], ['decryption-key', a.keyHex], ['decryption-nonce', a.nonceHex])
  if (a.autoplay) tags.push(['autoplay'])
  if (a.loop) tags.push(['loop'])
  else tags.push(['retrigger', a.retrigger])
  if (a.fade !== undefined) tags.push(['fade', String(Math.max(0, Math.floor(a.fade)))])
  if (a.walkOnly) tags.push(['walk'])
  tags.push(['-'])
  return { kind: AUDIO_KIND, created_at: createdAt, content: a.about.trim().slice(0, MAX_AUDIO_ABOUT), tags }
}

/** The file's extension for a download, by its type. */
export function audioExtension(mime: string): string {
  const m = mime.toLowerCase().split(';')[0].trim()
  const known: Record<string, string> = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac',
    'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
    'audio/webm': 'webm', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
  }
  return known[m] ?? 'audio'
}

/** A safe file name for a download: the title, then the extension its type has. */
export function audioFileName(a: Pick<AudioItem, 'title' | 'mime'>): string {
  const base = a.title.replace(/[\\/:*?"<>|\u0000-\u001f\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, MAX_AUDIO_TITLE) || 'audio'
  return `${base}.${audioExtension(a.mime)}`
}

/** A file's title from its name: `temple-drone_02.mp3` is "temple drone 02". */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_AUDIO_TITLE)
}

// ---------------------------------------------------------------------------
// The file's encryption (DECK-0007 §2.1): AES-256-GCM, a 12-byte nonce, the
// 16-byte tag after the ciphertext, no additional data. WebCrypto's own form.

function subtle(): SubtleCrypto {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto
  if (!c?.subtle) throw new Error('This browser cannot encrypt files (no WebCrypto).')
  return c.subtle
}

/** Copied into a fresh ArrayBuffer, which is what WebCrypto's types want. */
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer
}

export interface SealedFile {
  cipher: Uint8Array
  keyHex: string
  nonceHex: string
}

/** Encrypt a file with a fresh key and nonce. `random` is for tests. */
export async function encryptAudioFile(plain: Uint8Array, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): Promise<SealedFile> {
  const key = random(32)
  const nonce = random(12)
  const k = await subtle().importKey('raw', buf(key), { name: 'AES-GCM' }, false, ['encrypt'])
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: buf(nonce) }, k, buf(plain)))
  return { cipher, keyHex: bytesToHex(key), nonceHex: bytesToHex(nonce) }
}

/** Decrypt a file, or null when the key, the nonce or the bytes are wrong (the GCM tag fails). */
export async function decryptAudioFile(cipher: Uint8Array, keyHex: string, nonceHex: string): Promise<Uint8Array | null> {
  try {
    const k = await subtle().importKey('raw', buf(hexToBytes(keyHex)), { name: 'AES-GCM' }, false, ['decrypt'])
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(hexToBytes(nonceHex)) }, k, buf(cipher)))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Hearing it (DECK-0007 §4). Distances are in gibsons, in the region's own
// frame: the region's aligned base is the origin, so every number is small
// enough for a float however far out in cyberspace the region is.

/** A point in a region's frame, gibsons from its aligned base. */
export type Local = readonly [number, number, number]

/** The region's aligned base on each axis (spec §7.2). */
export function regionBase(at: Position, height: number): Position {
  const h = BigInt(height)
  return { x: (at.x >> h) << h, y: (at.y >> h) << h, z: (at.z >> h) << h }
}

/** Where the source is in its region's frame: the centre of its gibson, as the scene draws it (itemCentre). */
export function sourceLocal(at: Position, height: number): Local {
  const b = regionBase(at, height)
  return [Number(at.x - b.x) + 0.5, Number(at.y - b.y) + 0.5, Number(at.z - b.z) + 0.5]
}

/** The distance from a point inside the region to its nearest face: the largest sphere about it that fits. */
export function inscribedRadius(p: Local, side: number): number {
  return Math.max(0, Math.min(...p.map((v) => Math.min(v, side - v))))
}

/**
 * The full-volume sphere's radius (DECK-0007 §4.1): the hider's `fade`,
 * never past the region's nearest wall from the source; without one, half
 * the way to that wall, so the sound still fades toward it (D4: a smooth
 * fade to silence, in every direction). This is also a one-shot's trigger
 * zone (§5.2).
 */
export function fadeRadius(fade: number | undefined, source: Local, height: number): number {
  const fits = inscribedRadius(source, 2 ** height)
  return fade === undefined ? fits / 2 : Math.min(Math.max(0, fade), fits)
}

/** How far from `from` along `dir` (not zero) to the region's walls: the ray's exit from the cube [0, side]^3. */
function exitDistance(from: Local, dir: Local, side: number): number {
  let t = Infinity
  for (let i = 0; i < 3; i++) {
    if (dir[i] > 0) t = Math.min(t, (side - from[i]) / dir[i])
    else if (dir[i] < 0) t = Math.min(t, -from[i] / dir[i])
  }
  return t
}

/** Whether a point is inside the region, its walls included. */
export function insideRegion(p: Local, side: number): boolean {
  return p.every((v) => v >= 0 && v <= side)
}

/**
 * How loud the source is at the listener, 0 to 1 (DECK-0007 §4.2): full
 * inside the sphere of radius `radius`, silent at the region's walls and
 * beyond, and between, along the line from the source through the listener,
 * a smooth fall (smoothstep) from the sphere to the wall that line meets. So
 * the fade always ends exactly at the edge of the hide region, whatever its
 * shape seen from the source.
 */
export function audioGain(source: Local, listener: Local, side: number, radius: number): number {
  if (!insideRegion(listener, side)) return 0
  const dir: Local = [listener[0] - source[0], listener[1] - source[1], listener[2] - source[2]]
  const d = Math.hypot(...dir)
  if (d <= radius) return 1
  const unit: Local = [dir[0] / d, dir[1] / d, dir[2] / d]
  const edge = exitDistance(source, unit, side)
  if (!(edge > radius)) return d < edge ? 1 : 0
  const t = Math.min(1, Math.max(0, (d - radius) / (edge - radius)))
  return 1 - t * t * (3 - 2 * t)
}
