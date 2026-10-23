/**
 * WalkLookSphere.tsx - the workshop's orbit ball, in WALK, to look around with.
 *
 * arkinox, 2026-10-23: "on the bottom left corner it may make sense to bring
 * back the sphere we have in the workshop and use it to look". It stands
 * above the menu button, on the button's left edge, in the dock the route
 * overlay uses outside WALK (the overlay is never up in WALK). A drag on it
 * turns your head exactly as a drag on the scene does: the same sink and the
 * same gain per screen width (lib/walkLook.ts), so it feels like grabbing
 * the view, and it keeps turning past the ball until the finger lifts. A
 * drag on the scene still looks too. A tap does nothing.
 *
 * Only in WALK, and only while the View panel's "Look sphere in WALK" is on
 * (the default; store/useLayers.ts).
 */

import { useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { walkLookBy } from '../lib/walkLook'
import { OrbitSphere } from './ui/OrbitSphere'

export function WalkLookSphere(): JSX.Element | null {
  const walking = useCyberspace((s) => s.walking)
  const on = useLayers((s) => s.walkLookSphere)
  if (!walking || !on) return null
  return (
    <OrbitSphere
      className="benchorb--walk"
      onTurn={walkLookBy}
      label="LOOK"
      title="Drag to look around; keep dragging past the ball."
      ariaLabel="Look around. Drag to turn your view."
    />
  )
}
