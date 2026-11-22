/**
 * signerRequestSize.ts: how big a remote signer request may be, and what is
 * said about a big one.
 *
 * A NIP-46 request (and its answer) travels as one NIP-44 message inside a
 * kind 24133 event. Past 65,535 bytes of plaintext NIP-44 uses an extended
 * length prefix (nostr-tools 2.24 writes it). A hide by reference of a big
 * shard once waited out the signer's time limit with no prompt, and that was
 * put down to the signer app not reading the extended prefix, so such
 * requests were refused outright (#835). The real cause was the signer
 * relay refusing kind 24133 events past 96 KB (relay #42, raised to 512 KB in
 * #43), and the owner's signer app (Amber) has answered requests past 65,535
 * bytes (arkinox, 2026-11-22: "We're assuming it can't sign any more than
 * that limit, but what if we're wrong?").
 *
 * So a request past 65,535 bytes is now a question, not a refusal: the
 * person is told some signer apps cannot read it and chooses TRY ANYWAY or
 * not. A signer that answers one is not asked about again for that session
 * (signerActivity.ts readsBig), and one that stays silent is said to have
 * maybe not handled it (signWithin.ts bigSilenceWords). Only the signer
 * relay's real cap on a kind 24133 event refuses a request outright.
 */

import { create } from 'zustand'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { MODEL_KIND } from './itemModel'
import { holdSignClocks, noteBigAsk } from './signWithin'
import { activityOf, noteReadsBig } from './signerActivity'

/**
 * The most plaintext a NIP-44 v2 message holds with its standard two-byte
 * length prefix. Past it nostr-tools uses the extended prefix, which some
 * signer apps may not read, so a request (or the answer it asks for) longer
 * than this is asked about first (TRY ANYWAY). It is a warning, not a cap: a
 * signer that answers one is not asked about again. A key on this device is
 * not limited by it.
 */
export const NIP44_MAX_PLAINTEXT_BYTES = 65_535

/**
 * The most a kind 24133 event may be on the signer relay: relay.onosendai.tech
 * takes up to its max_event_size, 512 KB (cyberspace-relay #43). A request (or
 * an answer) whose event would be larger can never arrive, so it is refused
 * at once, never asked about. Held for every signer relay: one that takes
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

/** Bytes as whole kilobytes, rounded up, so a size just past the limit never reads as the limit. */
const kb = (bytes: number): number => Math.ceil(bytes / 1000)

/** What to make smaller for a request: "the shard" when it signs one, else "it". */
export function requestNoun(method: string, params: readonly string[]): string {
  if (method !== 'sign_event') return 'it'
  try { if ((JSON.parse(params[0] ?? '') as { kind?: unknown }).kind === MODEL_KIND) return 'the shard' } catch { /* it */ }
  return 'it'
}

const isOpen = (method: string): boolean => method === 'nip44_decrypt' || method === 'nip04_decrypt'

/** "(about 65 KB, this needs 73 KB)": what some signer apps read, and what this needs. */
const sizesWords = (bytes: number): string => `(about ${Math.floor(NIP44_MAX_PLAINTEXT_BYTES / 1000)} KB, this needs ${kb(bytes)} KB)`

/** The question asked before a big request goes: what it is, and the two ways on. */
export function signerRequestBigWords(method: string, params: readonly string[], bytes: number): string {
  const head = `This is bigger than some signer apps can read ${sizesWords(bytes)}.`
  if (isOpen(method)) return `${head} TRY ANYWAY, or sign in with a key on this device to open it.`
  return `${head} TRY ANYWAY, or make ${requestNoun(method, params)} smaller.`
}

/** Why a request was not sent: the person chose not to (`declined`), or the signer relay could never carry it (`relay`). */
export type TooBigReason = 'declined' | 'relay'

/** The words for a big request that was not sent: why, the sizes, and what to do. */
export function signerRequestTooBigMessage(method: string, params: readonly string[], bytes: number, reason: TooBigReason = 'relay'): string {
  const way = isOpen(method) ? 'Sign in with a key on this device to open it.' : `Make ${requestNoun(method, params)} smaller, or sign in with a key on this device.`
  if (reason === 'declined') return `Not sent: this is bigger than some signer apps can read ${sizesWords(bytes)}. ${way}`
  const event = nip46EventBytes(bytes)
  return `This is too big to send to a signer app (its relay takes up to ${SIGNER_RELAY_EVENT_BYTES / 1024} KB, this needs ${Math.ceil(event / 1024)} KB). ${way}`
}

/** A remote signer request that was not sent: the person did not TRY ANYWAY, or it is past what the signer relay carries. */
export class SignerRequestTooBig extends Error {
  readonly bytes: number
  readonly reason: TooBigReason
  constructor(method: string, params: readonly string[], bytes: number, reason: TooBigReason = 'relay') {
    super(signerRequestTooBigMessage(method, params, bytes, reason))
    this.name = 'SignerRequestTooBig'
    this.bytes = bytes
    this.reason = reason
  }
}

/** The question on screen: a big request waiting for TRY ANYWAY or not. */
export interface BigRequestQuestion {
  /** The signer session it is for (Signer.session). */
  session: string
  method: string
  /** "the shard" or "it". */
  noun: string
  bytes: number
  /** What the question says (signerRequestBigWords). */
  words: string
  /** TRY ANYWAY (true) or not (false). Answers once. */
  answer: (go: boolean) => void
}

/** The big-request question, drawn by SignerControls.tsx; null when none is open. */
export const useBigRequestQuestion = create<{ question: BigRequestQuestion | null }>(() => ({ question: null }))

/** The question open now, if any: a second big request waits on its answer instead of asking again. */
let openQuestion: Promise<boolean> | null = null

/**
 * Ask the person whether to send a big request. Every signature's clock is
 * held while they read (signWithin.ts holdSignClocks), so the time spent
 * deciding never counts against the signer.
 */
function askTryAnyway(session: string, method: string, params: readonly string[], bytes: number): Promise<boolean> {
  if (openQuestion) return openQuestion
  const release = holdSignClocks()
  const asked = new Promise<boolean>((resolve) => {
    let answered = false
    useBigRequestQuestion.setState({
      question: {
        session,
        method,
        noun: requestNoun(method, params),
        bytes,
        words: signerRequestBigWords(method, params, bytes),
        answer: (go) => {
          if (answered) return
          answered = true
          openQuestion = null
          useBigRequestQuestion.setState({ question: null })
          release()
          resolve(go)
        },
      },
    })
  })
  openQuestion = asked
  return asked
}

/**
 * Requests the person already chose TRY ANYWAY for, by their session,
 * method and params, for a short while: the store asks a silent signer once more over
 * fresh sockets (useCyberspace signEvent), and that same request is not
 * asked about twice.
 */
const triedAnyway = new Map<string, number>()
const TRIED_ANYWAY_MS = 2 * 60_000

const requestKey = (session: string, method: string, params: readonly string[]): string => `${session}\n${method}\n${params.join('\n')}`

function alreadyTried(key: string): boolean {
  const now = Date.now()
  for (const [k, at] of triedAnyway) if (now - at > TRIED_ANYWAY_MS) triedAnyway.delete(k)
  return triedAnyway.has(key)
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
 * - up to NIP44_MAX_PLAINTEXT_BYTES (the request or its answer), it goes;
 * - past what the signer relay carries in one event, it is never sent, and
 *   rejects at once with a SignerRequestTooBig (reason `relay`);
 * - in between, the person is asked first (TRY ANYWAY), unless this
 *   session's signer has already answered a big request. Not tried, it
 *   rejects with a SignerRequestTooBig (reason `declined`). Sent, an answer
 *   (a refusal included: the signer read it) marks the signer as reading big
 *   messages; a signature that times out on it says so (SignerTimeout.big).
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
    if (nip46EventBytes(bytes) > SIGNER_RELAY_EVENT_BYTES) throw new SignerRequestTooBig(method, params, bytes, 'relay')
    const key = requestKey(session, method, params)
    if (!activityOf(session).readsBig && !alreadyTried(key)) {
      if (!(await askTryAnyway(session, method, params, bytes))) throw new SignerRequestTooBig(method, params, bytes, 'declined')
      triedAnyway.set(key, Date.now())
    }
    const settled = noteBigAsk(requestNoun(method, params))
    try {
      const result = await send(method, params)
      noteReadsBig(session)
      return result
    } catch (err) {
      // nostr-tools rejects with the signer's own words (a string) when it
      // answered with an error: it read the request all the same.
      if (typeof err === 'string') noteReadsBig(session)
      throw err
    } finally {
      settled()
    }
  }
  return bunker
}
