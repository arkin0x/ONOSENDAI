/**
 * FocusBar.tsx - the way home from a plain focus view.
 *
 * GO TO IT on a hidden thing, VIEW on a loot item, or tapping one of your
 * deployments flies the scene to a point that is not your avatar: the store's
 * `focus` is set and the controls stand down. Spectating has SpectateBar and
 * hyperspace views have HyperspaceBar, but a focus reached any other way had
 * no exit at all: on a keyboard Escape worked, on a phone nothing did. This bar is that
 * exit. It shows whenever a focus is standing and no other bar owns it, and
 * RETURN puts the anchor back on your avatar at the zoom you left.
 */

import { useCyberspace, type CyberFocus } from '../store/useCyberspace'
import type { Position } from '../lib/space'
import { useHyperspace } from '../store/useHyperspace'
import { useEscape } from '../hooks/useEscape'
import { useBuilder } from '../store/useBuilder'

/** What VIEWING says for a free view (VIEW, or what BUILD mode leaves behind). */
export const FREE_VIEW_LABEL = 'A COORD'

/**
 * What VIEWING says. A fixed look says what it looks at. A free view says
 * only that it is on a coordinate, not which: the pad moves it, and the axes
 * made the chip too long (arkinox, 2026-11-02). Unless the view has a name,
 * a starred place or a person (arkinox, 2026-11-03, ruled): then the name,
 * for as long as the cursor is on the very place the name was given for, in
 * its plane (CyberFocus.named). Driven off it, re-anchored past it or turned
 * to the other plane, it is A COORD again.
 */
export function viewingLabel(focus: CyberFocus | null, cursor: Position, plane: number): string | null {
  if (focus === null) return null
  if (!focus.drive) return focus.label
  const at = focus.named
  const onIt = at !== undefined && at.position.x === cursor.x && at.position.y === cursor.y && at.position.z === cursor.z && at.plane === plane
  return onIt && focus.label.trim() !== '' ? focus.label : FREE_VIEW_LABEL
}

export function FocusBar(): JSX.Element | null {
  const focus = useCyberspace((s) => s.focus)
  const focusLabel = useCyberspace((s) => viewingLabel(s.focus, s.cursor, s.anchorPlane))
  const spectating = useCyberspace((s) => s.spectate !== null)
  const viewOwned = useHyperspace((s) => s.viewOwned)
  // BUILD mode rides the free view and has its own bar (BuildBar), with its
  // own EXIT and RETURN TO AVATAR; this one comes back when the mode ends.
  const building = useBuilder((s) => s.active)
  const shown = !(focusLabel === null || spectating || viewOwned || building)
  // Escape is RETURN while this bar stands, a chip on the Escape stack
  // (arkinox, 2026-10-01); it used to be a fallback in the keyboard hook.
  useEscape('chip', shown, () => useCyberspace.getState().clearFocus())
  if (!shown) return null
  return (
    <div className="hyperbar hyperbar--focus" role="status">
      <span className="hyperbar__glyph" aria-hidden="true">◈</span>
      <span className="hyperbar__text">
        <span className="hyperbar__label">VIEWING</span>
        <span className="hyperbar__meta">{focusLabel}</span>
      </span>
      {/* A free view (VIEW, or what BUILD mode leaves behind when you exit)
          says where RETURN goes, since the pad drives it like your head. */}
      <button className="hyperbar__end" onClick={() => useCyberspace.getState().clearFocus()} title="Back to your avatar (Esc)">{focus?.drive ? 'RETURN TO AVATAR' : 'RETURN'}</button>
    </div>
  )
}
