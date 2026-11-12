/**
 * useChainStop.ts - where a chain stops (lib/chainStop.ts), for a component:
 * your own chain (useChainStop) or any chain held in the store, the one you
 * spectate included (useChainStopOf).
 *
 * Undefined while it cannot be said yet: a chain with a version 1 hop waits
 * for the 5.13 list, which this loads when it is needed, so nothing flashes a
 * verdict that the list would take back. The list is one for the whole app:
 * once loaded, every later mount has it on its first render.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { chainStopOf, ensureV1HopList, onV1HopList, v1HopListNow, type ChainStop } from '../lib/chainStop'
import type { ActionEvent } from '../lib/events'

/** The 5.13 list once loaded, else null; re-renders when it loads. Never loads it. */
export function useV1HopList(): ReadonlySet<string> | null {
  return useSyncExternalStore(onV1HopList, v1HopListNow, v1HopListNow)
}

/** Where `chain` stops (null for no chain), kept in `slot`; loads the 5.13 list when only it can say. */
export function useChainStopOf(chain: ActionEvent[] | null, slot: string): ChainStop | null | undefined {
  const list = useV1HopList()
  // The list is read inside chainStopOf; it is a dependency so its arrival reads the chain again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stop = useMemo(() => (chain ? chainStopOf(chain, slot) : null), [chain, slot, list])
  useEffect(() => { if (stop === undefined) ensureV1HopList() }, [stop])
  return stop
}

/** Where your own chain stops, read once per chain change. */
export function useChainStop(): ChainStop | null | undefined {
  const events = useCyberspace((s) => s.events)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const actions = useMemo(() => useCyberspace.getState().actions(), [events])
  return useChainStopOf(actions, 'own')
}
