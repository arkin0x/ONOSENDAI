/**
 * signWithin.ts: a signature, or a timeout. On its own so that the store and
 * the signers can both import it without a cycle (signers.ts reaches the relay
 * pool, which reaches the store, which reaches the signers).
 */

import type { EventTemplate, NostrEvent } from './events'

/**
 * How long a remote signer (extension, bunker) gets to sign one event. A
 * phone drops the signer's channel while the tab sits in a wallet app; a
 * signature that will never come must fail, not hang whatever awaited it.
 */
export const SIGN_PATIENCE_MS = 15_000

export class SignerTimeout extends Error {
  /**
   * Set when what timed out was waiting on a request bigger than some signer
   * apps can read, sent anyway (signerRequestSize.ts): what to make smaller
   * ("the shard", "it"). Null for an ordinary silence.
   */
  readonly big: string | null
  constructor(big: string | null = null) {
    super('the signer did not answer in time')
    this.name = 'SignerTimeout'
    this.big = big
  }
}

/**
 * What a move says when a request bigger than some signer apps can read went
 * out (TRY ANYWAY) and nothing came back: the signer is likely there, and the
 * size the likely reason, so pairing again is not the way out.
 */
export function bigSilenceWords(noun: string): string {
  return `Your signer did not answer. It may not handle messages this big. Make ${noun} smaller, or sign in with a key on this device.`
}

/** What to make smaller, when `err` is a timeout waiting on a big request; null otherwise. */
export function bigSilence(err: unknown): string | null {
  if (!(err instanceof Error) || err.name !== 'SignerTimeout') return null
  const big = (err as { big?: unknown }).big
  return typeof big === 'string' ? big : null
}

/** What a move says when its signer ran out of time: what to do, not only what happened. */
export const SIGNER_GONE_MESSAGE = 'Signer not answering. Open your signer app, then try again.'

/**
 * What a move says when a remote signer (NIP-46) ran out of time: the way out
 * of a pairing that went stale, as when the signer app moved to another
 * device and this one still asks the old pairing (arkinox, 2026-11-21).
 * LOG OUT and PAIR AGAIN are in the Identity panel and on the chip it raises.
 */
export const SIGNER_STUCK_MESSAGE = 'Your signer is not answering. LOG OUT and pair again.'

/**
 * The words for a signature that failed: a signer that ran out of time gets
 * SIGNER_GONE_MESSAGE (SIGNER_STUCK_MESSAGE for a remote signer, `kind`
 * nip46), or bigSilenceWords when it was waiting on a request bigger than
 * some signer apps can read; and a big request that was not sent
 * (signerRequestSize.ts) its own words, which already say what to do.
 */
export function signingFailed(err: unknown, kind?: string): string {
  const big = bigSilence(err)
  if (big !== null) return bigSilenceWords(big)
  // By name too: a SignerTimeout from another copy of this module (a test's reset) is still one.
  if (err instanceof SignerTimeout || (err instanceof Error && err.name === 'SignerTimeout')) return kind === 'nip46' ? SIGNER_STUCK_MESSAGE : SIGNER_GONE_MESSAGE
  if (err instanceof Error && err.name === 'SignerRequestTooBig') return err.message
  return `Signing failed: ${err instanceof Error ? err.message : String(err)}`
}

/**
 * How long a signer's handshake gets. Longer than one signature: an extension
 * may be waiting on someone to unlock it or to approve this site.
 */
export const HANDSHAKE_PATIENCE_MS = 60_000

/**
 * How long each step of a bunker's handshake (connect, then get_public_key)
 * gets before the attempt is given up as lost. A NIP-46 request lost in
 * transit (the bunker's relay socket dropped while it was away) is never
 * answered, and a handshake waiting on it held every RETRY for a minute and
 * more (the real-bunker run of 2026-11-04). Given up, it can be replaced;
 * its answer, if it still comes, is still taken (signers.ts deferredReconnect).
 */
export const HANDSHAKE_STEP_MS = SIGN_PATIENCE_MS

/** A handshake's answer, or a SignerTimeout once `ms` has passed. */
export async function handshakeWithin<T>(handshake: Promise<T>, ms: number = HANDSHAKE_PATIENCE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SignerTimeout()), ms) })
  try {
    return await Promise.race([handshake, late])
  } finally {
    clearTimeout(timer)
  }
}

const answeredListeners = new Set<() => void>()

/**
 * Be told whenever a remote signer answers a signature, in time or late: it
 * is there again. A relay whose NIP-42 AUTH failed while it was away signs in
 * once more (relay.ts). Returns the unsubscribe.
 */
export function onSignerAnswered(fn: () => void): () => void {
  answeredListeners.add(fn)
  return () => { answeredListeners.delete(fn) }
}

function signerAnswered(): void {
  for (const fn of [...answeredListeners]) {
    try { fn() } catch { /* one listener's failure is not the others' */ }
  }
}

const askAgainListeners = new Set<() => void>()

/**
 * Be told when a person asks the signer again on purpose (RETRY, CHECK
 * AGAIN): the store gives up a handshake or a channel that never answered,
 * so the request that follows goes out fresh. Returns the unsubscribe.
 */
export function onAskAgain(fn: () => void): () => void {
  askAgainListeners.add(fn)
  return () => { askAgainListeners.delete(fn) }
}

/** A deliberate tap asks the signer again (relay.ts retryFailedAuth). */
export function askAgain(): void {
  for (const fn of [...askAgainListeners]) {
    try { fn() } catch { /* one listener's failure is not the others' */ }
  }
}

/**
 * Big requests sent to a remote signer anyway and not yet answered
 * (signerRequestSize.ts): when each went out, and what to make smaller. A
 * signature that runs out of time with one of these sent after it began
 * says so (SignerTimeout.big). Forgotten after LATE_PATIENCE_MS.
 */
const bigAsks = new Set<{ at: number; noun: string }>()

/** A big request went out (TRY ANYWAY). Returns its end: answered, or failed on the way. */
export function noteBigAsk(noun: string): () => void {
  const now = Date.now()
  for (const a of bigAsks) if (now - a.at > LATE_PATIENCE_MS) bigAsks.delete(a)
  const ask = { at: now, noun }
  bigAsks.add(ask)
  return () => { bigAsks.delete(ask) }
}

/** What to make smaller, if a big request sent at or after `since` is still unanswered. */
function bigAskSince(since: number): string | null {
  for (const a of bigAsks) if (a.at >= since) return a.noun
  return null
}

/** Signature clocks running now; paused while a person is asked something first. */
const clocks = new Set<{ pause: () => void; resume: () => void }>()
let clockHolds = 0

/**
 * Stop every signature's clock while the person is asked whether to send a
 * request at all (signerRequestSize.ts, TRY ANYWAY): the time spent reading
 * the question is not the signer's. Returns the release, after which each
 * clock starts its full patience again, since that is when the request goes.
 */
export function holdSignClocks(): () => void {
  clockHolds++
  if (clockHolds === 1) for (const c of clocks) c.pause()
  let held = true
  return () => {
    if (!held) return
    held = false
    clockHolds--
    if (clockHolds === 0) for (const c of [...clocks]) c.resume()
  }
}

/**
 * The signature, or a SignerTimeout once SIGN_PATIENCE_MS has passed.
 *
 * `late`, when given, is handed the signature if it still comes after the
 * timeout. A move never takes one (its caller has moved on); a relay's AUTH
 * does, since signing in late beats not signing in (relay.ts authSign).
 */
export async function signWithin(signer: { signEvent: (template: EventTemplate) => Promise<NostrEvent> }, template: EventTemplate, ms: number = SIGN_PATIENCE_MS, late?: (signed: NostrEvent) => void): Promise<NostrEvent> {
  const startedAt = Date.now()
  // Asked before the timer is set: a signer that throws at once leaves no timer behind.
  const signing = signer.signEvent(template)
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let waitingLate: (() => void) | null = null
  let fire: () => void = () => {}
  const limit = new Promise<never>((_, reject) => {
    fire = () => {
      timedOut = true
      if (late) waitingLate = awaitLate()
      reject(new SignerTimeout(bigAskSince(startedAt)))
    }
  })
  // Not armed while the person is being asked whether to send it at all (holdSignClocks).
  const arm = (): void => { clearTimeout(timer); timer = clockHolds > 0 ? undefined : setTimeout(fire, ms) }
  const clock = { pause: () => { clearTimeout(timer); timer = undefined }, resume: arm }
  clocks.add(clock)
  arm()
  void signing.then((signed) => {
    // The late answer first: what is waiting on it is better served by it than by a fresh request.
    if (timedOut) late?.(signed)
    signerAnswered()
  }, () => { /* the caller hears the failure, or has moved on */ }).finally(() => { waitingLate?.() })
  try {
    return await Promise.race([signing, limit])
  } finally {
    clocks.delete(clock)
    clearTimeout(timer)
  }
}

/** How long a signature given up on is still waited for by its `late`. */
export const LATE_PATIENCE_MS = 5 * 60_000

let lateWaits = 0

/** Count one late wait, until it ends or LATE_PATIENCE_MS passes; returns its end. */
function awaitLate(): () => void {
  lateWaits++
  let open = true
  const end = (): void => {
    if (!open) return
    open = false
    clearTimeout(cap)
    lateWaits--
  }
  const cap = setTimeout(end, LATE_PATIENCE_MS)
  return end
}

/**
 * Signatures given up on whose late answer is still wanted (a relay's AUTH).
 * The store's wakeSigner leaves the signer's sockets alone while there are
 * any: dropped, the answer coming over them is lost, and the person who just
 * approved it is asked again.
 */
export function lateSignsPending(): number {
  return lateWaits
}

