/**
 * signerRequestSize.ts: how big a remote signer request may be, and the words
 * for one that is too big.
 *
 * A NIP-46 request (and its answer) travels as one NIP-44 message. A hide by
 * reference of a big shard asked a signer app to sign a kind 33331 object of
 * about 71,800 bytes; with the request around it that is more than one
 * standard NIP-44 message holds, and the signer app (Amber, on the owner's
 * phone) never showed a prompt: the hide waited for the signer's time limit
 * and said only that the signer was not answering (arkinox, 2026-11-21). Such
 * a request is now never sent, and fails at once in words that name the sizes.
 */

import { v2 as nip44 } from 'nostr-tools/nip44'
import { MODEL_KIND } from './itemModel'

/**
 * The most plaintext one NIP-44 v2 message holds, in bytes. Its length prefix
 * is two bytes, so 65,535 is the standard maximum. nostr-tools (2.24) goes
 * past it with an extended length prefix, but signer apps in use (Amber among
 * them) do not decrypt that, and drop the request without a word. So a
 * request, or the answer it asks for, longer than this is not sent to a
 * remote signer at all. A key on this device is not limited by it.
 */
export const NIP44_MAX_PLAINTEXT_BYTES = 65_535

const utf8 = new TextEncoder()
const bytesOf = (text: string): number => utf8.encode(text).length

/** Length of `n` bytes as base64. */
const base64Length = (n: number): number => 4 * Math.ceil(n / 3)

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
    if (n < 1 || n > NIP44_MAX_PLAINTEXT_BYTES) return null
    // version (1) + nonce (32) + length prefix (2) + padded plaintext + MAC (32), as base64.
    return 'x'.repeat(base64Length(1 + 32 + 2 + nip44.utils.calcPaddedLen(n) + 32))
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

/** Bytes as whole kilobytes, rounded up, so a size just past the limit never reads as the limit. */
const kb = (bytes: number): number => Math.ceil(bytes / 1000)

/** The words for a request too big for a signer app: what it can take, what this needs, what to do. */
export function signerRequestTooBigMessage(method: string, params: readonly string[], bytes: number): string {
  const sizes = `(it can take about ${Math.floor(NIP44_MAX_PLAINTEXT_BYTES / 1000)} KB, this needs ${kb(bytes)} KB)`
  if (method === 'nip44_decrypt' || method === 'nip04_decrypt') {
    return `This is too big for your signer app to open ${sizes}. Sign in with a key on this device to open it.`
  }
  const verb = method === 'sign_event' ? 'sign' : method.endsWith('_encrypt') ? 'seal' : 'handle'
  let noun = 'it'
  if (method === 'sign_event') {
    try { if ((JSON.parse(params[0] ?? '') as { kind?: unknown }).kind === MODEL_KIND) noun = 'the shard' } catch { /* it */ }
  }
  return `This is too big for your signer app to ${verb} ${sizes}. Make ${noun} smaller, or sign in with a key on this device.`
}

/** A remote signer request that was not sent, because it (or its answer) is more than one NIP-44 message holds. */
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
 * Hold every request `bunker` sends to NIP44_MAX_PLAINTEXT_BYTES: one too big
 * (or whose answer would be) is never published, and rejects at once with a
 * SignerRequestTooBig. Every NIP-46 method goes through sendRequest
 * (sign_event, nip44/nip04 encrypt and decrypt, get_public_key, connect), so
 * this one guard covers them all. Guarding the same bunker twice is a no-op.
 */
export function guardRequestSize<T extends Requester>(bunker: T): T {
  if (guarded.has(bunker)) return bunker
  guarded.add(bunker)
  const send = bunker.sendRequest.bind(bunker)
  bunker.sendRequest = (method: string, params: string[]): Promise<string> => {
    // The id nostr-tools will give this request: its prefix, then the next serial.
    const own = bunker as unknown as { idPrefix?: unknown; serial?: unknown }
    const prefix = typeof own.idPrefix === 'string' ? own.idPrefix : 'xxxxxx'
    const serial = typeof own.serial === 'number' ? own.serial + 1 : 1
    const bytes = nip46PlaintextBytes(method, params, `${prefix}-${serial}`)
    if (bytes > NIP44_MAX_PLAINTEXT_BYTES) return Promise.reject(new SignerRequestTooBig(method, params, bytes))
    return send(method, params)
  }
  return bunker
}
