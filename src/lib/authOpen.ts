/**
 * authOpen.ts - the relays whose NIP-42 AUTH the signer is holding up
 * (normalized URL): still signing it, or its last signature ran out of time
 * or was refused. relay.ts keeps this in step; a relay leaves it when it
 * signs in, or when its AUTH ends for a reason that is not the signer's.
 *
 * Its own module so the store can tell a person to check their signer
 * without importing lib/relay, which most test files mock.
 */
import { normalizeURL } from 'nostr-tools/utils'

export const signerHeld = new Set<string>()

/**
 * Whether the signer is holding up the AUTH of one of `relays` right now:
 * the canonical relay and the relays known to hold your chain, so a relay
 * that has nothing to do with it does not say "Check your signer.".
 */
export function signerWaiting(relays: Iterable<string>): boolean {
  for (const url of relays) if (signerHeld.has(normalizeURL(url))) return true
  return false
}
