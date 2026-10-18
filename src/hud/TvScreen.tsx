/**
 * TvScreen.tsx: Cyberspace TV's controls, the few things on screen that are
 * not on the tube.
 *
 * Everything TV writes on the picture is painted into the tube itself
 * (scene/tvPainter.ts), so it bends and fringes with it. What stays a page
 * element is what takes a tap: OFF, top left, the workshop's own round close
 * button ("it does not have to look like its part of the tv"), and RETRY
 * under NO SIGNAL. And, off screen, the shard a segment shows, turning
 * (TvSpinHost), for the painter to copy.
 */

import { Tv, X } from 'lucide-react'
import { useEscape } from '../hooks/useEscape'
import { startTvInPlace, tvBlocked, useTv } from '../store/useTv'
import { TvSpinHost } from './TvSegments'

export function TvScreen(): JSX.Element | null {
  const on = useTv((s) => s.on)
  const status = useTv((s) => s.status)
  // Escape turns the set off, over anything else (there is nothing else up).
  useEscape('modal', on, () => useTv.getState().stop())
  if (!on) return null
  return (
    <div className="tv">
      <button className="chip ws__icon tv__off" onClick={() => useTv.getState().stop()} title="Turn Cyberspace TV off (Esc)" aria-label="Turn Cyberspace TV off">
        <X size={15} strokeWidth={2.25} aria-hidden />
      </button>
      {status === 'no-signal' && <button className="chip tv__retry" onClick={() => useTv.getState().retune()}>RETRY</button>}
      <TvSpinHost />
    </div>
  )
}

/**
 * CYBERSPACE TV, at the right of the question under the wordmark (arkinox,
 * 2026-10-18). Not while something else owns the camera (WALK, BUILD, a
 * deploy, the tour, a ride): read on each render of the menu.
 */
export function TvButton(): JSX.Element {
  const not = tvBlocked()
  return (
    <button className="ask-tv" disabled={not !== null} title={not !== null ? `Not during ${not}` : 'Everything that happened here, played back'} onClick={() => startTvInPlace()}>
      <Tv size={12} strokeWidth={2.25} aria-hidden /> TV
    </button>
  )
}
