/**
 * useStarred.ts - the Starred Places list (lib/starred.ts), kept on this
 * device under onosendai:starred-places and shared by every identity
 * signed in here. Read once when the module loads; every change is written
 * straight back. A storage that cannot be read or written leaves the list
 * working for this visit.
 */

import { create } from 'zustand'
import { addPlace, isStarred, loadPlaces, removePlace, savePlaces, type StarredPlace, type StarSpot } from '../lib/starred'
import type { RecentView } from '../lib/viewAt'

interface StarredState {
  places: StarredPlace[]
  /** Star a spot: it goes to the top of the list, replacing an earlier copy of the same place. */
  add: (spot: StarSpot, scaleExp?: number) => void
  /** Take a place off the list, matched on its text and plane. */
  remove: (entry: Pick<RecentView, 'input' | 'plane'>) => void
  /** Star the spot, or take it off when it is already starred. Says which happened. */
  toggle: (spot: StarSpot, scaleExp?: number) => 'added' | 'removed'
}

export const useStarred = create<StarredState>((set, get) => {
  const commit = (places: StarredPlace[]): void => {
    set({ places })
    savePlaces(places)
  }
  return {
    places: loadPlaces(),
    add: (spot, scaleExp) => {
      const place: StarredPlace = { input: spot.input, label: spot.label, plane: spot.plane, at: Date.now() }
      if (scaleExp !== undefined) place.scaleExp = scaleExp
      commit(addPlace(get().places, place))
    },
    remove: (entry) => commit(removePlace(get().places, entry)),
    toggle: (spot, scaleExp) => {
      if (isStarred(get().places, spot)) { get().remove(spot); return 'removed' }
      get().add(spot, scaleExp)
      return 'added'
    },
  }
})
