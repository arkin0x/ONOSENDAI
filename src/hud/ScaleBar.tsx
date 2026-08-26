/**
 * ScaleBar.tsx - the scale controls, kept when the pad is not.
 *
 * The movement pad stands down off your own head: spectating, viewing a block
 * and viewing Earth all anchor the scene somewhere that is not you, and there
 * is nothing there to drive. Scale is not movement though. It decides how much
 * of the line the stop field draws, whether the globe or the curvature patch
 * owns the frame, and which shoreline tier loads, so a viewing mode with no
 * way to zoom is a viewing mode you cannot actually look around in.
 *
 * So the three cells that still mean something come back on their own: the two
 * scale steps and the readout that resets to 2^0. Same glyphs, same keyboard
 * hints, same reset, laid out as the pad's bottom row so the muscle memory
 * survives the swap.
 */
import { useCyberspace } from '../store/useCyberspace'
import { MAX_SCALE_EXP } from '../lib/space'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'

export function ScaleBar(): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const bind = useRepeatable()
  const scale = (delta: number) => () => useCyberspace.getState().adjustScale(delta)

  return (
    <div className="scalebar" role="group" aria-label="Change scale">
      {/* Plus on the left, as on the pad and as on the keyboard: Q raises the
          exponent and sits left of E, which lowers it. */}
      <button
        className="touchpad__key"
        title="Coarser scale (Q)"
        aria-label="Coarser scale (Q)"
        disabled={scaleExp >= MAX_SCALE_EXP}
        {...bind(scale(1))}
      >+</button>
      <button
        className="touchpad__hub"
        aria-label={`Scale 2^${scaleExp}. Tap to reset scale to 2^0.`}
        title="Reset scale to 2^0"
        {...noCallout}
        onPointerDown={(e) => {
          e.preventDefault(); e.stopPropagation()
          const s = useCyberspace.getState()
          s.adjustScale(-s.scaleExp)
        }}
      >2^{scaleExp}</button>
      <button
        className="touchpad__key"
        title="Finer scale (E)"
        aria-label="Finer scale (E)"
        disabled={scaleExp <= 0}
        {...bind(scale(-1))}
      >−</button>
    </div>
  )
}
