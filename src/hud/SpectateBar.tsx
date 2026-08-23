/**
 * SpectateBar.tsx — what is true while you are looking through someone else.
 *
 * Whose chain this is, when they last moved, and the one way out. It stays
 * on screen the whole time the panels are locked, because a scene anchored on
 * a stranger with nothing saying so would read as a bug: your avatar gone,
 * your controls gone, the terrain unfamiliar.
 */

import { useEffect, useState } from 'react'
import { stopSpectating } from '../lib/spectator'
import { formatAgo, formatStamp } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { ProfileBadge } from './ProfileBadge'

export function SpectateBar(): JSX.Element | null {
  const spectate = useCyberspace((s) => s.spectate)
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 5_000)
    return () => window.clearInterval(t)
  }, [])

  if (!spectate) return null

  const status =
    spectate.status === 'loading' ? 'FETCHING CHAIN'
      : spectate.status === 'error' ? 'RELAY UNREACHABLE'
        : spectate.status === 'empty' ? 'NO CHAIN ON RELAY, AT PUBKEY COORDINATE'
          : `${spectate.actions.length} ACTION${spectate.actions.length === 1 ? '' : 'S'}`

  return (
    <div className="spectate" role="status">
      <span className="spectate__eye" aria-hidden="true">◉</span>
      <span className="spectate__text">
        <span className="spectate__label">SPECTATING</span>
        <ProfileBadge pubkey={spectate.pubkey} className="spectate__badge" />
        <span className="spectate__meta">
          {spectate.lastActive !== null && (
            <span title={formatStamp(spectate.lastActive)}>LAST ACTIVE {formatAgo(spectate.lastActive, now).toUpperCase()} · </span>
          )}
          {status}
        </span>
      </span>
      <button className="spectate__end" onClick={stopSpectating}>END SPECTATION</button>
    </div>
  )
}
