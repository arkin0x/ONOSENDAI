/**
 * useSpeakeasies.ts - the speakeasies a coordinate stands in, from the one
 * shared lookup (lib/speakeasy.ts), so a panel mounted again asks nothing new.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { createSpeakeasyLookup, type Speakeasy, type SpeakeasyLookup } from '../lib/speakeasy'

/** fetch read on each call, not at import, so a test's stub is the one used. */
const lookup = createSpeakeasyLookup({ fetchFn: (input, init) => globalThis.fetch(input, init) })

const NONE: Speakeasy[] = []

/** The speakeasies holding `coord` (null: none asked), longest region first. */
export function useSpeakeasies(coord: string | null, from: SpeakeasyLookup = lookup): Speakeasy[] {
  useEffect(() => { from.update(coord) }, [coord, from])
  return useSyncExternalStore(from.subscribe, from.current, () => NONE)
}
