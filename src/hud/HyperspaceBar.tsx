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
import { abortRide, useRideRun } from './HyperspacePanel'

export function HyperspaceBar(): JSX.Element | null {
  const transit = useCyberspace((s) => s.transit)
  const progress = useRideRun((s) => s.progress)
  const viewOwned = useHyperspace((s) => s.viewOwned)
  const focusLabel = useCyberspace((s) => s.focus?.label ?? null)
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
    ? `RIDING ${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 100}%`
    : 'HYPERSPACE · BOARDED'
  const meta = progress !== null
    ? `BLOCK ${progress.done}/${progress.total}${progress.etaMs !== null ? ` · ETA ${formatMs(progress.etaMs)}` : ''}`
    : 'PICK A STOP AND RIDE · MOVING CANCELS'

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
