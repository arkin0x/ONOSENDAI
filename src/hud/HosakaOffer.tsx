/**
 * HosakaOffer.tsx - the card that appears when the cursor is beyond this machine.
 *
 * Not part of the menu: it fades in on the right of the scene the moment a
 * lined-up move is taller than this machine hops, says what HOSAKA is in
 * three sentences, and carries the two settings a person needs to say yes
 * (mode and budget) plus GO, so the operation completes without opening a
 * panel. It leaves when the cursor comes back within reach, when a route or
 * cloud flow takes over, when the menu opens, or on NOT NOW for this cursor.
 */

import { useEffect, useMemo, useState } from 'react'
import { useCalibration } from '../lib/calibration'
import { type CloudMode } from '../lib/cloud'
import { offerVerdict } from '../lib/offer'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'

const MODES: CloudMode[] = ['auto', 'ask', 'off']

/** The looping banner, AV1 first and VP9 for the rest; a still where video is off. */
export function HosakaBanner({ className = '' }: { className?: string }): JSX.Element {
  return (
    <video className={`hosaka-banner ${className}`} autoPlay muted loop playsInline poster="/hosaka-poster.jpg" aria-hidden="true">
      <source src="/hosaka.webm" type="video/webm; codecs=av01" />
      <source src="/hosaka-vp9.webm" type="video/webm; codecs=vp9" />
    </video>
  )
}

export function HosakaOffer({ hidden = false }: { hidden?: boolean }): JSX.Element | null {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace((s) => s.plane)
  const atHead = useCyberspace((s) => s.atHead())
  const plan = useCyberspace((s) => s.plan)
  const proof = useCyberspace((s) => s.proof)
  const cloud = useCyberspace((s) => s.cloud)
  const prefs = useCyberspace((s) => s.cloudPrefs)
  const setCloudMode = useCyberspace((s) => s.setCloudMode)
  const setCloudPrefs = useCyberspace((s) => s.setCloudPrefs)
  const commit = useCyberspace((s) => s.commit)
  const fetchCaps = useCyberspace((s) => s.resumeCloudJob)
  const hopCeil = useCalibration((s) => s.hopHeight)
  const sidestepCeil = useCalibration((s) => s.sidestepHeight)

  const cloudKnown = cloud.limits !== null
  const verdict = useMemo(() => {
    const ceilings = {
      hop: Math.min(MAX_COMPUTE_HEIGHT, hopCeil),
      sidestep: sidestepCeil,
      cloudHop: cloud.limits?.max_hop_height ?? 0,
      cloudSidestep: cloud.limits?.max_sidestep_height ?? 0,
    }
    return offerVerdict(position, cursor, plane, ceilings, cloudKnown)
  }, [position, cursor, plane, hopCeil, sidestepCeil, cloud.limits, cloudKnown])

  // NOT NOW is for this cursor; a new far cursor asks again.
  const cursorKey = `${cursor.x}:${cursor.y}:${cursor.z}:${plane}`
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)

  // The caps come from HOSAKA; ask once when the offer first has a reason to exist.
  useEffect(() => {
    if (verdict && !cloudKnown && prefs.mode !== 'off') void fetchCaps()
  }, [verdict !== null, cloudKnown, prefs.mode, fetchCaps]) // eslint-disable-line react-hooks/exhaustive-deps

  const busy = plan !== null || cloud.status !== 'idle' || proof.status === 'computing'
  if (hidden || !atHead || !verdict || busy || dismissedFor === cursorKey) return null

  const machine = Math.min(MAX_COMPUTE_HEIGHT, hopCeil)
  const canGo = verdict.tier === 'cloud' && prefs.mode !== 'off'
  const [budgetText, setBudgetText] = [String(prefs.autoMaxSats), (v: string) => setCloudPrefs({ autoMaxSats: Math.max(0, Math.floor(Number(v) || 0)) })]

  return (
    <aside className="offer" role="dialog" aria-label="HOSAKA cloud compute">
      <HosakaBanner />
      <div className="offer__body">
        <h2 className="offer__title">HOSAKA</h2>
        <p className="offer__lead">
          Your machine does not have the capacity to make this jump. HOSAKA can help.
          Offload your work to HOSAKA's compute and get the result in minutes. Paid via bitcoin lightning.
        </p>
        <dl className="offer__reach">
          <div><dt>This jump</dt><dd>{`wall of 2^${verdict.tallestWall}`}</dd></div>
          <div><dt>Your machine</dt><dd>{`up to h${machine}`}</dd></div>
          <div><dt>HOSAKA</dt><dd>{cloudKnown ? `up to h${cloud.limits!.max_hop_height} hops, h${cloud.limits!.max_sidestep_height} walls` : 'asking for its caps'}</dd></div>
        </dl>
        {verdict.tier === 'impossible' && (
          <p className="notice">Beyond HOSAKA too: no one computes a wall this tall yet. Line up a nearer cursor.</p>
        )}
        {verdict.tier === 'cloud' && (
          <p className="legend__note">{`${verdict.cloudSteps} of ${verdict.steps} step${verdict.steps === 1 ? '' : 's'} would go to HOSAKA. GO quotes them; one invoice funds the whole route.`}</p>
        )}
        <div className="offer__controls">
          <div className="offer__modes" role="radiogroup" aria-label="Cloud mode">
            {MODES.map((m) => (
              <button key={m} className={`offer__mode ${prefs.mode === m ? 'offer__mode--on' : ''}`} onClick={() => setCloudMode(m)} aria-pressed={prefs.mode === m}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          <label className="offer__budget">
            <span>Pay without asking up to</span>
            <input type="number" min={0} step={1} inputMode="numeric" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} aria-label="Auto-pay budget in sats" />
            <span>sats</span>
          </label>
        </div>
        <div className="offer__row">
          <button className="offer__button offer__button--later" onClick={() => setDismissedFor(cursorKey)}>NOT NOW</button>
          <button className="offer__button offer__button--go" onClick={() => void commit()} disabled={!canGo}>
            {prefs.mode === 'off' ? 'CLOUD IS OFF' : verdict.tier === 'cloud' ? 'GO' : verdict.tier === 'cloud-unknown' ? 'CONNECTING' : 'IMPOSSIBLE'}
          </button>
        </div>
        <p className="offer__note">HOSAKA learns the coordinates of the moves it computes. Every result is verified here before it is signed.</p>
      </div>
    </aside>
  )
}
