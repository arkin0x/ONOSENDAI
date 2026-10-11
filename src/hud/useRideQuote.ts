/**
 * useRideQuote.ts - HOSAKA's price for the ride the Hyperspace panel is
 * showing (onosendai-launch #35 P5; arkinox, 2026-10-11).
 *
 * Asked only when the provider says it sells rides and this one fits what it
 * sells (lib/cloudRide.ts rideFits), and never while cloud compute is off.
 * The quote is public and unsigned, so asking costs no signer prompt and no
 * sats. Every change of ride asks again; an answer for a ride no longer on
 * screen is dropped.
 */

import { useEffect, useMemo, useState } from 'react'
import { rideFits, rideOfferOf, rideServiceOf, type RideOffer } from '../lib/cloudRide'
import { cloudClient, useCyberspace } from '../store/useCyberspace'

export type RideQuoteState =
  /** No HOSAKA option for this ride: cloud off, no ride service, or the ride does not fit it. */
  | { status: 'hidden' }
  | { status: 'loading' }
  | { status: 'ready'; offer: RideOffer }
  /** HOSAKA was asked and did not answer with a price it would sell at. */
  | { status: 'unavailable' }

export function useRideQuote(fromHeight: number | null, toHeight: number | null): RideQuoteState {
  const provider = useCyberspace((s) => s.cloud.provider)
  const mode = useCyberspace((s) => s.cloudPrefs.mode)
  const apiUrl = useCyberspace((s) => s.cloudPrefs.apiUrl)
  const offered = useMemo(
    () => mode !== 'off' && fromHeight !== null && toHeight !== null && rideFits(rideServiceOf(provider), fromHeight, toHeight),
    [mode, provider, fromHeight, toHeight],
  )
  const [state, setState] = useState<RideQuoteState>({ status: 'hidden' })

  useEffect(() => {
    if (!offered || fromHeight === null || toHeight === null) {
      setState({ status: 'hidden' })
      return
    }
    const abort = new AbortController()
    setState({ status: 'loading' })
    cloudClient(apiUrl).rideQuote(fromHeight, toHeight, abort.signal)
      .then((raw) => {
        if (abort.signal.aborted) return
        const offer = rideOfferOf(raw, fromHeight, toHeight)
        setState(offer ? { status: 'ready', offer } : { status: 'unavailable' })
      })
      .catch(() => { if (!abort.signal.aborted) setState({ status: 'unavailable' }) })
    return () => abort.abort()
  }, [offered, apiUrl, fromHeight, toHeight])

  return state
}
