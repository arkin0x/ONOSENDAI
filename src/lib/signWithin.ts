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
  constructor() {
    super('the signer did not answer in time')
    this.name = 'SignerTimeout'
  }
}

/**
 * How long a signer's handshake gets. Longer than one signature: an extension
 * may be waiting on someone to unlock it or to approve this site.
 */
export const HANDSHAKE_PATIENCE_MS = 60_000

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

/**
 * The signature, or a SignerTimeout once SIGN_PATIENCE_MS has passed.
 *
 * `late`, when given, is handed the signature if it still comes after the
 * timeout. A move never takes one (its caller has moved on); a relay's AUTH
 * does, since signing in late beats not signing in (relay.ts authSign).
 */
export async function signWithin(signer: { signEvent: (template: EventTemplate) => Promise<NostrEvent> }, template: EventTemplate, ms: number = SIGN_PATIENCE_MS, late?: (signed: NostrEvent) => void): Promise<NostrEvent> {
  // Asked before the timer is set: a signer that throws at once leaves no timer behind.
  const signing = signer.signEvent(template)
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let waitingLate: (() => void) | null = null
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      if (late) waitingLate = awaitLate()
      reject(new SignerTimeout())
    }, ms)
  })
  void signing.then((signed) => {
    // The late answer first: what is waiting on it is better served by it than by a fresh request.
    if (timedOut) late?.(signed)
    signerAnswered()
  }, () => { /* the caller hears the failure, or has moved on */ }).finally(() => { waitingLate?.() })
  try {
    return await Promise.race([signing, limit])
  } finally {
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

