
// 1. Get EOSE for drift events for the identity.pubkey. "Loading" state until then.
// 2. Query for nearby aggressive events
// 3. Reconcile the avatars state from a chronological timeline of both drift and aggressive events

import { Filter } from "nostr-tools"
import { useEffect } from "react"

export const useCyberspaceStateReconciler = () => {
  useEffect(() => {
    const filter: Filter<333> = {kinds: [333]}
    const relayList: RelayList = getRelayList(relays, ['read'])
    const sub = pool.sub(relayList, [filter])
    // get places from your relays
    sub.on('event', (event) => {

}