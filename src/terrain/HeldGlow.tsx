/**
 * HeldGlow.tsx - the glow of a glowing block in hand, on screen (owner,
 * 2026-11-27: "i want that block's glow effect to surround my avatar"):
 * a soft light of the block's colour round the carried block in the bottom
 * right (TerrainView.tsx HeldBlock), and a faint tint of it at the screen's
 * edges, as if the light were round you. The blocks themselves are lit by
 * scene/heldLight.ts.
 *
 * Light added to what is behind (plus-lighter, screen where that is not
 * known), as strong as the block's light level, under every control and
 * never taking a tap. CSS only: nothing is drawn per frame. It breathes
 * slowly while motion is allowed; with reduced motion it holds still (no
 * flicker either way). With Block shading off the blocks are not lit by it,
 * so it is not drawn either.
 */

import type { CSSProperties } from 'react'
import { heldGlow, heldGlowLook } from '../lib/terrain/heldLight'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useLayers } from '../store/useLayers'

export interface HeldGlowLook { style: CSSProperties; pulse: boolean }

/** The glow for the block `id` in hand, or null when it does not glow or Block shading is off (then the blocks are not lit by it either). A hook: call it before any early return. */
export function useHeldGlow(id: number | null): HeldGlowLook | null {
  const calm = useReducedMotion()
  const shading = useLayers((l) => l.blockShading)
  const look = heldGlowLook(id && shading ? heldGlow(id) : null, calm)
  if (!look) return null
  return { style: { '--held-glow': look.rgb, '--held-glow-k': look.strength.toFixed(3) } as CSSProperties, pulse: look.pulse }
}

/** The tint at the screen's edges. */
export function HeldVignette({ look }: { look: HeldGlowLook }): JSX.Element {
  return <div className="terrain-held-vignette" style={look.style} aria-hidden />
}

/** The light round the carried block: a box of its own where the carried block's is, drawn before it so the block stands in front. */
export function HeldHalo({ look }: { look: HeldGlowLook }): JSX.Element {
  return (
    <div className="terrain-held-halo" style={look.style} aria-hidden>
      <span className={`terrain-held-halo__light${look.pulse ? ' is-pulsing' : ''}`} />
    </div>
  )
}
