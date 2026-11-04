/**
 * WalkLookSphere.tsx - the workshop's orbit ball, in WALK, to look around with.
 *
 * arkinox, 2026-10-23: "on the bottom left corner it may make sense to bring
 * back the sphere we have in the workshop and use it to look". It stands
 * above the menu button, on the button's left edge, in the dock the route
 * overlay uses outside WALK (the overlay is never up in WALK). A drag on it
 * turns your head the way a drag on the scene does (lib/walkLook.ts), but
 * further: a drag across the ball turns WALK_LOOK_SPHERE_DEG_PER_BALL on
 * every screen, so it is a real control and not only a sign that you can
 * look (arkinox, 2026-11-02). It
 * keeps turning past the ball until the finger lifts, and the whole square
 * around the ball takes the press (hud/ui/OrbitSphere.tsx). A drag on the
 * scene still looks too. A tap does nothing.
 *
 * Only in WALK, and only while the View panel's "Look sphere in WALK" is on
 * (the default; store/useLayers.ts).
 */

import { useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { walkLookSphereBy } from '../lib/walkLook'
import { OrbitSphere } from './ui/OrbitSphere'

export function WalkLookSphere(): JSX.Element | null {
  const walking = useCyberspace((s) => s.walking)
  const on = useLayers((s) => s.walkLookSphere)
  if (!walking || !on) return null
  return (
    <OrbitSphere
      className="walklook"
      square
      onTurn={walkLookSphereBy}
      label="LOOK"
      title="Drag to look around; keep dragging past the ball."
      ariaLabel="Look around. Drag to turn your view."
    />
  )
}
