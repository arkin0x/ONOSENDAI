/**
 * HyperspaceBar.tsx - what is true while you are on the line.
 *
 * Boarded is a real chain state with nothing visible in the scene: the enter
 * event is signed and the next ride departs from it, but the avatar has not
 * moved (§3.3). Without a bar saying so, BOARDED would be indistinguishable
 * from standing still, and the way out would vanish whenever the panels fold.
 * Modelled on SpectateBar; the two are mutually exclusive in practice, since
 * boarding requires being at your own head, but this one stacks below it so a
 * surprise overlap never hides either exit button.
 */

import { formatMs } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { exitHyperspaceView, useHyperspace } from '../store/useHyperspace'
import { rideFraction } from '../lib/hyperspace/ridePool'
import { abortRide, useRideRun } from './HyperspacePanel'
import { useEscape } from '../hooks/useEscape'

export function HyperspaceBar(): JSX.Element | null {
  const transit = useCyberspace((s) => s.transit)
  const progress = useRideRun((s) => s.progress)
  // A ride HOSAKA is computing (arkinox, 2026-10-11): ten minutes with the
  // panels folded on a phone, so the bar says so and offers the way out.
  const cloudStatus = useCyberspace((s) => s.cloud.status)
  const cloudProgress = useCyberspace((s) => s.cloud.progress)
  const hosakaRide = useCyberspace((s) => s.cloud.job?.action === 'ride')
  const viewOwned = useHyperspace((s) => s.viewOwned)
  const focusLabel = useCyberspace((s) => s.focus?.label ?? null)
  // Viewing a stop, EARTH or your station: Escape is RETURN, a chip on the
  // Escape stack (arkinox, 2026-10-01). Boarding and riding are chain states,
  // not views, and Escape never touched them; it still does not.
  useEscape('chip', viewOwned, exitHyperspaceView)
  if (hosakaRide && cloudStatus !== 'idle' && cloudStatus !== 'error') {
    const meta = cloudStatus === 'awaiting_payment' ? 'AWAITING PAYMENT'
      : cloudStatus === 'verifying' ? 'CHECKING THE PROOF HERE'
        : cloudStatus === 'computing' ? 'HOSAKA IS COMPUTING THE PROOF'
          : 'STARTING'
    const pct = cloudStatus === 'computing' && cloudProgress !== null ? ` ${Math.round(cloudProgress * 100)}%` : ''
    return (
      <div className="hyperbar" role="status">
        <span className="hyperbar__glyph" aria-hidden="true">◆</span>
        <span className="hyperbar__text">
          <span className="hyperbar__label">RIDING VIA HOSAKA{pct}</span>
          <span className="hyperbar__meta">{meta}</span>
        </span>
        <button className="hyperbar__end" title="Unpaid, nothing is charged; paid, the job is kept for RESUME" onClick={() => useCyberspace.getState().cancelCloud()}>CANCEL</button>
      </div>
    )
  }
  if (transit === null && progress === null) {
    // Just looking: the bar is the always-visible way home from VIEW, EARTH,
    // or a scrubbed stop, since the panel column may be folded away.
    if (!viewOwned) return null
    return (
      <div className="hyperbar" role="status">
        <span className="hyperbar__glyph" aria-hidden="true">◆</span>
        <span className="hyperbar__text">
          <span className="hyperbar__label">VIEWING</span>
          <span className="hyperbar__meta">{focusLabel ?? 'HYPERSPACE'}</span>
        </span>
        <button className="hyperbar__end" onClick={() => exitHyperspaceView()}>RETURN</button>
      </div>
    )
  }

  const label = progress !== null
    ? `RIDING ${Math.round(rideFraction(progress) * 100)}%`
    : 'HYPERSPACE · BOARDED'
  // Every block first, then the re-roll price (§5.5): attempts against the
  // expected count, which an unlucky search can pass.
  const eta = progress?.etaMs != null ? ` · ETA ${formatMs(progress.etaMs)}` : ''
  const meta = progress === null
    ? 'PICK A BLOCK AND RIDE · MOVING CANCELS'
    : progress.price === null
      ? `BLOCK ${progress.done}/${progress.total}${eta}`
      : `PRICE ${progress.price.attempts}/~${progress.price.expected}${eta}`

  // One gesture whatever the stage: stop any pool, forget the boarding. The
  // wire needs nothing, the next ordinary hop cancels it there (§3.3).
  const exit = (): void => {
    abortRide()
    useCyberspace.getState().cancelTransit()
  }

  return (
    <div className="hyperbar" role="status">
      <span className="hyperbar__glyph" aria-hidden="true">◆</span>
      <span className="hyperbar__text">
        <span className="hyperbar__label">{label}</span>
        <span className="hyperbar__meta">{meta}</span>
      </span>
      <button className="hyperbar__end" onClick={exit}>{progress !== null ? 'CANCEL' : 'EXIT'}</button>
    </div>
  )
}
