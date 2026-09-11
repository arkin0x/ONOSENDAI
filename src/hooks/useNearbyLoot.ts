/**
 * useNearbyLoot.ts — the items decrypted in the region the anchor stands in.
 *
 * Every placed thing this client has opened or placed, filtered by lib/nearby:
 * its own cube holds the anchor, or it is filed under a key you hold whose
 * region does. Recomputed when the anchor, the plane, the finds or the keys
 * change, so the chip's count, the panel's button and the list agree.
 */

import { useMemo } from 'react'
import { nearbyItems } from '../lib/nearby'
import { useCyberspace } from '../store/useCyberspace'
import { useSecrets } from '../store/useSecrets'
import { useShards, type WorldItem } from '../store/useShards'

export type NearbyItem = WorldItem & { distance: bigint }

export function useNearbyLoot(): NearbyItem[] {
  const anchor = useCyberspace((s) => s.anchor)
  const plane = useCyberspace((s) => s.anchorPlane)
  const discovered = useShards((s) => s.discovered)
  const mine = useShards((s) => s.mine)
  const keys = useSecrets((s) => s.keys)
  return useMemo(() => {
    const held = Object.values(keys)
    return nearbyItems(useShards.getState().worldItems(), held, anchor, plane)
    // discovered and mine are what worldItems reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, plane, discovered, mine, keys])
}
