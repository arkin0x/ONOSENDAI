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

/** The signature, or a SignerTimeout once SIGN_PATIENCE_MS has passed. */
export async function signWithin(signer: { signEvent: (template: EventTemplate) => Promise<NostrEvent> }, template: EventTemplate, ms: number = SIGN_PATIENCE_MS): Promise<NostrEvent> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SignerTimeout()), ms) })
  try {
    return await Promise.race([signer.signEvent(template), late])
  } finally {
    clearTimeout(timer)
  }
}

