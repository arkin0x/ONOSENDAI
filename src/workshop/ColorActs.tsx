/**
 * ColorActs.tsx - what puts the color in hand onto the shard, a column at the
 * bottom right over the strip: the dropper, the whole object, the connected
 * piece, and the bucket (with FILL or SEAM for faces). The color itself is
 * the dock's last slot. Moved out of Workshop.tsx unchanged when the workshop
 * was split by place (workshop redesign, phase 1); phase 3 makes it the PAINT
 * tool.
 */

import { useEffect, useState } from 'react'
import { Globe, PaintBucket, Pipette, Waypoints } from 'lucide-react'
import { rgbToHex } from 'sno-core/shards'
import { noCallout } from '../hooks/useRepeatable'
import { useWorkshop } from '../store/useWorkshop'

export function ColorActs(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const tool = useWorkshop((s) => s.tool)
  const selection = useWorkshop((s) => s.selection)
  const selectedFaces = useWorkshop((s) => s.selectedFaces)
  const faceHeld = selectedFaces.length > 0
  const hex = rgbToHex(useWorkshop((s) => s.color))
  // The color bucket's second stage while a face is in hand (FILL or SEAM):
  // put away when the face goes.
  const [askingColor, setAskingColor] = useState(false)
  useEffect(() => { if (!faceHeld) setAskingColor(false) }, [faceHeld])
  const w = useWorkshop.getState
  // What an action reaches, a column, widest at the top: the whole object,
  // the piece the points in hand are joined to, the points themselves,
  // nearest the strip (arkinox, 2026-09-24). Gone under FACE with no face in
  // hand: there is nothing to put a color on.
  if (tool === 'face' && !faceHeld) return null
  return (
    <div className="ws__acts" role="group" aria-label="Apply the color">
      {/* The dropper, over the globe while one point or one face is in
          hand (arkinox, 2026-10-10): that color, a face's as the average of
          its corners, into the dock's color and onto the front of the recent
          row. */}
      {(selection.length === 1 || (faceHeld && (selection.length === 0 || tool === 'face'))) && (
        <button className="workshop__color ws__act" onClick={() => w().sampleColor()} title={faceHeld && (selection.length === 0 || tool === 'face') ? 'Take this face\'s color: its seam color, else the average of its corners' : 'Take this point\'s color'} aria-label="Take the selected color" {...noCallout}>
          <Pipette size={17} strokeWidth={2.25} aria-hidden />
        </button>
      )}
      <button className="workshop__color ws__act" disabled={!shard || shard.vertices.length === 0} onClick={() => w().colorAll(w().color)} title="The color onto every vertex and every face in the object" aria-label="Color everything" style={{ borderColor: hex }} {...noCallout}>
        <Globe size={17} strokeWidth={2.25} aria-hidden />
      </button>
      {selection.length > 0 && (
        <button className="workshop__color ws__act" onClick={() => w().colorConnected(w().color)} title="The color onto these points and everything joined to them by faces" aria-label="Color the connected piece" style={{ borderColor: hex }} {...noCallout}>
          <Waypoints size={17} strokeWidth={2.25} aria-hidden />
        </button>
      )}
      {/* The bucket: the color onto the points in hand. With faces in
          hand it asks first (arkinox, 2026-10-10; SEAM was its own key
          on the face row): FILL colors their corners and blends across
          the edges they share, SEAM gives every one a hard color
          that stops at its edge (store colorFaces). */}
      {selection.length > 0 && !faceHeld && (
        <button className="workshop__color ws__act" onClick={() => w().colorSelected(w().color)} title="The color onto the points in hand" aria-label="Color the selected points" style={{ borderColor: hex }} {...noCallout}>
          <PaintBucket size={17} strokeWidth={2.25} aria-hidden />
        </button>
      )}
      {faceHeld && (
        <button className="workshop__color ws__act ws__act--two" onClick={() => setAskingColor((o) => !o)} title="Color the selected faces: their corners, or a hard seam" aria-label="Color the selected faces" aria-haspopup="menu" aria-expanded={askingColor} style={{ borderColor: hex }} {...noCallout}>
          <PaintBucket size={17} strokeWidth={2.25} aria-hidden />
        </button>
      )}
      {askingColor && faceHeld && (
        <>
          {/* Anywhere else puts the question away and colors nothing. */}
          <div className="benchpaste__away" onPointerDown={() => setAskingColor(false)} />
          <div className="benchpaste benchpaste--right" role="menu" aria-label="How to color the selected faces">
            <button className="workshop__btn" role="menuitem" title="The color onto the corners of every selected face; it blends across the edges they share, and a face with a seam takes the color flat" onClick={() => { setAskingColor(false); w().colorSelected(w().color) }}>FILL</button>
            <button className="workshop__btn" role="menuitem" title="The color onto every selected face as a hard seam, not blended from its corners" onClick={() => { setAskingColor(false); w().colorFaces(selectedFaces, w().color) }}>SEAM</button>
          </div>
        </>
      )}
    </div>
  )
}
