/**
 * StarredPlaces.tsx - the places you starred, under RECENT in the POSITION
 * panel (lib/starred.ts). Each row is the place's plane, its name, and when
 * it was starred; a tap goes there exactly as a RECENT row does (the panel
 * hands in how), and the mark on the right takes it off the list.
 *
 * Open by default, unlike RECENT: the toast that announces a new star sends
 * you here to find it, and a folded list would hide it one tap deeper.
 */

import { useState } from 'react'
import { parseViewAt, type ViewTarget } from '../lib/viewAt'
import { starredWhen, type StarredPlace } from '../lib/starred'
import { useStarred } from '../store/useStarred'
import { Explanation } from './Explanation'

export function StarredPlaces({ onGo }: { onGo: (place: StarredPlace, target: ViewTarget) => void }): JSX.Element {
  const places = useStarred((s) => s.places)
  const [open, setOpen] = useState(true)
  const now = Date.now()

  return (
    <div className="viewat__recent starred">
      <button className="viewat__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        STARRED PLACES{places.length > 0 ? ` (${places.length})` : ''} <span className="viewat__caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && places.length === 0 && (
        <p className="starred__empty">
          None yet. Move the cursor or the view off your avatar and press the star at the bottom of the screen.
        </p>
      )}
      {open && places.length > 0 && (
        <ul className="viewat__list starred__list">
          {places.map((p) => (
            <li key={`${p.plane}:${p.input}`}>
              <button
                className="viewat__item starred__item"
                onClick={() => { const target = parseViewAt(p.input, p.plane); if (target) onGo(p, target) }}
                title={`${p.input}\nStarred ${new Date(p.at).toLocaleString()}`}
              >
                <span className={`plane plane--${p.plane} viewat__plane`}>{p.plane === 0 ? 'D' : 'I'}</span>
                <span className="starred__label">{p.label}</span>
                <span className="starred__when">{starredWhen(p.at, now)}</span>
              </button>
              <button
                className="viewat__forget starred__forget"
                title={`Remove ${p.label} from Starred Places`}
                aria-label={`Remove ${p.label} from Starred Places`}
                onClick={() => useStarred.getState().remove(p)}
              >×</button>
            </li>
          ))}
        </ul>
      )}
      <Explanation>
        <p>
          Starred Places are coordinates you marked so you can come back to them.
          Whenever the cursor or your view is somewhere other than your own
          avatar, an empty star takes the place of the CHAT chip at the bottom of
          the screen. Press it to star the spot at the center of the screen: the
          cursor, when you can drive it, or otherwise the place the view is
          focused on (an avatar you are viewing, a shard, a step in your history).
          The star turns yellow, and the spot is added here at the top of the list.
        </p>
        <p>
          While you are looking at a spot you already starred, the star is shown
          filled in yellow, and pressing it removes that spot from the list. Back
          on your avatar, the CHAT chip returns. While you are spectating, the
          spectate bar holds the bottom of the screen, so there is no star there.
        </p>
        <p>
          Each row shows the plane (D for dataspace, I for ideaspace), the place's
          name or its shortened axes, and how long ago you starred it. Tap a row
          to view that place again without moving, at the zoom you starred it at,
          the same way a RECENT place is viewed. The × on the right removes it.
          Starred Places are kept on this device only, are shared by every
          identity you sign in with here, and are never published.
        </p>
      </Explanation>
    </div>
  )
}
