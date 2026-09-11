/**
 * NearbyChip.tsx — there is something decrypted where you stand.
 *
 * The find chip says how many just arrived and goes when tapped. This one
 * stays as long as anything nearby is open to you, glowing like the find
 * chip, and opens the Nearby Loot list. It is the way back to that list
 * while spectating, when the menu is locked, and after the find chip has
 * been tapped away. Shown only when there is something to show.
 */

import { Gem } from 'lucide-react'
import { useNearbyLoot } from '../hooks/useNearbyLoot'
import { useShards } from '../store/useShards'

export function NearbyChip(): JSX.Element | null {
  const count = useNearbyLoot().length
  const open = useShards((s) => s.nearbyOpen)
  if (count === 0 || open) return null
  return (
    <button className="hyperbar hyperbar--found nearby__chip" onClick={() => useShards.getState().setNearbyOpen(true)} title="What your keys open where you stand">
      <Gem size={13} strokeWidth={2.25} aria-hidden />
      <span className="hyperbar__label">NEARBY {count}</span>
    </button>
  )
}
