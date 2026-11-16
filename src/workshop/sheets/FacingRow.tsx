/**
 * FacingRow.tsx - FACING, the AVATAR sheet's row for how the avatar turns as
 * it moves (DECK-0003 §1.18; arkinox, 2026-11-16), above FIRST-PERSON EYE and
 * in its style: PATH, the default, points along each move and tilts with it;
 * UPRIGHT turns only left and right and stays upright to whoever sees it,
 * however they have turned the world with the 3D compass. While the sheet is
 * open the bench shows the choice on a move up and to the right (Bench
 * FacingPreview). The eye row's reserved line under it says how both reach
 * others: USE THIS SHARD publishes them.
 */

import { drawnFace, FACE_MODES, type FaceMode } from 'sno-core/face'
import { useWorkshop } from '../../store/useWorkshop'

/** What each choice does, for its button's tooltip. */
export const FACE_TIPS: Record<FaceMode, string> = {
  path: 'Point along each move, tilting up and down with it',
  upright: 'Turn only left and right, and stay upright to whoever sees you',
}

/** The gray line under FACING: what the lit choice does, one short line, since a tooltip never shows on a phone. */
export const FACE_HINTS: Record<FaceMode, string> = {
  path: 'You tilt with each move.',
  upright: 'You stay upright.',
}

export function FacingRow(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  if (!shard) return null
  const face = drawnFace(shard)
  return (
    <div className="ws__eyerow ws__facerow" role="group" aria-label="Facing">
      <div className="ws__eyerow-main">
        <span className="ws__eyerow-text">
          <span className="ui-field__label">FACING</span>
          <span className="ui-field__hint">{FACE_HINTS[face]}</span>
        </span>
        <div className="workshop__modes ws__facerow-modes" role="group" aria-label="Facing">
          {FACE_MODES.map((m) => (
            <button
              key={m}
              className={`workshop__mode ${face === m ? 'is-on' : ''}`}
              aria-pressed={face === m}
              title={FACE_TIPS[m]}
              onClick={() => useWorkshop.getState().setFace(m)}
            >{m.toUpperCase()}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
