/**
 * HosakaOffer.tsx - the card that appears when the cursor is beyond this machine.
 *
 * Not part of the menu: it fades in at the right edge of the screen (centred
 * on a phone) the moment a
 * lined-up move is taller than this machine hops, says what HOSAKA is in
 * three sentences, and carries the two settings a person needs to say yes
 * (mode and budget) plus GO, so the operation completes without opening a
 * panel. It leaves when the cursor comes back within reach, when a route or
 * cloud flow takes over, when the menu opens, when the cursor moves, or on
 * NOT NOW for this cursor. It appears only after OFFLOAD is pressed for the
 * cursor (useOffer), never on its own.
 */

import { useEffect } from 'react'
import { type CloudMode } from '../lib/cloud'
import { useCyberspace } from '../store/useCyberspace'
import { useOffer, useOfferView } from '../store/useOffer'
import { CheckPaymentButton } from './InvoiceModal'

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
  const cloud = useCyberspace((s) => s.cloud)
  const prefs = useCyberspace((s) => s.cloudPrefs)
  const setCloudMode = useCyberspace((s) => s.setCloudMode)
  const setCloudPrefs = useCyberspace((s) => s.setCloudPrefs)
  const setInvoiceOpen = useCyberspace((s) => s.setInvoiceOpen)
  const cancelCloud = useCyberspace((s) => s.cancelCloud)
  const commit = useCyberspace((s) => s.commit)
  const fetchCaps = useCyberspace((s) => s.resumeCloudJob)
  const dismiss = useOffer((s) => s.dismiss)
  const view = useOfferView(hidden)
  const cloudKnown = cloud.limits !== null

  // The caps come from HOSAKA; ask once when the offer first has a reason to exist.
  useEffect(() => {
    if (view && !cloudKnown && prefs.mode !== 'off') void fetchCaps()
  }, [view !== null, cloudKnown, prefs.mode, fetchCaps]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) return null
  const { verdict, cursorKey, machineCeiling: machine } = view
  const estimating = cloud.status === 'quoting'
  const paying = cloud.status === 'awaiting_payment'
  const estimated = cloud.status === 'confirm'
  const funding = cloud.status === 'funding'
  const canGo = verdict.tier === 'cloud' && prefs.mode !== 'off' && !estimating && !paying && !funding && !estimated
  const budgetText = String(prefs.autoMaxSats)
  const setBudgetText = (v: string) => setCloudPrefs({ autoMaxSats: Math.max(0, Math.floor(Number(v) || 0)) })

  return (
    <aside className="offer" role="dialog" aria-label="HOSAKA cloud compute">
      <HosakaBanner />
      <div className="offer__body">
        <h2 className="offer__title">HOSAKA</h2>
        <p className="offer__tagline">High-availability Offload Service for Advanced Kinematic Actions</p>
        <p className="offer__lead">
          Your machine does not have the capacity to calculate this action. HOSAKA can help.
          Offload your work to HOSAKA's compute and get the result in seconds to minutes. Paid via bitcoin lightning.
        </p>
        <dl className="offer__reach">
          <div><dt>This action</dt><dd>{`2^${verdict.tallestWall} calculations`}</dd></div>
          <div><dt>Your machine</dt><dd>{`up to 2^${machine} calculations`}</dd></div>
          <div><dt>HOSAKA</dt><dd>{cloudKnown ? `up to 2^${cloud.limits!.max_hop_height} hops, 2^${cloud.limits!.max_sidestep_height} sidesteps` : 'asking for its caps'}</dd></div>
        </dl>
        {verdict.tier === 'impossible' && (
          <p className="notice">Beyond HOSAKA too: no one computes a boundary this high yet. Line up a nearer cursor.</p>
        )}
        {verdict.tier === 'cloud' && (
          <p className="legend__note">{`${verdict.cloudSteps} of ${verdict.steps} actions would offload to HOSAKA.`}</p>
        )}
        <div className="offer__controls">
          <div className="offer__modes" role="radiogroup" aria-label="Cloud mode">
            {MODES.map((m) => (
              <button key={m} className={`offer__mode ${prefs.mode === m ? 'offer__mode--on' : ''}`} onClick={() => setCloudMode(m)} aria-pressed={prefs.mode === m}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          {/* The budget only means something in AUTO: ASK always asks, OFF never pays. */}
          {prefs.mode === 'auto' && (
            <label className="offer__budget">
              <span>Pay without asking up to</span>
              <input type="number" min={0} step={1} inputMode="numeric" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} aria-label="Auto-pay budget in sats" />
              <span>sats</span>
            </label>
          )}
        </div>
        {paying ? (
          // The invoice is out. This card is the desktop's control surface for it.
          <div className="offer__row">
            {!cloud.invoiceOpen && <button className="offer__button" onClick={() => setInvoiceOpen(true)}>SHOW INVOICE</button>}
            <CheckPaymentButton className="offer__button" />
            <button className="offer__button offer__button--later" onClick={() => cancelCloud()}>CANCEL</button>
          </div>
        ) : (
        <div className="offer__row">
          <button className="offer__button offer__button--later" onClick={() => dismiss(cursorKey)} disabled={estimating || funding || estimated}>NOT NOW</button>
          <button className={`offer__button offer__button--go ${estimating || funding ? 'is-busy' : ''}`} onClick={() => void commit()} disabled={!canGo}>
            {(estimating || funding) && <span className="spin" aria-hidden="true" />}
            {estimating ? 'ESTIMATING' : estimated ? 'ESTIMATED' : funding ? 'FUNDING' : prefs.mode === 'off' ? 'CLOUD IS OFF' : verdict.tier === 'cloud' ? 'ESTIMATE \u2192' : verdict.tier === 'cloud-unknown' ? 'CONNECTING' : 'IMPOSSIBLE'}
          </button>
        </div>
        )}
        <p className="offer__note">HOSAKA necessarily learns the cantor roots of the moves it computes. Every result is verified locally before you sign it.</p>
      </div>
    </aside>
  )
}
