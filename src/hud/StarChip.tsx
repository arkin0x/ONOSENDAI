/**
 * StarChip.tsx - the star that stands where the folded CHAT chip sits
 * whenever the spot at the center of the screen is not your avatar
 * (lib/starred.ts starSpot says which spot that is).
 *
 * Empty while the spot is not starred; pressing it stars the spot, lights the
 * star yellow with a half-second neon flare (a pulse ring, a scanline sweep,
 * a glitch flicker of the glyph; none of it under reduced motion), and once
 * the flare is over puts up the nickname field (StarNickname.tsx), whose
 * closing says "Added to your Starred Places" in a brief toast. Filled while
 * the spot is already starred; pressing it then takes the spot off the list,
 * with a toast saying that instead.
 */

import { useEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { useStarred } from '../store/useStarred'
import { BRIEF_TOAST_MS, useToast } from '../store/useToast'
import { isStarred, placeName, starSpot } from '../lib/starred'

/** How long the flare plays before the nickname field comes up: the flare's own length. */
export const FLARE_MS = 520

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export function StarChip(): JSX.Element | null {
  // A string, not the spot object: a fresh object on every store change would
  // re-render forever. The spot itself is read again from the state below.
  const spotKey = useCyberspace((s) => { const sp = starSpot(s); return sp ? `${sp.plane}|${sp.input}|${sp.label}` : '' })
  const places = useStarred((s) => s.places)
  // Which press the flare belongs to: bumped on every star so its elements
  // remount and play again, and tied to the spot starred, so arriving later
  // at some other starred spot shows the star filled without replaying it.
  const [flare, setFlare] = useState<{ n: number; key: string } | null>(null)
  // The nickname field waits for the flare. If the chip goes away first (the
  // spot changed, the menu opened), the field is not put up over whatever is
  // now on screen: the place stays starred under its own label, and the toast
  // says so at once.
  const pending = useRef<{ timer: number; entry: { input: string; plane: 0 | 1 } } | null>(null)
  useEffect(() => () => {
    const p = pending.current
    if (!p) return
    window.clearTimeout(p.timer)
    pending.current = null
    useStarred.getState().beginNaming(p.entry)
    useStarred.getState().finishNaming(null)
  }, [])

  if (!spotKey) return null
  const spot = starSpot(useCyberspace.getState())
  if (!spot) return null
  const starred = isStarred(places, spot)
  const name = placeName(places.find((p) => p.input === spot.input && p.plane === spot.plane) ?? spot)
  const lit = starred && flare !== null && flare.key === spotKey

  const press = (): void => {
    const now = starSpot(useCyberspace.getState())
    if (!now) return
    const did = useStarred.getState().toggle(now, useCyberspace.getState().scaleExp)
    if (did === 'added') {
      setFlare((f) => ({ n: (f?.n ?? 0) + 1, key: `${now.plane}|${now.input}|${now.label}` }))
      const entry = { input: now.input, plane: now.plane }
      if (pending.current) window.clearTimeout(pending.current.timer)
      pending.current = {
        entry,
        timer: window.setTimeout(() => { pending.current = null; useStarred.getState().beginNaming(entry) }, reducedMotion() ? 0 : FLARE_MS),
      }
    } else {
      if (pending.current) { window.clearTimeout(pending.current.timer); pending.current = null }
      useToast.getState().show({ label: 'Removed from your Starred Places', meta: name, mark: 'star', ms: BRIEF_TOAST_MS })
    }
  }

  return (
    <button
      className={`chip chatdock__chip starchip ${starred ? 'is-starred' : ''}`}
      onClick={press}
      aria-pressed={starred}
      aria-label={starred ? `Remove ${name} from your Starred Places` : `Add ${name} to your Starred Places`}
      title={starred ? 'Starred. Tap to remove it from your Starred Places' : 'Star this place: it is added to Starred Places in the Position panel'}
    >
      <Star key={`g${lit ? flare.n : 0}`} className={`starchip__glyph ${lit ? 'is-lit' : ''}`} size={13} strokeWidth={2.25} fill={starred ? 'currentColor' : 'none'} aria-hidden />
      {lit && (
        <span key={`f${flare.n}`} className="starchip__flare" aria-hidden="true">
          <span className="starchip__ring" />
          <span className="starchip__scan" />
        </span>
      )}
    </button>
  )
}
