/**
 * HeldBar.tsx - the held bar (workshop redesign, phase 2): the strip, while
 * anything is held, in any tool. Fixed slots in a fixed order, greyed out
 * rather than taken away, so a thumb learns where each one is:
 *
 *   count · LEFT · RIGHT · COPY · PASTE · COLOR · DELETE · MORE
 *
 * The count says what is held and lets it go when tapped; DELETE is always
 * second from the right. PASTE asks where, as it always has (back on the
 * points it came from, on the working plane, or let the clipboard go), and
 * COLOR asks how for faces (BLEND their corners into each other, or a hard
 * EDGE: FILL and SEAM before, renamed so FILL only ever makes a face). Everything
 * rarer is behind MORE. An orange edge and the count are the two signs that
 * something is held.
 */

import { useEffect, useState } from 'react'
import { ClipboardPaste, Copy, Ellipsis, PaintBucket, RotateCcw, RotateCw, Trash2, X } from 'lucide-react'
import { ticksOf } from 'sno-core/shards'
import { useEscape } from '../../hooks/useEscape'
import { noCallout } from '../../hooks/useRepeatable'
import { useCyberspace } from '../../store/useCyberspace'
import { ownAddress, useWorkshop } from '../../store/useWorkshop'

/** What the count slot says: how many, and of what. */
export function heldCount(points: number, objects: number, faces: number): { n: number; word: string; label: string } {
  if (faces > 0 && points === 0 && objects === 0) return { n: faces, word: faces === 1 ? 'FACE' : 'FACES', label: `${faces} face${faces === 1 ? '' : 's'} held` }
  const parts = [points ? `${points} point${points === 1 ? '' : 's'}` : '', objects ? `${objects} object${objects === 1 ? '' : 's'}` : '', faces ? `${faces} face${faces === 1 ? '' : 's'}` : ''].filter(Boolean)
  const word = objects && !points ? (objects === 1 ? 'OBJ' : 'OBJS') : points && !objects ? (points === 1 ? 'PT' : 'PTS') : 'HELD'
  return { n: points + objects, word, label: `${parts.join(' and ')} held` }
}

/** How many points the selection holds: vertices sharing a spot count once. */
export function useHeldPoints(): number {
  const shard = useWorkshop((s) => s.current())
  const selection = useWorkshop((s) => s.selection)
  if (!shard) return 0
  return new Set(selection.map((i) => { const v = shard.vertices[i]; return v ? ticksOf(v).join(',') : '' }).filter(Boolean)).size
}

/** Whether anything is held: points, placed objects or faces. */
export const useHolding = (): boolean => useWorkshop((s) => s.selection.length > 0 || s.partSel.length > 0 || s.selectedFaces.length > 0)

export function HeldBar({ onMore, moreBadge }: { onMore: () => void; moreBadge: number }): JSX.Element {
  const points = useHeldPoints()
  const objects = useWorkshop((s) => s.partSel.length)
  const selectedFaces = useWorkshop((s) => s.selectedFaces)
  const faceHeld = selectedFaces.length > 0
  const clip = useWorkshop((s) => s.clip)
  const canMove = useWorkshop((s) => s.selection.length > 0 || s.partSel.length > 0)
  const canColor = useWorkshop((s) => s.selection.length > 0)
  const [asking, setAsking] = useState<'paste' | 'color' | null>(null)
  useEffect(() => { if (clip === null && asking === 'paste') setAsking(null) }, [clip, asking])
  useEffect(() => { if (!faceHeld && asking === 'color') setAsking(null) }, [faceHeld, asking])
  // Esc puts a question away before it lets go of what is held.
  useEscape('modal', asking !== null, () => setAsking(null))
  const w = useWorkshop.getState
  // A face held is a face, though its corners are held with it (SELECT FACES).
  const faceCount = faceHeld
  const count = heldCount(faceCount ? 0 : points, faceCount ? 0 : objects, faceCount ? selectedFaces.length : 0)
  const held = clip ? [clip.points.length ? `${clip.points.length} point${clip.points.length === 1 ? '' : 's'}` : '', clip.parts.length ? `${clip.parts.length} object${clip.parts.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') : ''
  // Read at tap time, as Bench reads it for OBJECT: a paste never makes this shard place itself.
  const self = (): string | undefined => ownAddress(useCyberspace.getState().identity.pubkey, w().currentId)
  const deletesFace = faceHeld
  const letGo = (): void => { w().selectVertex(null); w().clearFacePick() }
  return (
    <div className="ws__heldbar" role="toolbar" aria-label="What you hold">
      <button className="ws__heldbtn ws__heldbtn--count" onClick={letGo} title="Let go (Esc)" aria-label={`${count.label}. Tap to let go.`} {...noCallout}>
        <b>{count.n} <X size={12} strokeWidth={2.5} aria-hidden /></b>
        <span>{count.word}</span>
      </button>
      <button className="ws__heldbtn" disabled={!canMove} onClick={() => w().rotateSelected(-1)} title="A quarter turn left, in the working plane (Q)" aria-label="Turn left" {...noCallout}>
        <RotateCcw size={18} strokeWidth={2} aria-hidden /><span>LEFT</span>
      </button>
      <button className="ws__heldbtn" disabled={!canMove} onClick={() => w().rotateSelected(1)} title="A quarter turn right (E)" aria-label="Turn right" {...noCallout}>
        <RotateCw size={18} strokeWidth={2} aria-hidden /><span>RIGHT</span>
      </button>
      <button className="ws__heldbtn" disabled={!canMove} onClick={() => w().copySelection()} title="Copy what you hold, and its faces; it stays where it is (Ctrl+C)" aria-label="Copy the selection" {...noCallout}>
        <Copy size={18} strokeWidth={2} aria-hidden /><span>COPY</span>
      </button>
      <button className="ws__heldbtn ws__heldbtn--two" disabled={clip === null} onClick={() => setAsking((a) => (a === 'paste' ? null : 'paste'))} title={clip ? `Paste the ${held} held` : 'Nothing copied yet'} aria-label={clip ? `Paste the ${held} held` : 'Paste'} aria-haspopup="menu" aria-expanded={asking === 'paste'} {...noCallout}>
        <ClipboardPaste size={18} strokeWidth={2} aria-hidden /><span>PASTE</span>
      </button>
      <button
        className={`ws__heldbtn${faceHeld ? ' ws__heldbtn--two' : ''}`}
        disabled={!canColor}
        onClick={() => { if (faceHeld) setAsking((a) => (a === 'color' ? null : 'color')); else w().colorSelected(w().color) }}
        title={faceHeld ? 'Color the selected faces: BLEND their corners, or a hard EDGE' : 'The color in hand onto what you hold (B)'}
        aria-label={faceHeld ? 'Color the selected faces' : 'Color the selected points'}
        aria-haspopup={faceHeld ? 'menu' : undefined}
        aria-expanded={faceHeld ? asking === 'color' : undefined}
        {...noCallout}
      >
        <PaintBucket size={18} strokeWidth={2} aria-hidden /><span>COLOR</span>
      </button>
      <button className="ws__heldbtn ws__heldbtn--danger" onClick={() => { if (deletesFace) w().deleteSelectedFace(); else w().deleteSelected() }} title={deletesFace ? 'Remove the selected faces (Del)' : 'Delete what you hold (Del)'} aria-label={deletesFace ? 'Delete the face' : 'Delete selected'} {...noCallout}>
        <Trash2 size={18} strokeWidth={2} aria-hidden /><span>DELETE</span>
      </button>
      <button className="ws__heldbtn" onClick={onMore} title="Everything rarer: JOINED, CUT, FILL, SUBDIVIDE, the move pad, exact numbers" aria-label="More" {...noCallout}>
        <Ellipsis size={18} strokeWidth={2} aria-hidden /><span>MORE</span>
        {moreBadge > 0 && <i className="ws__badge" aria-hidden>{moreBadge}</i>}
      </button>
      {asking && (
        <>
          {/* Anywhere else puts the question away and does nothing. */}
          <div className="benchpaste__away" onPointerDown={() => setAsking(null)} />
          {asking === 'paste' && clip && (
            <div className="benchpaste ws__ask" role="menu" aria-label="Where to paste">
              <button className="workshop__btn" role="menuitem" title="Back on the exact points they were taken from (Ctrl+V)" onClick={() => { setAsking(null); w().pasteClip('exact', self()) }}>PASTE</button>
              <button className="workshop__btn" role="menuitem" title="Resting on the plane you are working on, keeping its shape" onClick={() => { setAsking(null); w().pasteClip('floor', self()) }}>PASTE FLOOR</button>
              <button className="workshop__btn workshop__btn--danger" role="menuitem" title={`Let the ${held} go; PASTE goes with them`} onClick={() => { setAsking(null); w().clearClip() }}>CLEAR CLIPBOARD</button>
            </div>
          )}
          {asking === 'color' && faceHeld && (
            <div className="benchpaste ws__ask ws__ask--color" role="menu" aria-label="How to color the selected faces">
              <button className="workshop__btn" role="menuitem" title="The color onto the corners of every selected face; it blends across the edges they share, and a face with a seam takes the color flat" onClick={() => { setAsking(null); w().colorSelected(w().color) }}>BLEND</button>
              <button className="workshop__btn" role="menuitem" title="The color onto every selected face as a hard edge, not blended from its corners" onClick={() => { setAsking(null); w().colorFaces(selectedFaces, w().color, true) }}>EDGE</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
