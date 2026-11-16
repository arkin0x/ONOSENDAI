/**
 * EyeBar.tsx - the strip in SET EYE (avatar eye, UI A "the eye on the bench";
 * arkinox, 2026-11-16). The eye is in your hand the way a held object is, so
 * the strip shows the eye's fixed slots, greyed rather than taken away, in an
 * order that never changes:
 *
 *   AUTO · CENTER · ORIGIN · NUMBERS · TRY WALK · DONE
 *
 * AUTO takes the field away (one eighth of the avatar's height below its top,
 * and it follows your edits); CENTER puts the eye in the middle of the shape's
 * box; ORIGIN at 0, 0, 0, the eye every avatar had before; NUMBERS opens X, Y
 * and Z steppers in gibsons, a grid step a press; TRY WALK walks with this eye
 * before you publish (store/tryEye.ts); DONE puts the eye down.
 *
 * A status line above the slots always holds the eye's place in gibsons from
 * 0, 0, 0, and AUTO or CHOSEN at its end: reserved, so nothing jumps.
 */

import { useEffect, useState } from 'react'
import { Check, CircleDot, Crosshair, Footprints, Hash, ScanEye, Sparkles } from 'lucide-react'
import { benchEye, centerEye, eyeChosen, eyeLabel, gibsonsLabel } from '../../lib/avatarEye'
import { useEscape } from '../../hooks/useEscape'
import { noCallout, useRepeatable } from '../../hooks/useRepeatable'
import { useWorkshop } from '../../store/useWorkshop'
import { startTryWalk } from '../../store/tryEye'

/** The status line's words: where the eye is, in gibsons from 0, 0, 0. */
export function eyeStatus(label: string): string {
  return `EYE ${label} GIBSONS FROM 0, 0, 0`
}

/** NUMBERS: X, Y and Z steppers, each press one grid step, printed in gibsons. */
function EyeNumbers(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const step = useWorkshop((s) => s.step())
  const bind = useRepeatable()
  if (!shard) return null
  const at = benchEye(shard)
  const w = useWorkshop.getState
  return (
    <div className="benchpaste ws__ask ws__eyenums" role="group" aria-label="The eye's place in gibsons">
      {(['X', 'Y', 'Z'] as const).map((name, axis) => (
        <div key={name} className="ws__eyenum" role="group" aria-label={name}>
          <button className="ws__stripbtn ws__stripbtn--sq" {...bind(() => { w().moveEye(axis as 0 | 1 | 2, -w().step()) })} aria-label={`${name} down a step`}>−</button>
          <span className="ws__stepper-value"><b>{gibsonsLabel(at[axis], shard)}</b><span>{name}</span></span>
          <button className="ws__stripbtn ws__stripbtn--sq" {...bind(() => { w().moveEye(axis as 0 | 1 | 2, w().step()) })} aria-label={`${name} up a step`}>+</button>
        </div>
      ))}
      <span className="ws__eyenums-step">A STEP IS {gibsonsLabel(step, shard)} {gibsonsLabel(step, shard) === '1' ? 'GIBSON' : 'GIBSONS'}</span>
    </div>
  )
}

export function EyeBar(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const [numbers, setNumbers] = useState(false)
  const has = (shard?.vertices.length ?? 0) > 0
  // NUMBERS stays open across moves; a new shard puts it away.
  useEffect(() => { setNumbers(false) }, [shard?.id])
  useEscape('modal', numbers, () => setNumbers(false))
  if (!shard) return null
  const w = useWorkshop.getState
  const chosen = eyeChosen(shard)
  const at = benchEye(shard)
  const atOrigin = chosen && at.every((t) => t === 0)
  return (
    <>
      <div className="ws__eyeline" role="status" aria-live="polite">
        <ScanEye size={14} strokeWidth={2.25} aria-hidden />
        <span className="ws__eyeline-text">{eyeStatus(eyeLabel(shard))}</span>
        <kbd className="ws__eyeline-keys" aria-hidden>WASD R F MOVE · E DONE</kbd>
        <b className={`ws__eyeline-mode${chosen ? ' is-chosen' : ''}`}>{chosen ? 'CHOSEN' : 'AUTO'}</b>
      </div>
      <div className="ws__heldbar ws__eyebar" role="toolbar" aria-label="The eye">
        <button className={`ws__heldbtn${!chosen ? ' is-on' : ''}`} aria-pressed={!chosen} onClick={() => w().setEye(undefined)} title="One eighth of the avatar's height below its top. It follows your edits" {...noCallout}>
          <Sparkles size={18} strokeWidth={2} aria-hidden /><span>AUTO</span>
        </button>
        <button className="ws__heldbtn" disabled={!has} onClick={() => w().setEye(centerEye(shard))} title="The middle of the shape's box" {...noCallout}>
          <Crosshair size={18} strokeWidth={2} aria-hidden /><span>CENTER</span>
        </button>
        <button className={`ws__heldbtn${atOrigin ? ' is-on' : ''}`} aria-pressed={atOrigin} onClick={() => w().setEye([0, 0, 0])} title="0, 0, 0: today's eye, chosen on purpose" {...noCallout}>
          <CircleDot size={18} strokeWidth={2} aria-hidden /><span>ORIGIN</span>
        </button>
        <button className={`ws__heldbtn ws__heldbtn--two${numbers ? ' is-on' : ''}`} aria-expanded={numbers} aria-haspopup="true" onClick={() => setNumbers((n) => !n)} title="X, Y and Z in gibsons, a grid step a press" {...noCallout}>
          <Hash size={18} strokeWidth={2} aria-hidden /><span>NUMBERS</span>
        </button>
        <button className="ws__heldbtn ws__eyebar-gap" disabled={!has} onClick={() => { startTryWalk() }} title="Walk with this eye before you publish. Leave WALK to come back here" {...noCallout}>
          <Footprints size={18} strokeWidth={2} aria-hidden /><span>TRY WALK</span>
        </button>
        <button className="ws__heldbtn ws__heldbtn--ok" onClick={() => w().setEyeEdit(false)} title="Put the eye down (E)" aria-label="Done with the eye" {...noCallout}>
          <Check size={18} strokeWidth={2} aria-hidden /><span>DONE</span><kbd className="ws__key" aria-hidden>E</kbd>
        </button>
      </div>
      {numbers && <EyeNumbers />}
    </>
  )
}
