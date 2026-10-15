/**
 * FocusBar.tsx - the way home from a plain focus view.
 *
 * GO TO IT on a hidden thing, VIEW on a loot item, or tapping one of your
 * deployments flies the scene to a point that is not your avatar: the store's
 * `focus` is set and the controls stand down. Spectating has SpectateBar,
 * hyperspace views have HyperspaceBar, and your own deployments have the
 * deployment detail's EXIT, but a focus reached any other way had no exit at
 * all: on a keyboard Escape worked, on a phone nothing did. This bar is that
 * exit. It shows whenever a focus is standing and no other bar owns it, and
 * RETURN puts the anchor back on your avatar at the zoom you left.
 */

import { shortAxis } from '../lib/viewAt'
import { useCyberspace } from '../store/useCyberspace'
import { useHyperspace } from '../store/useHyperspace'
import { useShards } from '../store/useShards'
import { useEscape } from '../hooks/useEscape'
import { useBuilder } from '../store/useBuilder'

export function FocusBar(): JSX.Element | null {
  const focus = useCyberspace((s) => s.focus)
  // The cursor, not the anchor: the anchor catches up after the presses settle.
  const anchor = useCyberspace((s) => (s.focus?.drive ? s.cursor : s.anchor))
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  // A free view reads where it is now, and in which plane, since the pad moves it.
  const focusLabel = focus === null ? null : focus.drive
    ? `${[anchor.x, anchor.y, anchor.z].map(shortAxis).join(', ')} · ${anchorPlane === 0 ? 'DATASPACE' : 'IDEASPACE'}`
    : focus.label
  const spectating = useCyberspace((s) => s.spectate !== null)
  const viewOwned = useHyperspace((s) => s.viewOwned)
  const inspecting = useShards((s) => s.inspecting !== null)
  // BUILD mode rides the free view and has its own bar (BuildBar), with its
  // own EXIT and RETURN TO AVATAR; this one comes back when the mode ends.
  const building = useBuilder((s) => s.active)
  const shown = !(focusLabel === null || spectating || viewOwned || inspecting || building)
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
