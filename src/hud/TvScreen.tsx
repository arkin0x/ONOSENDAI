/**
 * TvScreen.tsx: everything Cyberspace TV writes over the picture.
 *
 * A broadcast's furniture, and nothing else (arkinox, 2026-10-18):
 * - the bug in one corner and the tape's clock in the other, the date and
 *   time on screen as they were when it happened;
 * - a chiron under the avatar being shown: who, what they just did, and how
 *   far out the camera is, on the same scale ladder the HUD uses, since a
 *   shot can be framed anywhere from a gibson to a sector;
 * - a ticker along the bottom with the numbers as of that moment
 *   (lib/tv/stats.ts) and the newest arrivals;
 * - LATER when dead air was skipped to get here, MEANWHILE when the tape went
 *   back a little to show someone who was moving at the same time.
 *
 * The tube effect is in the scene (TvScreenEffect); the type here gets its
 * own fringe and scanlines in CSS, so the furniture sits on the same glass.
 */

import { useMemo } from 'react'
import { formatCellSize } from 'sno-core/scale'
import { actionLabel } from '../lib/events'
import { MAX_SCALE_EXP } from '../lib/space'
import { chainLengthAt, countTo } from '../lib/tv/stats'
import { safeNpub } from '../lib/npub'
import { useEscape } from '../hooks/useEscape'
import { useProfile } from '../hooks/useProfile'
import { useTv } from '../store/useTv'
import { LANDMARKS } from './ScaleLadder'
import { ProfilePic } from './ProfileBadge'
import { STATIC_MS } from '../scene/TvScreenEffect'

/** How long LATER and MEANWHILE stay up after a cut, ms. */
const CARD_MS = 2600

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** The tape's clock: the date and the time, local, as a camcorder stamps them. */
export function tapeStamp(at: number): { date: string; time: string } {
  const d = new Date(at * 1000)
  const two = (n: number): string => String(n).padStart(2, '0')
  return {
    date: `${MONTHS[d.getMonth()]} ${two(d.getDate())} ${d.getFullYear()}`,
    time: `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`,
  }
}

/** A stretch of skipped dead air, in the largest two units it spans. */
export function skipWords(seconds: number): string {
  const units: Array<[number, string]> = [[86400, 'DAY'], [3600, 'HOUR'], [60, 'MINUTE'], [1, 'SECOND']]
  const parts: string[] = []
  let left = Math.floor(seconds)
  for (const [n, w] of units) {
    if (parts.length === 2) break
    const k = Math.floor(left / n)
    if (k > 0 || (parts.length === 0 && n === 1)) {
      parts.push(`${k} ${w}${k === 1 ? '' : 'S'}`)
      left -= k * n
    }
  }
  return parts.join(' ')
}

function nameOf(pubkey: string, profileName: string | null | undefined): string {
  if (profileName) return profileName.toUpperCase()
  const npub = safeNpub(pubkey)
  return npub ? `${npub.slice(0, 12)}…` : `${pubkey.slice(0, 8)}…`
}

function ZoomGauge({ scaleExp }: { scaleExp: number }): JSX.Element {
  const top = MAX_SCALE_EXP + 1
  return (
    <div className="tv__zoom" aria-label={`Zoom: one cell is ${formatCellSize(scaleExp)}`}>
      <span className="tv__zoom-label">ZOOM</span>
      <span className="tv__zoom-rail">
        {LANDMARKS.filter((l) => l.h <= MAX_SCALE_EXP).map((l) => (
          <span key={l.name} className="tv__zoom-tick" style={{ left: `${(l.h / top) * 100}%` }} title={l.name} />
        ))}
        <span className="tv__zoom-here" style={{ left: `${(scaleExp / top) * 100}%` }} />
      </span>
      <span className="tv__zoom-value">1 CELL = {formatCellSize(scaleExp).toUpperCase()}</span>
    </div>
  )
}

function Chiron(): JSX.Element | null {
  const shot = useTv((s) => s.shot)
  const played = useTv((s) => s.played)
  const scaleExp = useTv((s) => s.scaleExp)
  const profile = useProfile(shot?.pubkey)
  if (!shot) return null
  const last = played > 0 ? shot.beats[played - 1] : null
  const trip = shot.beats.length
  const doing = last
    ? `${actionLabel(last.action)}${trip > 1 ? ` · ${played} OF ${trip}` : ''}`
    : trip > 1 ? `${trip} ACTIONS COMING UP` : 'ABOUT TO MOVE'
  return (
    <div className="tv__chiron">
      <span className="tv__chiron-pic"><ProfilePic pubkey={shot.pubkey} size={44} /></span>
      <span className="tv__chiron-text">
        <span className="tv__chiron-name">{nameOf(shot.pubkey, profile?.name)}</span>
        <span className="tv__chiron-doing">{doing}</span>
      </span>
      <ZoomGauge scaleExp={scaleExp} />
    </div>
  )
}

function Ticker(): JSX.Element | null {
  const shot = useTv((s) => s.shot)
  const played = useTv((s) => s.played)
  const tapeTime = useTv((s) => s.tapeTime)
  const census = useTv((s) => s.census)
  const chains = useTv((s) => s.chains)
  const arrivals = useTv((s) => s.arrivals)
  const profile = useProfile(shot?.pubkey)
  const items = useMemo(() => {
    if (tapeTime === null) return []
    const out: string[] = []
    const last = shot ? shot.beats[Math.max(0, played - 1)] : null
    if (last?.action.sector) out.push(`SECTOR ${last.action.sector}`)
    if (census) {
      out.push(`${countTo(census.arrivals, tapeTime).toLocaleString()} AVATARS IN CYBERSPACE`)
      out.push(`${countTo(census.bags, tapeTime).toLocaleString()} BAGS HIDDEN`)
      out.push(`${countTo(census.objects, tapeTime).toLocaleString()} OBJECTS PUBLISHED`)
    }
    if (shot) {
      const name = nameOf(shot.pubkey, profile?.name)
      const chain = chains[shot.pubkey]
      // Zero when their spawn is not on the relays: no number is better than a wrong one.
      const length = chain ? chainLengthAt(chain, tapeTime) : 0
      if (length > 0) out.push(`${name}: CHAIN OF ${length.toLocaleString()} ACTION${length === 1 ? '' : 'S'}`)
      if (census) {
        const bags = countTo(census.bagsBy.get(shot.pubkey) ?? [], tapeTime)
        out.push(`${name}: ${bags} BAG${bags === 1 ? '' : 'S'} HIDDEN`)
      }
    }
    for (const a of [...arrivals].reverse()) out.push(`NEW ARRIVAL ${nameOf(a.pubkey, undefined)}`)
    return out
  }, [shot, played, tapeTime, census, chains, arrivals, profile])
  if (items.length === 0) return null
  const line = items.join('   ◆   ')
  return (
    <div className="tv__ticker" aria-label={items.join('. ')}>
      <span className="tv__ticker-tag">CYBERSPACE</span>
      <span className="tv__ticker-window">
        {/* Twice, so the scroll loops without a seam. */}
        <span className="tv__ticker-run" aria-hidden="true">{line}   ◆   {line}   ◆   </span>
      </span>
    </div>
  )
}

function Card(): JSX.Element | null {
  const cutAt = useTv((s) => s.cutAt)
  const skipped = useTv((s) => s.skipped)
  const meanwhile = useTv((s) => s.meanwhile)
  const status = useTv((s) => s.status)
  if (status !== 'playing') return null
  // Mounted again on every cut (key), so its CSS fade starts with the shot.
  const text = meanwhile ? '◀◀ MEANWHILE' : skipped >= 60 ? `▶▶ ${skipWords(skipped)} LATER` : null
  if (!text) return null
  return <div key={cutAt} className="tv__card" style={{ animationDuration: `${CARD_MS}ms`, animationDelay: `${STATIC_MS}ms` }}>{text}</div>
}

function Status(): JSX.Element | null {
  const status = useTv((s) => s.status)
  if (status === 'playing') return null
  return (
    <div className="tv__status" role="status">
      {status === 'tuning' && 'TUNING'}
      {status === 'end' && 'END OF TAPE'}
      {status === 'no-signal' && (
        <>
          NO SIGNAL
          <button className="tv__retry" onClick={() => useTv.getState().retune()}>RETRY</button>
        </>
      )}
    </div>
  )
}

export function TvScreen(): JSX.Element | null {
  const on = useTv((s) => s.on)
  const tapeTime = useTv((s) => s.tapeTime)
  // Escape turns the set off, over anything else (there is nothing else up).
  useEscape('modal', on, () => useTv.getState().stop())
  if (!on) return null
  const stamp = tapeTime !== null ? tapeStamp(tapeTime) : null
  return (
    <div className="tv">
      <div className="tv__bug">CYBERSPACE<b>TV</b></div>
      <div className="tv__clock">
        <span className="tv__play">▶ PLAY</span>
        {stamp && <><span>{stamp.date}</span><span>{stamp.time}</span></>}
      </div>
      <button className="tv__off" onClick={() => useTv.getState().stop()} aria-label="Turn Cyberspace TV off">⏻ OFF</button>
      <Status />
      <Card />
      <div className="tv__lower">
        <Chiron />
        <Ticker />
      </div>
    </div>
  )
}
