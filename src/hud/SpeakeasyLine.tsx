/**
 * SpeakeasyLine.tsx - the speakeasy your chain head stands in, under the
 * Position panel's coordinate (speakeasy step 7). Nothing at all when there is
 * none, or when the relay could not be asked.
 *
 * Each line is the speakeasy's name (or its region, shortened), a link to the
 * region's page on the relay, and ADD RELAY, which adds its address to your
 * relays exactly as the Relays panel's ADD does. Once it is in your relays the
 * line says JOINED. A speakeasy asks for NIP-42 AUTH, which the relay layer
 * answers for every relay in the set (lib/relay.ts automaticallyAuth).
 */

import { useSpeakeasies } from '../hooks/useSpeakeasies'
import { dashboardUrl, speakeasyLabel, type Speakeasy, type SpeakeasyLookup } from '../lib/speakeasy'
import { normalizeRelay, useRelays } from '../store/useRelays'
import { useCyberspace } from '../store/useCyberspace'

/** Whether the speakeasy's address is already one of your relays. */
export function joined(s: Speakeasy, relays: readonly string[]): boolean {
  const url = normalizeRelay(s.url)
  return !!url && relays.includes(url)
}

/** Add the speakeasy to your relays, as the Relays panel's ADD does. */
export function addSpeakeasy(s: Speakeasy): string | null {
  return useRelays.getState().add(s.url)
}

export function SpeakeasyLine({ lookup }: { lookup?: SpeakeasyLookup }): JSX.Element | null {
  // Your chain head, once there is a chain: a speakeasy admits a head on the relay.
  const coord = useCyberspace((s) => (s.events.length > 0 ? s.coordHex() : null))
  const here = useSpeakeasies(coord, lookup)
  const relays = useRelays((s) => s.relays)
  if (here.length === 0) return null
  return (
    <div className="speakeasy">
      <span className="hash__label">speakeasy</span>
      <ul className="speakeasy__list">
        {here.map((s) => (
          <li key={s.url} className="speakeasy__row">
            <a className="speakeasy__name" href={dashboardUrl(s.region)} target="_blank" rel="noopener noreferrer" title={`Open the page for region ${s.region}`}>
              {speakeasyLabel(s)}
            </a>
            {joined(s, relays)
              ? <span className="speakeasy__joined" title="In your relays">JOINED</span>
              : <button className="speakeasy__add" onClick={() => addSpeakeasy(s)} title={`Add ${s.url} to your relays`}>ADD RELAY</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}
