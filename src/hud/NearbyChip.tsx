/**
 * NearbyChip.tsx — there is something decrypted where you stand.
 *
 * The find chip says how many just arrived and goes when tapped. This one
 * stays as long as anything nearby is open to you, glowing like the find
 * chip, and opens the Nearby Loot list. It is the way back to that list
 * while spectating, when the menu is locked, and after the find chip has
 * been tapped away. Built on the same markup as the scan chip beside it,
 * so the two read as one row of the same instrument: the same 9px label,
 * the same 29px height, a 12px mark.
 */

import { Gem } from 'lucide-react'
import { useNearbyLoot } from '../hooks/useNearbyLoot'
import { useShards } from '../store/useShards'

export function NearbyChip(): JSX.Element | null {
  const count = useNearbyLoot().length
  const open = useShards((s) => s.nearbyOpen)
  if (count === 0 || open) return null
  return (
    <div className="hyperbar presence hyperbar--found nearby__chip" role="status">
      <button className="presence__head" onClick={() => useShards.getState().setNearbyOpen(true)} title="What your keys open where you stand">
        <Gem size={12} strokeWidth={2.25} aria-hidden />
        <span className="hyperbar__label">NEARBY {count}</span>
      </button>
    </div>
  )
}
