/**
 * EarthTrips.tsx: the short trips the tour offers on its Earth route, under
 * the pick and BOARD steps' captions (tutorial/script.ts EARTH_PICK,
 * EARTH_BOARD; tutorial/shortTrip.ts).
 *
 * The onboarding write-up (2026-11-21): the tour's first trip to Earth could
 * mean 22 minutes to 2.5 days of computing, depending on the dot tapped. Here
 * the tour lists up to three landfalls a few blocks along the line from the
 * player's station, each with this device's trip time, and HOSAKA's price for
 * the trip beside them when HOSAKA sells rides. A tap picks the trip (and
 * flies to the stop); nothing boards, rides or spends.
 *
 * Three chamfered tiles side by side, so the list fits the coach on a phone
 * (a third of the screen). Each tile is a fixed height and the list keeps its rows while the speed is
 * measured, so nothing jumps; the picked trip is ticked. On the BOARD step
 * the list is shown only while no short trip is picked.
 */

import { useEffect, useMemo } from 'react'
import { Check, MapPin } from 'lucide-react'
import { useHyperspace, getStopByHeight } from '../store/useHyperspace'
import { useCyberspace } from '../store/useCyberspace'
import { useTutorial } from '../store/useTutorial'
import { formatLatLonDeg } from '../lib/earthSurface'
import { satsLabel } from '../lib/cloud'
import { chooseTrip, currentShortTrips, isShortTrip, measureTripSpeed, rideStart, tripTime, useTripBench, type ShortTrip } from '../tutorial/shortTrip'
import { useRideQuote } from './useRideQuote'
import { viewStop } from './HyperspacePanel'

/** What the list says when no stop is a short trip from here (no landfall in reach, or a device too slow). */
export const NO_SHORT_TRIP = 'No short trip from here right now. SKIP to try something else.'

/** What a trip's row says under its place. */
export function tripMeta(t: ShortTrip): string {
  return t.ms === null ? 'A few min at most' : `About ${tripTime(t.ms)}`
}

export function EarthTrips(): JSX.Element | null {
  const destination = useHyperspace((s) => s.destination)
  const indexVersion = useHyperspace((s) => s.indexVersion)
  const status = useHyperspace((s) => s.sync.status)
  const position = useCyberspace((s) => s.position)
  const events = useCyberspace((s) => s.events)
  const bench = useTripBench((s) => s.bench)
  const stepId = useTutorial((s) => s.script.steps[s.index]?.id)
  useEffect(() => { measureTripSpeed() }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trips = useMemo(() => currentShortTrips(), [indexVersion, status, position, events, bench, destination])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const from = useMemo(() => rideStart(), [indexVersion, status, position, events])
  const picked = destination !== null && isShortTrip(destination) ? destination : null
  // HOSAKA's price for the trip picked, else the first offered.
  const quoted = picked ?? trips[0]?.height ?? null
  const quote = useRideQuote(quoted !== null ? from : null, quoted)

  // On the BOARD and RIDE steps the list is there only to pick a trip when no short one is.
  if ((stepId === 'earth-board' || stepId === 'earth-ride') && picked !== null) return null

  const pick = (t: ShortTrip): void => {
    if (!chooseTrip(t.height)) return
    const stop = getStopByHeight(t.height)
    if (stop) viewStop(stop)
  }

  return (
    <div className="earth-trips" role="group" aria-label="Short trips">
      {trips.length === 0 ? (
        <p className="earth-trips__wait">{status !== 'ready' ? 'Loading the stops.' : from === null ? 'Finding your nearest stop.' : NO_SHORT_TRIP}</p>
      ) : trips.map((t) => {
        const on = picked === t.height
        return (
          // A chamfered frame cut by hand (styles.css .cham-btn): every edge outlined, the two diagonals too.
          <button key={t.height} className={`cham-btn earth-trips__row${on ? ' is-on' : ''}`} onClick={() => pick(t)} aria-pressed={on}>
            <span className="earth-trips__in">
              <span className="earth-trips__icon" aria-hidden>{on ? <Check size={16} strokeWidth={2.25} /> : <MapPin size={16} strokeWidth={2} />}</span>
              <span className="earth-trips__text">
                {/* Latitude over longitude: three trips side by side fit a phone's coach. */}
                {formatLatLonDeg(t.lat, t.lon).split(' ').map((part, i) => <span key={i} className="earth-trips__place">{part}</span>)}
                <span className="earth-trips__meta">{tripMeta(t)}</span>
              </span>
            </span>
          </button>
        )
      })}
      {/* A fixed line, so the price arriving moves nothing. */}
      <p className="earth-trips__hosaka" aria-live="polite">
        {quote.status === 'ready' ? `Or HOSAKA does the computing for you: ${satsLabel(quote.offer.costMsats)}.` : ' '}
      </p>
    </div>
  )
}
