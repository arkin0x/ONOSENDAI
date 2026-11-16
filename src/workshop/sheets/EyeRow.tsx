/**
 * EyeRow.tsx - FIRST-PERSON EYE, the AVATAR sheet's one row for the avatar's
 * eye (avatar eye, UI A "the eye on the bench"; arkinox, 2026-11-16): where
 * the camera sits in WALK when this shard is worn, AUTO or CHOSEN with the
 * place in gibsons, and SET EYE, which closes the sheet and puts the eye in
 * your hand on the bench (shell/EyeBar). A reserved line under it says how
 * the eye reaches others: USE THIS SHARD publishes it, with the avatar.
 */

import { ScanEye } from 'lucide-react'
import { eyeChosen, eyeLabel } from '../../lib/avatarEye'
import { useWorkshop } from '../../store/useWorkshop'

/** The row's setting: AUTO or CHOSEN, and the eye's place in gibsons ("0, 1.33, 0"). */
export function eyeSetting(shard: Parameters<typeof eyeLabel>[0]): { mode: 'AUTO' | 'CHOSEN'; place: string } {
  return { mode: eyeChosen(shard) ? 'CHOSEN' : 'AUTO', place: eyeLabel(shard) }
}

export function EyeRow(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  if (!shard) return null
  const { mode, place } = eyeSetting(shard)
  return (
    <div className="ws__eyerow" role="group" aria-label="First-person eye">
      <div className="ws__eyerow-main">
        <span className="ws__eyerow-text">
          <span className="ui-field__label">FIRST-PERSON EYE</span>
          <span className="ui-field__hint">Where your camera sits in WALK.</span>
        </span>
        <span className="ws__eyerow-setting" aria-label={`${mode}, ${place} gibsons`}>
          <b className={mode === 'CHOSEN' ? 'is-chosen' : undefined}>{mode}</b>
          <span>{place}</span>
        </span>
        <button
          className="workshop__btn ws__eyerow-set"
          onClick={() => useWorkshop.getState().setEyeEdit(true)}
          title="Put the eye in your hand on the bench and move it with the handles (E)"
        >
          <ScanEye size={16} strokeWidth={2.25} aria-hidden /><span>SET EYE</span><kbd className="ws__key" aria-hidden>E</kbd>
        </button>
      </div>
      <span className="ws__eyerow-note">USE THIS SHARD PUBLISHES THE EYE.</span>
    </div>
  )
}
