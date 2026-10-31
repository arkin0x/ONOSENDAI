/**
 * authOpen.ts - the relays whose AUTH is not finished, normalized URL to the
 * relay it is on. A signer can take as long as a person takes, and nostr-tools
 * never settles an AUTH whose signer rejected. Keyed per relay, so an old
 * socket's AUTH ending cannot clear a newer socket's. Its own module, so the
 * store can tell a person to check their signer without importing lib/relay.
 */
export const authOpen = new Map<string, object>()

/** Whether a relay is waiting on the signer right now. */
export function signerWaiting(): boolean {
  return authOpen.size > 0
}
