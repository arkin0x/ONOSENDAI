/**
 * useRelayPlacement.ts - where a speakeasy's relay places you now
 * (lib/relayPlacement.ts), from the published part of your chain, and only
 * while LIVE: the relay judges the chain it holds.
 *
 * Undefined while it cannot be said yet: a chain with version 1 hops waits for
 * the 5.13 list (lib/v1HopList). The list is the app's one copy
 * (lib/chainStop.ts), so a panel mounted again has it on its first render and
 * shows nothing stale. Null when
 * nothing is published, not LIVE, or `watching` is off (the Position panel is
 * folded): then nothing is loaded or walked at all.
 *
 * A fork the relays cannot see is not the relay's stop: a branch still held
 * or on its way never reached them. buildChain marks the fork from every
 * event this device has, so it counts only when two branches are published;
 * otherwise this says nothing (null), rather than send you to a respawn the
 * relay does not ask for.
 */

import { useEffect, useMemo } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { publishedLength } from '../lib/speakeasy'
import { needsV1HopList, relayPlacement, type RelayPlacement } from '../lib/relayPlacement'
import { ensureV1HopList } from '../lib/chainStop'
import { useV1HopList } from './useChainStop'

const NO_LIST: ReadonlySet<string> = new Set()

export function useRelayPlacement(watching = true): RelayPlacement | null | undefined {
  const actions = useCyberspace((s) => (s.live && watching ? s.actions() : null))
  const published = useCyberspace((s) => s.published)
  const list = useV1HopList()
  const chain = useMemo(() => (actions ? actions.slice(0, publishedLength(actions, published)) : null), [actions, published])
  const need = useMemo(() => !!chain && needsV1HopList(chain), [chain])
  // A failed load says nothing, and leaves the line empty: asked again on the next mount.
  useEffect(() => { if (need && !list) ensureV1HopList() }, [need, list])
  return useMemo(() => {
    if (!chain || chain.length === 0) return null
    const fork = chain[0].fork
    if (fork && fork.branchIds.filter((id) => published[id] === 'ok').length < 2) return null
    if (need && !list) return undefined
    return relayPlacement(chain, list ?? NO_LIST)
  }, [chain, need, list, published])
}
