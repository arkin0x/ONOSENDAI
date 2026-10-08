/**
 * StarredPlaceCard.tsx - what a tap on a starred place's star in the scene
 * opens, the way a tap on a coin or a message opens that item: the place's
 * name, its plane, its coordinate and when it was starred, a field to rename
 * it, and two answers. VIEW looks at it, centered, at the zoom it was starred
 * at, the cursor coming along as with any VIEW. UNSTAR takes it off the list,
 * which takes its star out of the scene. A tap outside the card, or Escape,
 * just closes it.
 */

import { useEffect, useState } from 'react'
import { onEarthSurface } from '../lib/hyperspace/interest'
import { axesLabel, NICKNAME_MAX, placeName, placePosition, starredWhen, type StarredPlace } from '../lib/starred'
import { useCyberspace } from '../store/useCyberspace'
import { BRIEF_TOAST_MS, useToast } from '../store/useToast'
import { useStarred } from '../store/useStarred'
import { ConfirmModal } from './ConfirmModal'

/**
 * Look at a starred place: the POSITION panel's VIEW, the cursor coming
 * along, at the zoom it was starred at, with the pin when it is on Earth.
 */
export function viewStarred(place: StarredPlace): void {
  const position = placePosition(place.input)
  if (!position) return
  const cs = useCyberspace.getState()
  cs.focusOn(position, place.plane, placeName(place), place.scaleExp, true)
  if (place.plane === 0 && onEarthSurface(position)) cs.dropPin(position, placeName(place), place.scaleExp)
}

export function StarredPlaceCard(): JSX.Element | null {
  const selected = useStarred((s) => s.selected)
  const place = useStarred((s) => (s.selected ? s.places.find((p) => p.input === s.selected!.input && p.plane === s.selected!.plane) : undefined))
  const [text, setText] = useState('')
  useEffect(() => { setText(place?.nickname ?? '') }, [place?.input, place?.plane, place?.nickname])

  if (!selected || !place) return null
  const close = (): void => useStarred.getState().select(null)
  const name = placeName(place)
  return (
    <ConfirmModal
      cardClassName="starcard"
      title={`★ ${name}`}
      danger={false}
      confirmLabel="VIEW"
      cancelLabel="UNSTAR"
      onConfirm={() => { viewStarred(place); close() }}
      onCancel={() => {
        useStarred.getState().remove(place)
        useToast.getState().show({ label: 'Removed from your Starred Places', meta: name, mark: 'star', ms: BRIEF_TOAST_MS })
      }}
      onBackdrop={close}
      body={(
        <>
          <p className="starcard__meta">
            A starred place in {place.plane === 0 ? 'dataspace' : 'ideaspace'}, starred {starredWhen(place.at, Date.now())}.
          </p>
          <p className="starcard__coord" title={place.input}>{axesLabel(place.input)}</p>
          <form
            className="starcard__rename"
            onSubmit={(e) => { e.preventDefault(); useStarred.getState().rename(place, text) }}
          >
            <span className="legend__label">Nickname</span>
            <span className="starname__row">
              <input
                className="avatars__input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={NICKNAME_MAX}
                placeholder={place.label}
                aria-label="Nickname"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="done"
              />
              <button className="avatars__go" type="submit" disabled={text.trim() === (place.nickname ?? '')}>SAVE</button>
            </span>
          </form>
        </>
      )}
    />
  )
}
