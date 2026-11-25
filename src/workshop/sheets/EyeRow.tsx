/**
 * EyeRow.tsx - FIRST-PERSON EYE, the AVATAR sheet's one row for the avatar's
 * eye (avatar eye, UI A "the eye on the bench"; arkinox, 2026-11-16): where
 * the camera sits in WALK when this shard is worn, AUTO or CHOSEN with the
 * place in gibsons, and SET EYE, which closes the sheet and puts the eye in
 * your hand on the bench (shell/EyeBar). A reserved line under it says how
 * the eye reaches others: USE THIS SHARD publishes it, with the avatar; and
 * when the avatar you wear is this shape with another eye, that it still
 * uses its old one until you do. On a shape with no points yet, that the eye
 * is on the default icosahedron, which TRY WALK walks with.
 */

import { ScanEye } from 'lucide-react'
import { toPayload, type ShardModel } from 'sno-core/shards'
import { drawnFace, withFace } from 'sno-core/face'
import { eyeChosen, eyeLabel, withEye } from '../../lib/avatarEye'
import { useAvatars } from '../../store/useAvatars'
import { useCyberspace } from '../../store/useCyberspace'
import { useWorkshop } from '../../store/useWorkshop'

/** The row's setting: AUTO or CHOSEN, and the eye's place in gibsons ("0, 1.33, 0"). */
export function eyeSetting(shard: Parameters<typeof eyeLabel>[0]): { mode: 'AUTO' | 'CHOSEN'; place: string } {
  return { mode: eyeChosen(shard) ? 'CHOSEN' : 'AUTO', place: eyeLabel(shard) }
}

/** The shape without its eye and facing, as a payload's text: two shards that differ only in `eye` or `face` read the same. */
const shapeKey = (s: ShardModel): string => { const { name: _n, ...rest } = toPayload(withFace(withEye(s, undefined), 'path')) as unknown as Record<string, unknown>; return JSON.stringify(rest) }

/**
 * The reserved line's words, for the eye and the FACING row above it. When
 * the avatar you wear is this shard's shape with another eye or facing, it
 * says what the worn one still uses; otherwise how both are published.
 */
export function eyeNote(shard: ShardModel, worn: ShardModel | null): string {
  if (worn && shapeKey(worn) === shapeKey(shard)) {
    const eye = eyeLabel(worn) + eyeChosen(worn) !== eyeLabel(shard) + eyeChosen(shard)
    const face = drawnFace(worn) !== drawnFace(shard)
    if (eye && face) return 'YOUR WORN AVATAR STILL USES ITS OLD EYE AND FACING. USE THIS SHARD TO UPDATE IT.'
    if (eye) return `YOUR WORN AVATAR STILL USES ${eyeChosen(worn) ? eyeLabel(worn) : 'AUTO'}. USE THIS SHARD TO UPDATE IT.`
    if (face) return `YOUR WORN AVATAR STILL USES ${drawnFace(worn).toUpperCase()} FACING. USE THIS SHARD TO UPDATE IT.`
  }
  // No shape yet: nothing to publish, but WHAT YOU SEE and TRY WALK look from this eye on the default icosahedron.
  if (shard.vertices.length === 0) return 'NO SHAPE YET: THIS IS THE EYE ON THE DEFAULT ICOSAHEDRON. TRY WALK TO WALK WITH IT.'
  return 'USE THIS SHARD PUBLISHES THE EYE AND FACING.'
}

export function EyeRow(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const me = useCyberspace((s) => s.identity.pubkey)
  const worn = useAvatars((s) => s.shards[me] ?? null)
  if (!shard) return null
  const { mode, place } = eyeSetting(shard)
  const note = eyeNote(shard, worn)
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
      <span className="ws__eyerow-note" title={note}>{note}</span>
    </div>
  )
}
