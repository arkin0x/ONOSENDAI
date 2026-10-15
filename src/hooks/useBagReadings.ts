/**
 * useBagReadings.ts: what opening a bag found, as React state.
 *
 * The readings live in lib/hidden beside the code that opens bags, so the lib
 * stays free of React; these hooks subscribe to them. A panel that lists bags
 * rerenders when any reading changes (the version), and a record of one bag
 * reads its own.
 */

import { useSyncExternalStore } from 'react'
import { bagReading, bagReadingsVersion, onBagReadings, type BagReading } from '../lib/hidden'

/** A number that rises whenever any bag's reading changes. */
export function useBagReadingsVersion(): number {
  return useSyncExternalStore(onBagReadings, bagReadingsVersion, bagReadingsVersion)
}

/** This bag's reading, or undefined when no key of this client has opened it. */
export function useBagReading(bagId: string): BagReading | undefined {
  useBagReadingsVersion()
  return bagReading(bagId)
}
