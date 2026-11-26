/**
 * NearbyChip.tsx — there is something decrypted where you stand.
 *
 * It stays as long as anything nearby is open to you, glowing, and opens the
 * Nearby Loot list. It is the way to that list while spectating and when the
 * menu is locked. Built on the same markup as the scan chip beside it, so
 * the two read as one row of the same instrument: the same 9px label, the
 * same 29px height, a 12px mark. Not in BUILD mode (arkinox, 2026-11-02: the
 * Nearby and Chain chips hidden while building).
 *
 * NEARBY 168 +12: the orange +12 is how many of those were found since the
 * list was last opened (store/nearbyNew.ts). It took the place of the FOUND
 * HERE chip (owner, 2026-11-26: "the found here chip is always too long...
 * then people know that new stuff has been discovered nearby without the
 * clutter"). The figures are tabular, so a count that changes never nudges
 * the chip by a hair.
 */

import { Gem } from 'lucide-react'
import { useNearbyLoot } from '../hooks/useNearbyLoot'
import { useShards } from '../store/useShards'
import { useBuilder } from '../store/useBuilder'
import { freshAmong, useNearbyNew } from '../store/nearbyNew'

export function NearbyChip(): JSX.Element | null {
  const items = useNearbyLoot()
  const fresh = freshAmong(items.map((it) => it.key), useNearbyNew())
  const open = useShards((s) => s.nearbyOpen)
  const building = useBuilder((s) => s.active)
  const count = items.length
  if (count === 0 || open || building) return null
  const title = fresh > 0 ? `What your keys open where you stand: ${fresh} new since you last looked` : 'What your keys open where you stand'
  return (
    <div className="hyperbar presence hyperbar--found nearby__chip" role="status">
      <button className="presence__head" onClick={() => useShards.getState().setNearbyOpen(true)} title={title} aria-label={fresh > 0 ? `Nearby, ${count}, ${fresh} new` : `Nearby, ${count}`}>
        <Gem size={12} strokeWidth={2.25} aria-hidden />
        <span className="hyperbar__label">
          NEARBY <span className="nearby__total">{count}</span>
          {fresh > 0 && <span className="nearby__new">+{fresh}</span>}
        </span>
      </button>
    </div>
  )
}
