/**
 * useStarred.ts - the Starred Places list (lib/starred.ts), one identity's
 * own, kept on this device under its pubkey (store/personalLists.ts): a new
 * or different identity starts with none, and each finds its own again when
 * it logs back in here (owner ruling, 2026-11-19: "my starred places ...
 * should be cleared out if i roll a new npub, but be restored if i login with
 * arkinox again"). The list builds before kept once per device goes to the
 * identity signed in when it is first read. Every change is written straight
 * back; a storage that cannot be written leaves the list working for this
 * visit.
 *
 * Two short-lived things ride along, neither of them stored:
 * - `naming`: the place just starred, while its nickname field is up
 *   (StarNickname.tsx). Closing the field, by SAVE or SKIP, is what says
 *   "Added to your Starred Places", so the toast never talks over the field.
 * - `selected`: the place whose star was tapped in the scene, while its
 *   card is open (StarredPlaceCard.tsx).
 */

import { create } from 'zustand'
import { addPlace, cleanNickname, cleanPlaces, isStarred, legacyPlaces, placeName, removePlace, unionPlaces, type StarredPlace, type StarSpot } from '../lib/starred'
import { personalList } from './personalLists'
import type { RecentView } from '../lib/viewAt'
import { BRIEF_TOAST_MS, useToast } from './useToast'

type PlaceRef = Pick<RecentView, 'input' | 'plane'>

interface StarredState {
  places: StarredPlace[]
  /** Star a spot: it goes to the top of the list, replacing an earlier copy of the same place. */
  add: (spot: StarSpot, scaleExp?: number) => void
  /** Take a place off the list, matched on its text and plane. */
  remove: (entry: PlaceRef) => void
  /** Star the spot, or take it off when it is already starred. Says which happened. */
  toggle: (spot: StarSpot, scaleExp?: number) => 'added' | 'removed'
  /** Give a place a nickname, cleaned (cleanNickname); an empty one takes the nickname away. */
  rename: (entry: PlaceRef, typed: string) => void
  /** The place whose nickname field is up, or null. */
  naming: PlaceRef | null
  /** Put the nickname field up for a place just starred. */
  beginNaming: (entry: PlaceRef) => void
  /**
   * Close the nickname field: with a nickname (SAVE) it is kept, with null
   * (SKIP, Escape, a tap elsewhere) the place keeps its own label. Either way
   * the place stays starred and the toast says so.
   */
  finishNaming: (typed: string | null) => void
  /** The place whose scene star was tapped, or null. */
  selected: PlaceRef | null
  select: (entry: PlaceRef | null) => void
}

const find = (list: StarredPlace[], e: PlaceRef): StarredPlace | undefined =>
  list.find((p) => p.input === e.input && p.plane === e.plane)

export const STARRED_LIST = 'starred-places'

export const useStarred = create<StarredState>((set, get) => {
  const commit = (places: StarredPlace[]): void => {
    set({ places })
    starredList.save(places)
  }
  return {
    places: [],
    add: (spot, scaleExp) => {
      const place: StarredPlace = { input: spot.input, label: spot.label, plane: spot.plane, at: Date.now() }
      if (scaleExp !== undefined) place.scaleExp = scaleExp
      commit(addPlace(get().places, place))
    },
    remove: (entry) => {
      commit(removePlace(get().places, entry))
      const { naming, selected } = get()
      if (naming && naming.input === entry.input && naming.plane === entry.plane) set({ naming: null })
      if (selected && selected.input === entry.input && selected.plane === entry.plane) set({ selected: null })
    },
    toggle: (spot, scaleExp) => {
      if (isStarred(get().places, spot)) { get().remove(spot); return 'removed' }
      get().add(spot, scaleExp)
      return 'added'
    },
    rename: (entry, typed) => {
      const nickname = cleanNickname(typed)
      commit(get().places.map((p) => {
        if (p.input !== entry.input || p.plane !== entry.plane) return p
        const { nickname: _old, ...rest } = p
        return nickname ? { ...rest, nickname } : rest
      }))
    },
    naming: null,
    beginNaming: (entry) => set({ naming: { input: entry.input, plane: entry.plane } }),
    finishNaming: (typed) => {
      const naming = get().naming
      if (!naming) return
      if (typed !== null && cleanNickname(typed) !== '') get().rename(naming, typed)
      set({ naming: null })
      const place = find(get().places, naming)
      if (!place) return
      useToast.getState().show({ label: 'Added to your Starred Places in the View panel', meta: placeName(place), mark: 'star', ms: BRIEF_TOAST_MS })
    },
    selected: null,
    select: (entry) => set({ selected: entry ? { input: entry.input, plane: entry.plane } : null }),
  }
})

/**
 * Whose list is shown follows the identity (store/personalStart.ts). A
 * nickname field or a card stays up only while its place is on the list
 * shown, so a switch closes the old identity's.
 */
export const starredList = personalList<StarredPlace[]>({
  name: STARRED_LIST,
  legacy: legacyPlaces,
  clean: cleanPlaces,
  empty: [],
  merge: unionPlaces,
  show: (places) => {
    const { naming, selected } = useStarred.getState()
    useStarred.setState({
      places,
      naming: naming && find(places, naming) ? naming : null,
      selected: selected && find(places, selected) ? selected : null,
    })
  },
})
