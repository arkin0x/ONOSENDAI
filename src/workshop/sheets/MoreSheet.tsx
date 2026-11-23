/**
 * MoreSheet.tsx - MORE (workshop redesign, phase 2): everything rarer than
 * the strip's own slots, in one sheet, one tap from the strip on every tool.
 *
 * While something is held: JOINED, CUT, FILL, SUBDIVIDE, the connected
 * PIECE's color, the dropper, FLIP for faces; the point's exact place, to
 * read or type; and the move pad, the nudge keys that the move handles on the
 * object replaced. Always: PASTE and its choices, ALL, COLOR ALL, WELD when
 * points are stacked, and in SELECT the BOX and REMOVE switches. LOOK shows
 * the shard as the world does (workshop/benchLook.tsx): what is held is out
 * of sight there, so nothing here acts on it or takes more (no HELD, no ALL,
 * no WELD of the held points).
 */

import { useEffect, useState } from 'react'
import { ClipboardPaste, Copy, Eraser, FlipVertical2, Globe, Grid2x2Plus, Group, Link, Merge, Pipette, Puzzle, Scissors, SquareDashedMousePointer, Triangle, WandSparkles, Waypoints } from 'lucide-react'
import { TICKS_PER_UNIT, ticksOf, unitsLabel, validPoint } from 'sno-core/shards'
import { noCallout, useRepeatable } from '../../hooks/useRepeatable'
import { dragHistory } from '../../lib/opacityStep'
import { stackedSpots } from '../../lib/weld'
import { useCyberspace } from '../../store/useCyberspace'
import { ownAddress, useWorkshop } from '../../store/useWorkshop'
import { isLook } from '../lookTool'
import { nudgeFor, nudgeLabel, useBenchView, type NudgeName } from '../benchAxes'
import { useHeldPoints } from '../shell/HeldBar'

/**
 * A place typed in units, as the readout writes them: `3`, `-2`, `1/2`,
 * `1 1/2`, `-3/4`, or a decimal. In ticks, rounded to the nearest; null for
 * anything else.
 */
export function parseUnits(text: string): number | null {
  const s = text.trim()
  const frac = /^(-)?(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(s)
  if (frac) {
    const den = Number(frac[4])
    if (den === 0) return null
    const units = Number(frac[2] ?? 0) + Number(frac[3]) / den
    return Math.round((frac[1] ? -units : units) * TICKS_PER_UNIT)
  }
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return Math.round(Number(s) * TICKS_PER_UNIT)
  return null
}

/** The six nudge keys, in screen directions, as the pad had them. */
const NUDGES: Array<{ cell: string; glyph: string; name: NudgeName; key: string }> = [
  { cell: 'away', glyph: '⊗', name: 'away', key: 'R' },
  { cell: 'up', glyph: '▲', name: 'up', key: 'W' },
  { cell: 'toward', glyph: '⊙', name: 'toward', key: 'F' },
  { cell: 'left', glyph: '◀', name: 'left', key: 'A' },
  { cell: 'down', glyph: '▼', name: 'down', key: 'S' },
  { cell: 'right', glyph: '▶', name: 'right', key: 'D' },
]

/** The move pad: what is held, a grid step at a time in screen directions (held to repeat). */
function MovePad(): JSX.Element {
  const axes = useBenchView((s) => s.axes)
  const bind = useRepeatable()
  const w = useWorkshop.getState
  const move = (name: NudgeName) => () => { const n = nudgeFor(useBenchView.getState().axes, name); w().moveSelected(n.axis, n.delta * w().step()) }
  return (
    <div className="ws__morepad" role="group" aria-label="Move the selected points">
      {NUDGES.map((a) => {
        const sub = nudgeLabel(nudgeFor(axes, a.name))
        return (
          <button key={a.cell} className="ws__morebtn" title={`${a.name} (${a.key}): ${sub}`} aria-label={`Move ${a.name}, ${sub}`} {...bind(move(a.name))}>
            <b>{a.glyph}</b><span>{sub}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The one held point's place, to read and to type. SET moves it there in
 * one step: one UNDO puts it back, however many axes changed.
 */
function ExactPlace({ index }: { index: number }): JSX.Element | null {
  const at = useWorkshop((s) => { const v = s.current()?.vertices[index]; return v ? ticksOf(v) : null })
  const [typed, setTyped] = useState<[string, string, string] | null>(null)
  useEffect(() => { setTyped(null) }, [index])
  if (!at) return null
  const shown = typed ?? (at.map(unitsLabel) as [string, string, string])
  const parsed = shown.map(parseUnits)
  const ok = parsed.every((p) => p !== null)
  const set = (): void => {
    if (!ok) return
    const w = useWorkshop.getState
    const st = w()
    const before = st.current()
    if (!before) return
    const delta = parsed.map((p, axis) => (p as number) - at[axis])
    // Every held point and object must land on the grid, or nothing moves:
    // one axis moved and the next refused would tear the move in half.
    const fits = st.selection.every((i) => { const v = before.vertices[i]; if (!v) return true; const t = ticksOf(v); return validPoint([t[0] + delta[0], t[1] + delta[1], t[2] + delta[2]], before.extent) })
      && st.partSel.every((i) => { const q = before.parts?.[i]; return !q || validPoint([q.at[0] + delta[0], q.at[1] + delta[1], q.at[2] + delta[2]], before.extent) })
    if (!fits) { useWorkshop.setState({ notice: 'That place is off the grid. GRID SIZE makes it bigger.' }); return }
    const past = st.past
    const shardId = st.currentId
    delta.forEach((d, axis) => { if (d !== 0) w().moveSelected(axis as 0 | 1 | 2, d) })
    // One UNDO for the whole move, a full history too (its cap keeps its length).
    const now = w()
    if (now.currentId === shardId && now.current() !== before) useWorkshop.setState({ past: dragHistory(past, before, now.past) })
    setTyped(null)
  }
  return (
    <form className="ws__exact" onSubmit={(e) => { e.preventDefault(); set() }} aria-label="The point's place">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <label key={axis} className="ws__exact-field">
          <span>{axis}</span>
          <input
            className="ws__exact-input"
            inputMode="decimal"
            value={shown[i]}
            aria-label={`${axis}, in units`}
            aria-invalid={parsed[i] === null}
            onChange={(e) => { const next = [...shown] as [string, string, string]; next[i] = e.target.value; setTyped(next) }}
            onKeyDown={(e) => { if (e.key === 'Escape' && typed) { e.preventDefault(); setTyped(null) } }}
          />
        </label>
      ))}
      <button className="ws__morebtn ws__morebtn--wide" type="submit" disabled={!ok || typed === null}>SET</button>
    </form>
  )
}

/** One labelled key in MORE. */
function Key({ icon: Icon, label, title, onClick, disabled, aria, danger }: { icon: typeof Link; label: string; title: string; onClick: () => void; disabled?: boolean; aria?: string; danger?: boolean }): JSX.Element {
  return (
    <button className={`ws__morebtn${danger ? ' ws__morebtn--danger' : ''}`} disabled={disabled} onClick={onClick} title={title} aria-label={aria} {...noCallout}>
      <Icon size={18} strokeWidth={2} aria-hidden /><span>{label}</span>
    </button>
  )
}

/**
 * `onNewGroup`: NEW GROUP made a group (its id), or did not (null): the
 * workshop swaps MORE for GROUPS with the new row on top (sheets/GroupsSheet).
 */
export function MoreBody({ onClose, onNewGroup }: { onClose?: () => void; onNewGroup?: (id: string | null) => void } = {}): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const tool = useWorkshop((s) => s.tool)
  const selection = useWorkshop((s) => s.selection)
  const partSel = useWorkshop((s) => s.partSel)
  const faceHeld = useWorkshop((s) => s.selectedFaces.length > 0)
  const clip = useWorkshop((s) => s.clip)
  const invert = useWorkshop((s) => s.invert)
  const box = useWorkshop((s) => s.boxSelect)
  const points = useHeldPoints()
  const w = useWorkshop.getState
  if (!shard) return null
  const look = isLook(tool)
  const held = !look && (selection.length > 0 || partSel.length > 0 || faceHeld)
  const stacked = stackedSpots(shard)
  // One point, however many vertices share it (two stamps touching at a corner).
  const one = points === 1 && partSel.length === 0 ? selection[0] : null
  const self = (): string | undefined => ownAddress(useCyberspace.getState().identity.pubkey, w().currentId)
  const clipWords = clip ? [clip.points.length ? `${clip.points.length} point${clip.points.length === 1 ? '' : 's'}` : '', clip.parts.length ? `${clip.parts.length} object${clip.parts.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') : ''
  return (
    <>
      {held && (
        <section className="ws__more-sec" aria-label="What you hold">
          <h3 className="ws__more-title">HELD</h3>
          <div className="ws__more-keys">
            <Key icon={Link} label="JOINED" title="Everything joined by faces to what you hold (C)" aria="Select connected" disabled={selection.length === 0} onClick={() => w().selectConnected()} />
            <Key icon={Scissors} label="CUT" title="Cut what you hold, and its faces, to the clipboard" aria="Cut the selection" disabled={selection.length === 0 && partSel.length === 0} onClick={() => w().cutSelection()} />
            <Key icon={Copy} label="DUPLICATE" title="A copy put down at once, held, ready to move" aria="Duplicate the selection" disabled={selection.length === 0 && partSel.length === 0} onClick={() => w().duplicateSelection()} />
            <Key icon={Group} label="NEW GROUP" title="A new group from what you hold (Ctrl+G)" aria="Make a group from the selection" onClick={() => { const id = w().createGroup(); onNewGroup?.(id) }} />
            <Key icon={Triangle} label="FILL" title="Faces across these points: a flat set becomes one face, a solid set its hull (Enter)" aria="Fill the selection" disabled={points < 3} onClick={() => w().fillSelection()} />
            <Key icon={Grid2x2Plus} label="SUBDIVIDE" title="Cut each fully selected face into four, or a selected edge in two" aria="Subdivide the selection" disabled={points < 2} onClick={() => w().subdivideSelection()} />
            <Key icon={Puzzle} label="PIECE" title="The color in hand onto these points and everything joined to them by faces" aria="Color the connected piece" disabled={selection.length === 0} onClick={() => w().colorConnected(w().color)} />
            <Key icon={Pipette} label="TAKE COLOR" title="Take the color of the point or face you hold" aria="Take the selected color" disabled={!(points === 1 || faceHeld)} onClick={() => w().sampleColor()} />
            {faceHeld && <Key icon={FlipVertical2} label="FLIP FACE" title="The selected faces turned round, each back to its front" onClick={() => w().flipSelectedFace()} />}
            {faceHeld && <Key icon={FlipVertical2} label="FLIP SURFACE" title="The selected faces turned round, and every face joined to them by an edge turned to agree" onClick={() => w().flipSelectedSurface()} />}
            {faceHeld && <Key icon={WandSparkles} label="AUTO" title="Every face in the object turned to look outward, by the bench's best guess" aria="Turn every face outward" onClick={() => w().autoWind()} />}
          </div>
          {one !== null && (
            <>
              <h3 className="ws__more-title">PLACE</h3>
              <ExactPlace index={one} />
            </>
          )}
          {(selection.length > 0 || partSel.length > 0) && (
            <>
              <h3 className="ws__more-title">MOVE</h3>
              <MovePad />
            </>
          )}
        </section>
      )}
      <section className="ws__more-sec" aria-label="The whole shard">
        <h3 className="ws__more-title">SHARD</h3>
        <div className="ws__more-keys">
          {clip && (
            <>
              <Key icon={ClipboardPaste} label="PASTE" title="Back on the exact points they were taken from (Ctrl+V)" aria={`Paste the ${clipWords} held`} onClick={() => w().pasteClip('exact', self())} />
              <Key icon={ClipboardPaste} label="PASTE FLOOR" title="Resting on the plane you are working on, keeping its shape" onClick={() => w().pasteClip('floor', self())} />
              <Key icon={ClipboardPaste} label="CLEAR CLIPBOARD" title={`Let the ${clipWords} go; PASTE goes with them`} danger onClick={() => w().clearClip()} />
            </>
          )}
          {!look && <Key icon={Waypoints} label="ALL" title={tool === 'select' ? `Every one of the ${w().selectKind}` : 'Every point and every placed object'} aria="Select everything" disabled={shard.vertices.length === 0 && (shard.parts?.length ?? 0) === 0} onClick={() => w().selectAll()} />}
          {tool === 'paint' && <Key icon={Pipette} label="TAKE COLOR" title="The next tap takes the color of the point or face it meets" aria="Take a color with the next tap" onClick={() => { w().setPaintTake(true); onClose?.() }} />}
          <Key icon={Globe} label="COLOR ALL" title="The color in hand onto every vertex and every face in the object" aria="Color everything" disabled={shard.vertices.length === 0} onClick={() => w().colorAll(w().color)} />
          {stacked.spots > 0 && !(look && selection.length >= 2) && (
            <Key icon={Merge} label={`WELD ${stacked.spots}`} title={selection.length >= 2 ? `Fold the selected points that stand on one spot into one (${stacked.points} points share ${stacked.spots} spot${stacked.spots === 1 ? '' : 's'})` : `Fold every point standing on another into one (${stacked.points} points share ${stacked.spots} spot${stacked.spots === 1 ? '' : 's'}); faces that disagree on color keep their own`} aria={selection.length >= 2 ? 'Weld the selected stacked points' : 'Weld every stacked point'} onClick={() => w().weld()} />
          )}
        </div>
      </section>
      {tool === 'select' && (
        <section className="ws__more-sec" aria-label="Taps">
          <h3 className="ws__more-title">SELECT</h3>
          <div className="ws__more-keys">
            {(
              <button className={`ws__morebtn${box ? ' is-on' : ''}`} aria-pressed={box} onClick={() => w().setBoxSelect(!box)} aria-label="Box: a drag draws a box" title="On: a one-finger drag draws a box. Off: it turns the view" {...noCallout}>
                <SquareDashedMousePointer size={18} strokeWidth={2} aria-hidden /><span>BOX</span>
              </button>
            )}
            <button className={`ws__morebtn${invert ? ' is-on' : ''}`} aria-pressed={invert} onClick={() => w().setInvert(!invert)} aria-label="Remove: taps and boxes take points out" title="Taps and boxes take points out instead of adding" {...noCallout}>
              <Eraser size={18} strokeWidth={2} aria-hidden /><span>REMOVE</span>
            </button>
          </div>
        </section>
      )}
    </>
  )
}
