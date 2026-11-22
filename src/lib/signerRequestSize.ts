/**
 * signerRequestSize.ts: how big a remote signer request may be, and what is
 * said when a big one gets no answer.
 *
 * A NIP-46 request (and its answer) travels as one NIP-44 message inside a
 * kind 24133 event. Past 65,535 bytes of plaintext NIP-44 uses an extended
 * length prefix, which nostr-tools 2.24 writes and reads. #835 refused such
 * requests on the belief that Amber could not read it, and #861 made that a
 * TRY ANYWAY question. The belief was wrong: Amber's NIP-44 (Quartz 2.3.0,
 * Nip44v2.pad and unpad) reads and writes the extended prefix, and the owner
 * has always signed big shards with Amber. The failure that started it was
 * the signer relay refusing kind 24133 events past 96 KB (cyberspace-relay
 * #42, raised to 512 KB in #43).
 *
 * So a request of any size goes, up to what the signer relay carries in one
 * kind 24133 event; past that it is refused at once, in words. A big one
 * that gets no answer is said to be maybe too big for that signer
 * (signWithin.ts bigSilenceWords), for a signer app that truly cannot.
 */

import { v2 as nip44 } from 'nostr-tools/nip44'
import { MODEL_KIND } from './itemModel'
import { noteBigAsk } from './signWithin'
import { noteBigAnswered } from './signerActivity'

/**
 * The most plaintext a NIP-44 v2 message holds with its standard two-byte
 * length prefix. Past it the extended prefix is used. Not a limit on what is
 * sent: a request past it goes, and only a silence after it is said to be
 * maybe about its size (signWithin.ts bigSilenceWords).
 */
export const NIP44_MAX_PLAINTEXT_BYTES = 65_535

/**
 * The most a kind 24133 event may be on the signer relay: relay.onosendai.tech
 * takes up to its max_event_size, 512 KB (cyberspace-relay #43). A request (or
 * an answer) whose event would be larger can never arrive, so it is refused
 * at once. Held for every signer relay: one that takes
 * less is not known to take more.
 */
export const SIGNER_RELAY_EVENT_BYTES = 524_288

/** What a kind 24133 event carries besides its content: id, pubkey, sig, the p tag, kind, created_at and the JSON around them. */
const EVENT_ENVELOPE_BYTES = 512

const utf8 = new TextEncoder()
const bytesOf = (text: string): number => utf8.encode(text).length

/** Length of `n` bytes as base64. */
const base64Length = (n: number): number => 4 * Math.ceil(n / 3)

/** A NIP-44 v2 payload's length for `n` bytes of plaintext: version, nonce, length prefix (2, or 6 past 65,535), padded plaintext and MAC, as base64. */
function nip44PayloadLength(n: number): number {
  const prefix = n > NIP44_MAX_PLAINTEXT_BYTES ? 6 : 2
  return base64Length(1 + 32 + prefix + nip44.utils.calcPaddedLen(n) + 32)
}

/** The bytes of the kind 24133 event that carries `plaintextBytes` of NIP-46 request or answer. */
export function nip46EventBytes(plaintextBytes: number): number {
  return nip44PayloadLength(Math.max(1, plaintextBytes)) + EVENT_ENVELOPE_BYTES
}

/** A placeholder for a 32-byte hex field (an id, a pubkey) the signer adds to its answer. */
const HEX32 = '0'.repeat(64)

/**
 * The answer a request asks for, as near as it can be told before it is
 * sent: what the signer must fit into its own NIP-44 message back. Only the
 * answers that can be bigger than their request are worked out; a decrypt's
 * plaintext is smaller than the ciphertext it was asked with, and a public
 * key is tiny, so those return null.
 */
function answerResult(method: string, params: readonly string[]): string | null {
  if (method === 'sign_event') {
    // The signed event, as a JSON string: the template plus id, pubkey and sig.
    try {
      const template = JSON.parse(params[0] ?? '') as Record<string, unknown>
      return JSON.stringify({ ...template, id: HEX32, pubkey: HEX32, sig: HEX32 + HEX32 })
    } catch {
      return null
    }
  }
  if (method === 'nip44_encrypt') {
    const n = bytesOf(params[1] ?? '')
    if (n < 1) return null
    return 'x'.repeat(nip44PayloadLength(n))
  }
  if (method === 'nip04_encrypt') {
    // AES-CBC with PKCS#7 padding, as base64, then "?iv=" and the 16-byte IV as base64.
    const n = bytesOf(params[1] ?? '')
    return 'x'.repeat(base64Length(16 * (Math.floor(n / 16) + 1)) + 4 + 24)
  }
  return null
}

/**
 * Room left on a predicted answer for what a signer may add around it: an
 * `"error":null` beside the result, or non-ASCII written as \uXXXX escapes.
 */
const ANSWER_SLACK_BYTES = 256

/**
 * The bytes of NIP-44 plaintext a NIP-46 request needs: its own JSON, or the
 * answer it asks for (with ANSWER_SLACK_BYTES on top), whichever is longer.
 * `id` is the request id it will be sent with (its length counts).
 */
export function nip46PlaintextBytes(method: string, params: readonly string[], id: string): number {
  const request = bytesOf(JSON.stringify({ id, method, params }))
  const result = answerResult(method, params)
  return result === null ? request : Math.max(request, bytesOf(JSON.stringify({ id, result })) + ANSWER_SLACK_BYTES)
}

/** What to make smaller for a request: "the shard" when it signs one, else "it". */
export function requestNoun(method: string, params: readonly string[]): string {
  if (method !== 'sign_event') return 'it'
  try { if ((JSON.parse(params[0] ?? '') as { kind?: unknown }).kind === MODEL_KIND) return 'the shard' } catch { /* it */ }
  return 'it'
}

/** The words for a request past what the signer relay carries: the sizes, and what to do. */
export function signerRequestTooBigMessage(method: string, params: readonly string[], bytes: number): string {
  const opening = method === 'nip44_decrypt' || method === 'nip04_decrypt'
  const way = opening ? 'Sign in with a key on this device to open it.' : `Make ${requestNoun(method, params)} smaller, or sign in with a key on this device.`
  return `This is too big to send to a signer app (its relay takes up to ${SIGNER_RELAY_EVENT_BYTES / 1024} KB, this needs ${Math.ceil(nip46EventBytes(bytes) / 1024)} KB). ${way}`
}

/** A remote signer request that was not sent: past what the signer relay carries in one kind 24133 event. */
export class SignerRequestTooBig extends Error {
  readonly bytes: number
  constructor(method: string, params: readonly string[], bytes: number) {
    super(signerRequestTooBigMessage(method, params, bytes))
    this.name = 'SignerRequestTooBig'
    this.bytes = bytes
  }
}

/** What a bunker's sendRequest looks like, as far as the guard needs it. */
interface Requester {
  sendRequest(method: string, params: string[]): Promise<string>
}

const guarded = new WeakSet<object>()

/**
 * Measure every request `bunker` sends, as `session`'s. Every NIP-46 method
 * goes through sendRequest (sign_event, nip44/nip04 encrypt and decrypt,
 * get_public_key, connect), so this one guard covers them all:
 *
 * - past what the signer relay carries in one event, it is never sent, and
 *   rejects at once with a SignerRequestTooBig;
 * - past NIP44_MAX_PLAINTEXT_BYTES (the request or its answer), it goes, and
 *   is noted until answered: a signature that times out on it says the
 *   signer may not handle messages this big (SignerTimeout.big);
 * - anything smaller simply goes.
 *
 * Guarding the same bunker twice is a no-op.
 */
export function guardRequestSize<T extends Requester>(bunker: T, session: string): T {
  if (guarded.has(bunker)) return bunker
  guarded.add(bunker)
  const send = bunker.sendRequest.bind(bunker)
  bunker.sendRequest = async (method: string, params: string[]): Promise<string> => {
    // The id nostr-tools will give this request: its prefix, then the next serial.
    const own = bunker as unknown as { idPrefix?: unknown; serial?: unknown }
    const prefix = typeof own.idPrefix === 'string' ? own.idPrefix : 'xxxxxx'
    const serial = typeof own.serial === 'number' ? own.serial + 1 : 1
    const bytes = nip46PlaintextBytes(method, params, `${prefix}-${serial}`)
    if (bytes <= NIP44_MAX_PLAINTEXT_BYTES) return send(method, params)
    if (nip46EventBytes(bytes) > SIGNER_RELAY_EVENT_BYTES) throw new SignerRequestTooBig(method, params, bytes)
    const settled = noteBigAsk(session, requestNoun(method, params))
    try {
      const result = await send(method, params)
      noteBigAnswered(session)
      return result
    } catch (err) {
      // nostr-tools rejects with the signer's own words (a string) when it
      // answered with an error: it read the request all the same.
      if (typeof err === 'string') noteBigAnswered(session)
      throw err
    } finally {
      settled()
    }
  }
  return bunker
}
