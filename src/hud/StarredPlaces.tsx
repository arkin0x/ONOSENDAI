/**
 * StarredPlaces.tsx - the places you starred, under RECENT in the POSITION
 * panel (lib/starred.ts). Each row is the place's plane, its name (its
 * nickname when it has one), and when it was starred; a tap goes there
 * exactly as a RECENT row does (the panel hands in how). On the right, the
 * pencil renames it in place and the × takes it off the list.
 *
 * A row is RECENT's row, the same classes at the same size (arkinox,
 * 2026-10-07: "the starred places buttons are too fat"), with one more mark
 * of the ×'s shape for the pencil. Renaming turns the row into a field of
 * the same height: Enter or the check keeps the name, Escape or the ×
 * leaves it as it was, and an empty name goes back to the place's own label.
 *
 * Open by default, unlike RECENT: the toast that announces a new star sends
 * you here to find it, and a folded list would hide it one tap deeper.
 */

import { useState } from 'react'
import { Check, Pencil } from 'lucide-react'
import { parseViewAt, type ViewTarget } from '../lib/viewAt'
import { NICKNAME_MAX, placeName, starredWhen, type StarredPlace } from '../lib/starred'
import { useStarred } from '../store/useStarred'
import { Explanation } from './Explanation'

export function StarredPlaces({ onGo }: { onGo: (place: StarredPlace, target: ViewTarget) => void }): JSX.Element {
  const places = useStarred((s) => s.places)
  const [open, setOpen] = useState(true)
  // The row being renamed, by its key, and what is typed in it.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const now = Date.now()
  const keyOf = (p: StarredPlace): string => `${p.plane}:${p.input}`

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
          {places.map((p) => {
            const name = placeName(p)
            if (editing === keyOf(p)) {
              const save = (): void => { useStarred.getState().rename(p, draft); setEditing(null) }
              return (
                <li key={keyOf(p)}>
                  <form className="starred__rename" onSubmit={(e) => { e.preventDefault(); save() }}>
                    {/* The row's own box, badge and all, with the name made
                        editable in place: the same size as the row it replaces. */}
                    <label className="viewat__item starred__editing">
                      <span className={`plane plane--${p.plane} viewat__plane`}>{p.plane === 0 ? 'D' : 'I'}</span>
                      <input
                        className="starred__input"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(null) } }}
                        maxLength={NICKNAME_MAX}
                        placeholder={p.label}
                        aria-label={`Nickname for ${name}`}
                        autoComplete="off"
                        spellCheck={false}
                        enterKeyHint="done"
                        autoFocus
                      />
                    </label>
                    <button className="viewat__forget starred__icon" type="submit" title="Keep this nickname" aria-label="Keep this nickname">
                      <Check size={12} strokeWidth={2.5} aria-hidden />
                    </button>
                    <button className="viewat__forget" type="button" title="Leave the name as it was" aria-label="Cancel renaming" onClick={() => setEditing(null)}>×</button>
                  </form>
                </li>
              )
            }
            return (
              <li key={keyOf(p)}>
                <button
                  className="viewat__item starred__item"
                  onClick={() => { const target = parseViewAt(p.input, p.plane); if (target) onGo(p, { ...target, label: name }) }}
                  title={`${p.input}\nStarred ${new Date(p.at).toLocaleString()}`}
                >
                  {/* Floated, so the time takes the right end of the first line
                      and the name flows around it, wrapping as RECENT's does. */}
                  <span className="starred__when">{starredWhen(p.at, now)}</span>
                  <span className={`plane plane--${p.plane} viewat__plane`}>{p.plane === 0 ? 'D' : 'I'}</span>{name}
                </button>
                <button
                  className="viewat__forget starred__icon"
                  title={`Rename ${name}`}
                  aria-label={`Rename ${name}`}
                  onClick={() => { setDraft(p.nickname ?? ''); setEditing(keyOf(p)) }}
                >
                  <Pencil size={11} strokeWidth={2.25} aria-hidden />
                </button>
                <button
                  className="viewat__forget"
                  title={`Remove ${name} from Starred Places`}
                  aria-label={`Remove ${name} from Starred Places`}
                  onClick={() => useStarred.getState().remove(p)}
                >×</button>
              </li>
            )
          })}
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
          Once the star has lit, a small field above it asks for a nickname. It is
          optional: SAVE (or Enter) keeps the name, and SKIP, Escape or a tap
          anywhere else leaves the place under its own name, which is the name of
          what you were looking at, or its shortened axes. Either way the place is
          starred. A nickname is at most {NICKNAME_MAX} characters.
        </p>
        <p>
          While you are looking at a spot you already starred, the star is shown
          filled in yellow, and pressing it removes that spot from the list. Back
          on your avatar, the CHAT chip returns. While you are spectating, the
          spectate bar holds the bottom of the screen, so there is no star there.
        </p>
        <p>
          Each row shows the plane (D for dataspace, I for ideaspace), the place's
          nickname or name, and how long ago you starred it. Tap a row to view
          that place again without moving, at the zoom you starred it at, the same
          way a RECENT place is viewed. The pencil renames it right in the row:
          Enter or the check keeps the new nickname, Escape or the × leaves it as
          it was, and an empty nickname goes back to the place's own name. The ×
          on the far right removes it.
        </p>
        <p>
          Every starred place in the plane you are looking at, and near enough to
          be drawn, also stands in the scene as a small glowing yellow star at
          its coordinate, with its nickname or name written under it (a place
          known only by its axes stays a bare star). Tap that star to see the
          place, rename it, view it, or unstar it.
        </p>
        <p>
          Starred Places are kept on this device only, are shared by every
          identity you sign in with here, and are never published.
        </p>
      </Explanation>
    </div>
  )
}
