/**
 * useSpeakeasies.ts - the speakeasies a coordinate stands in, from the one
 * shared lookup (lib/speakeasy.ts), so a panel mounted again asks nothing new.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createSpeakeasyLookup, inRegion, type Speakeasy, type SpeakeasyLookup } from '../lib/speakeasy'

/** fetch read on each call, not at import, so a test's stub is the one used. */
const lookup = createSpeakeasyLookup({ fetchFn: (input, init) => globalThis.fetch(input, init) })
/**
 * A second lookup, for where the relay places you when that is not your head
 * (hooks/useRelayPlacement): a frozen chain inside a region is admitted there
 * wherever its head has moved since.
 */
export const placedLookup = createSpeakeasyLookup({ fetchFn: (input, init) => globalThis.fetch(input, init) })

const NONE: Speakeasy[] = []

/**
 * The speakeasies holding `coord` (null: none, and nothing asked), longest
 * region first. `watching`: the panel is open, so a head that stays put is
 * asked about again when its answer expires.
 *
 * The lookup's list is filtered against `coord` here, at render: the Hud
 * unmounts when the menu closes, and the first render after it mounts again
 * comes before the effect that tells the lookup where the head is now. Without
 * this, a speakeasy left while the menu was closed flashed back for a frame.
 */
export function useSpeakeasies(coord: string | null, watching = false, from: SpeakeasyLookup = lookup): Speakeasy[] {
  useEffect(() => { from.update(coord) }, [coord, from])
  useEffect(() => (watching && coord ? from.watch() : undefined), [watching, coord, from])
  const list = useSyncExternalStore(from.subscribe, from.current, () => NONE)
  return useMemo(() => {
    if (!coord) return NONE
    const here = list.filter((s) => inRegion(s, coord))
    return here.length === list.length ? list : here
  }, [list, coord])
}
