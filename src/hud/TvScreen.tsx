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
 *
 * On the stream (lib/tv/broadcast) nobody can tap: no OFF, no RETRY, no
 * Escape. NO SIGNAL tunes again by itself after BROADCAST_RETUNE_MS.
 */

import { useEffect } from 'react'
import { Tv, X } from 'lucide-react'
import { useEscape } from '../hooks/useEscape'
import { startTvInPlace, tvBlocked, useTv } from '../store/useTv'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { useShards } from '../store/useShards'
import { useDemo } from '../store/useDemo'
import { TvSpinHost } from './TvSegments'
import { isBroadcast } from '../lib/tv/broadcast'

/** On the stream, how long NO SIGNAL stays before TV tunes again by itself, ms: nobody can press RETRY there. */
export const BROADCAST_RETUNE_MS = 60_000

export function TvScreen(): JSX.Element | null {
  const on = useTv((s) => s.on)
  const status = useTv((s) => s.status)
  const broadcast = isBroadcast()
  // Escape turns the set off, over anything else (there is nothing else up).
  useEscape('modal', on && !broadcast, () => useTv.getState().stop())
  useEffect(() => {
    if (!broadcast || !on || status !== 'no-signal') return
    const t = setTimeout(() => useTv.getState().retune(), BROADCAST_RETUNE_MS)
    return () => clearTimeout(t)
  }, [broadcast, on, status])
  if (!on) return null
  if (broadcast) return <div className="tv"><TvSpinHost /></div>
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
  // Each of what can block it, subscribed, so the button is current while
  // the menu stays open: it read tvBlocked() only when the menu happened to
  // render, and sat enabled through WALK doing nothing (review of #375).
  useCyberspace((s) => s.walking)
  useCyberspace((s) => s.transit !== null)
  useBuilder((s) => s.active)
  useShards((s) => s.pending !== null)
  useDemo((s) => s.active)
  const not = tvBlocked()
  return (
    <button className="ask-tv" disabled={not !== null} title={not !== null ? `Not during ${not}` : 'Everything that happened here, played back'} onClick={() => startTvInPlace()}>
      <Tv size={12} strokeWidth={2.25} aria-hidden /> TV
    </button>
  )
}
