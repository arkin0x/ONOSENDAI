/**
 * SpectateBar.tsx — what is true while you are looking through someone else.
 *
 * Whose chain this is, when they last moved, and the one way out. It stays
 * on screen the whole time the panels are locked, because a scene anchored on
 * a stranger with nothing saying so would read as a bug: your avatar gone,
 * your controls gone, the terrain unfamiliar.
 *
 * Bottom right, under the zoom keys (arkinox, 2026-11-03). It says how far
 * up the screen it reaches in --spectate-top, so the pad stands above it
 * however many lines its words wrap to (styles.css).
 *
 * Where their chain stops, if it does (lib/chainStop.ts, the rules your own
 * chain is held to), as a plain fact: the day, never a RESPAWN, which is
 * theirs to do and not yours (2026-11-12).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { stopSpectating } from '../lib/spectator'
import { formatAgo, formatStamp } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { ProfileBadge } from './ProfileBadge'
import { everyWhileVisible } from '../lib/whileVisible'
import { useChainStopOf } from '../hooks/useChainStop'
import { spectatedStopWords } from '../lib/chainBreak'

export function SpectateBar(): JSX.Element | null {
  const spectate = useCyberspace((s) => s.spectate)
  const building = useBuilder((s) => s.active)
  const stop = useChainStopOf(spectate?.actions ?? null, 'spectate')
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    return everyWhileVisible(() => setNow(Date.now() / 1000), 5_000)
  }, [])

  const bar = useRef<HTMLDivElement>(null)
  const shown = spectate !== null
  useLayoutEffect(() => {
    const el = bar.current
    if (!shown || !el) return
    const root = document.documentElement.style
    const measure = (): void => { root.setProperty('--spectate-top', `${Math.ceil(window.innerHeight - el.getBoundingClientRect().top)}px`) }
    measure()
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    watch?.observe(el)
    window.addEventListener('resize', measure)
    return () => { watch?.disconnect(); window.removeEventListener('resize', measure); root.removeProperty('--spectate-top') }
  }, [shown])

  if (!spectate) return null

  const status =
    spectate.status === 'loading' ? 'FETCHING CHAIN'
      : spectate.status === 'error' ? 'RELAY UNREACHABLE'
        : spectate.status === 'empty' ? 'NO CHAIN ON RELAY, AT PUBKEY COORDINATE'
          : spectate.status === 'partial' ? `${spectate.actions.length} ACTION${spectate.actions.length === 1 ? '' : 'S'} SO FAR · A STRETCH IS MISSING ON THE RELAYS`
          : `${spectate.actions.length} ACTION${spectate.actions.length === 1 ? '' : 'S'}`

  return (
    <div ref={bar} className="spectate" role="status">
      <span className="spectate__eye" aria-hidden="true">◉</span>
      <span className="spectate__text">
        <span className="spectate__label">SPECTATING</span>
        <ProfileBadge pubkey={spectate.pubkey} className="spectate__badge" tappable />
        <span className="spectate__meta">
          {spectate.lastActive !== null && (
            <span title={formatStamp(spectate.lastActive)}>LAST ACTIVE {formatAgo(spectate.lastActive, now).toUpperCase()} · </span>
          )}
          <span title={spectate.status === 'partial' ? 'The relays are missing part of this chain, so it is drawn up to the gap. Their real head may be further on than what you see here.' : undefined}>{status}</span>
          {stop && <span className="spectate__stop" title={spectatedStopWords(stop).title}> · {spectatedStopWords(stop).text}</span>}
        </span>
      </span>
      {/* VIEW HERE: where they are on screen becomes your VIEW (arkinox, 2026-11-11). Not in BUILD. */}
      {!building && <button className="spectate__end spectate__end--view" title="VIEW from here: move the cursor, pick a region; RECALL goes home" onClick={() => useCyberspace.getState().viewHere()}>VIEW HERE</button>}
      <button className="spectate__end" onClick={stopSpectating}>END SPECTATION</button>
    </div>
  )
}
