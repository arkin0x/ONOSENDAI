/**
 * authOpen.ts - the relays whose NIP-42 AUTH the signer is holding up
 * (normalized URL): still signing it, or its last signature ran out of time
 * or was refused. relay.ts keeps this in step; a relay leaves it when it
 * signs in, or when its AUTH ends for a reason that is not the signer's.
 *
 * Its own module so the store can tell a person to check their signer
 * without importing lib/relay, which most test files mock.
 */
export const signerHeld = new Set<string>()

/** Whether the signer is holding up any relay's AUTH right now. */
export function signerWaiting(): boolean {
  return signerHeld.size > 0
}
