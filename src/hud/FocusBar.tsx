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

import { useCyberspace } from '../store/useCyberspace'
import { useHyperspace } from '../store/useHyperspace'
import { useShards } from '../store/useShards'

export function FocusBar(): JSX.Element | null {
  const focusLabel = useCyberspace((s) => s.focus?.label ?? null)
  const spectating = useCyberspace((s) => s.spectate !== null)
  const viewOwned = useHyperspace((s) => s.viewOwned)
  const inspecting = useShards((s) => s.inspecting !== null)
  if (focusLabel === null || spectating || viewOwned || inspecting) return null
  return (
    <div className="hyperbar hyperbar--focus" role="status">
      <span className="hyperbar__glyph" aria-hidden="true">◈</span>
      <span className="hyperbar__text">
        <span className="hyperbar__label">VIEWING</span>
        <span className="hyperbar__meta">{focusLabel}</span>
      </span>
      <button className="hyperbar__end" onClick={() => useCyberspace.getState().clearFocus()}>RETURN</button>
    </div>
  )
}
