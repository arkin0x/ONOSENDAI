/**
 * useRelayPlacement.ts - where a speakeasy's relay places you now
 * (lib/relayPlacement.ts), from the published part of your chain, and only
 * while LIVE: the relay judges the chain it holds.
 *
 * Undefined while it cannot be said yet: a chain with version 1 hops waits for
 * the 5.13 list (lib/v1HopList). The list is kept here once loaded, so a panel
 * mounted again has it on its first render and shows nothing stale. Null when
 * nothing is published, not LIVE, or `watching` is off (the Position panel is
 * folded): then nothing is loaded or walked at all.
 *
 * A fork the relays cannot see is not the relay's stop: a branch still held
 * or on its way never reached them. buildChain marks the fork from every
 * event this device has, so it counts only when two branches are published;
 * otherwise this says nothing (null), rather than send you to a respawn the
 * relay does not ask for.
 */

import { useEffect, useMemo, useState } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { publishedLength } from '../lib/speakeasy'
import { needsV1HopList, relayPlacement, type RelayPlacement } from '../lib/relayPlacement'
import { loadV1HopList } from '../lib/v1HopList'

const NO_LIST: ReadonlySet<string> = new Set()
/** The 5.13 list once loaded, for the first render of every later mount. */
let listed: ReadonlySet<string> | null = null

export function useRelayPlacement(watching = true): RelayPlacement | null | undefined {
  const actions = useCyberspace((s) => (s.live && watching ? s.actions() : null))
  const published = useCyberspace((s) => s.published)
  const [list, setList] = useState<ReadonlySet<string> | null>(listed)
  const chain = useMemo(() => (actions ? actions.slice(0, publishedLength(actions, published)) : null), [actions, published])
  const need = useMemo(() => !!chain && needsV1HopList(chain), [chain])
  useEffect(() => {
    if (!need || list) return
    let on = true
    // A failed load says nothing, and leaves the line empty: asked again on the next mount.
    loadV1HopList().then((l) => { listed = l; if (on) setList(l) }, () => undefined)
    return () => { on = false }
  }, [need, list])
  return useMemo(() => {
    if (!chain || chain.length === 0) return null
    const fork = chain[0].fork
    if (fork && fork.branchIds.filter((id) => published[id] === 'ok').length < 2) return null
    if (need && !list) return undefined
    return relayPlacement(chain, list ?? NO_LIST)
  }, [chain, need, list, published])
}
