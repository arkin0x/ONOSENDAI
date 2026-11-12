/**
 * SpeakeasyLine.tsx - the speakeasy you are in, as its relay sees it, under
 * the Position panel's coordinate (speakeasy step 7). Nothing at all when
 * there is none, or when the relay could not be asked.
 *
 * Each line is the speakeasy's name (or its region, shortened), a link to the
 * region's page on the relay, and ADD RELAY, which adds its address to your
 * relays exactly as the Relays panel's ADD does. Once it is in your relays the
 * line says JOINED. A speakeasy asks for NIP-42 AUTH, which the relay layer
 * answers for every relay in the set (lib/relay.ts automaticallyAuth).
 *
 * The relay admits you by where it places you, not by your head: the last
 * point of your chain its verifier accepts (lib/relayPlacement.ts). Where the
 * two differ (a chain the relay stopped, on which ONOSENDAI still lets you
 * move), a speakeasy holding your head and not that point gets a short
 * warning instead of ADD RELAY, and RESPAWN when only a respawn fixes it. One
 * holding that point and not your head is listed with ADD RELAY: the relay
 * admits a frozen chain where it froze.
 *
 * Asked only while LIVE, and only about the published part of your chain
 * (lib/speakeasy.ts publishedHeadHex): the relay judges the chain it holds,
 * and a move still on this device (LOCAL, held, waiting for the network or a
 * conflict) is never sent anywhere. While the panel is unfolded, a place that
 * stays put is asked about again when its answer expires.
 */

import { useMemo } from 'react'
import { placedLookup as defaultPlacedLookup, useSpeakeasies } from '../hooks/useSpeakeasies'
import { useRelayPlacement } from '../hooks/useRelayPlacement'
import { dashboardUrl, inRegion, publishedHeadHex, speakeasyLabel, type Speakeasy, type SpeakeasyLookup } from '../lib/speakeasy'
import { RELAY_MAX_HOP_HEIGHT, type RelayStop } from '../lib/relayPlacement'
import { respawnPointOf } from '../lib/chainStop'
import { stopDay } from '../lib/chainBreak'
import { normalizeRelay, useRelays } from '../store/useRelays'
import { useCyberspace } from '../store/useCyberspace'
import { useChainUi } from '../store/useChainUi'
import { usePanelLayout } from '../store/usePanelLayout'

/** Whether the speakeasy's address is already one of your relays. */
export function joined(s: Speakeasy, relays: readonly string[]): boolean {
  const url = normalizeRelay(s.url)
  return !!url && relays.includes(url)
}

/** Add the speakeasy to your relays, as the Relays panel's ADD does. */
export function addSpeakeasy(s: Speakeasy): string | null {
  return useRelays.getState().add(s.url)
}

/** What a speakeasy holding your head, and not where the relay placed you, says instead of ADD RELAY. */
export function stoppedWords(stop: RelayStop): string {
  // The day, in UTC, of the last action the relay accepts: where the chain stops.
  const at = stop.lastValid ? stopDay(stop) : null
  const where = at ? `Your chain stops at ${at}, outside this region.` : 'Your chain stops at its spawn, outside this region.'
  return stop.kind === 'tall'
    ? `This relay checks hops up to h${RELAY_MAX_HOP_HEIGHT}. ${where}`
    : `${where} Respawn to enter.`
}

/**
 * The respawn there already is: the broken-chain notice when ONOSENDAI sees
 * the stop too (lib/chainStop.ts, the same rules since 2026-11-12), else the
 * Derezz panel, unfolded and brought into view. Both warn and ask before
 * anything is signed.
 */
export function openRespawn(): void {
  if (respawnPointOf(useCyberspace.getState().actions())) {
    useChainUi.getState().setBrokenView('notice')
    return
  }
  const layout = usePanelLayout.getState()
  if (layout.collapsed.derezz) layout.toggle('derezz')
  if (typeof document !== 'undefined') document.querySelector('[data-panel-id="derezz"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

export function SpeakeasyLine({ lookup, placedLookup = defaultPlacedLookup }: { lookup?: SpeakeasyLookup; placedLookup?: SpeakeasyLookup }): JSX.Element | null {
  // Your published head, and only while LIVE: a string, so the selector is stable.
  const head = useCyberspace((s) => (s.live ? publishedHeadHex(s.actions(), s.published) : null))
  const open = usePanelLayout((s) => s.collapsed.position !== true)
  const placement = useRelayPlacement(open)
  const placed = placement?.coordHex ?? null
  const atHead = useSpeakeasies(head, open, lookup)
  // Asked about separately only when the relay places you away from your head.
  const atPlaced = useSpeakeasies(placed !== head ? placed : null, open, placedLookup)
  const relays = useRelays((s) => s.relays)
  // Each speakeasy at either place, and whether the relay admits you there:
  // where it placed you is inside, or else the stop that keeps you out.
  // Until the relay's view is known (the 5.13 list still loading), none.
  const rows = useMemo(() => {
    if (!placement) return []
    const seen = new Set(atHead.map((s) => s.url))
    return [...atHead, ...atPlaced.filter((s) => !seen.has(s.url))]
      .sort((a, b) => b.region.length - a.region.length)
      .flatMap((s): Array<{ s: Speakeasy; stop: RelayStop | null }> => (inRegion(s, placement.coordHex) ? [{ s, stop: null }] : placement.stop ? [{ s, stop: placement.stop }] : []))
  }, [atHead, atPlaced, placement])
  if (rows.length === 0) return null
  return (
    <div className="speakeasy">
      <span className="hash__label">speakeasy</span>
      <ul className="speakeasy__list">
        {rows.map(({ s, stop }) => (
          <li key={s.url} className={`speakeasy__row${stop ? ' speakeasy__row--stopped' : ''}`}>
            <a className="speakeasy__name" href={dashboardUrl(s.region)} target="_blank" rel="noopener noreferrer" title={`Open the page for region ${s.region}`}>
              {speakeasyLabel(s)}
            </a>
            {stop
              ? stop.kind === 'broken' && <button className="speakeasy__add speakeasy__respawn" onClick={openRespawn} title="Open the respawn: it warns and asks before anything is signed">RESPAWN</button>
              : joined(s, relays)
                ? <span className="speakeasy__joined" title="In your relays">JOINED</span>
                : <button className="speakeasy__add" onClick={() => addSpeakeasy(s)} title={`Add ${s.url} to your relays`}>ADD RELAY</button>}
            {stop && <p className="speakeasy__stopped" role="note">{stoppedWords(stop)}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
