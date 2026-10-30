/**
 * WireData.tsx: a thing this device hid, on the wire, in the card's event
 * data (EventData) between its fields and its JSON.
 *
 * This was the wire record (DeploymentDetail), a second overlay reached by
 * WIRE RECORD on the card, which showed the card's comments and reactions
 * all over again (arkinox, 2026-10-20: "kinda confusing and duplicates a
 * lot of stuff like comments and reactions. I think this could be replaced
 * entirely with the new metadata section"). What only it had lives here:
 * the lookup id the bag is filed under, the `C` coordinate, the height, the
 * relays that hold it, and TEST DISCOVERY. The LOCAL / LIVE switch was here
 * too, and now stands under the preview on the card, for the one who hid
 * the thing alone (PublishSwitch PublishRow; arkinox, 2026-10-29).
 *
 * TEST DISCOVERY proves the round-trip: it derives the region key fresh from
 * the coordinate, as a stranger would, asks the relay, and opens what comes
 * back (useShards testDiscovery). It is offered once the bag is LIVE: a LOCAL
 * bag is on no relay to find.
 */

import { useState } from 'react'
import { Radar } from 'lucide-react'
import { positionHex } from '../lib/events'
import { shardRefusal } from '../lib/hidden'
import { positionOf, useShards, type MyDeployment } from '../store/useShards'
import { CopyValue } from './EventData'

export type TestState = 'idle' | 'testing' | 'found' | 'missing' | 'refused'

/** What TEST DISCOVERY says in each state. */
export const TEST_WORDS: Record<TestState, string> = {
  idle: 'TEST DISCOVERY',
  testing: 'DERIVING REGION KEY…',
  found: '✓ FOUND & OPENED FROM THE RELAY',
  missing: '✗ NOT FOUND, TAP TO RETRY',
  refused: '✗ ON THE RELAY, BUT NO CLIENT CAN OPEN IT',
}

/** The relays as they read: no scheme, one to a line. */
export function relayNames(dep: Pick<MyDeployment, 'published' | 'relays'>): string[] {
  return dep.published ? dep.relays.map((r) => r.replace(/^wss?:\/\//, '')) : []
}

export function WireData({ dep, initialTest = 'idle' }: { dep: MyDeployment; initialTest?: TestState }): JSX.Element {
  const [test, setTest] = useState<TestState>(initialTest)
  const at = positionOf(dep)
  const coord = positionHex(at, dep.plane)
  const relays = relayNames(dep)
  const runTest = async (): Promise<void> => {
    setTest('testing')
    // A relay that throws reads as not found: the button offers the retry.
    setTest(await useShards.getState().testDiscovery(dep.eventId).catch(() => 'missing' as const))
  }
  // Why the format refuses it, when it does: the same words the deploy bar
  // would have used, so the fix is named here too.
  const refusal = test === 'refused' && dep.shard ? shardRefusal(dep.shard) : null
  return (
    <>
      <dl className="eventdata__props" aria-label="On the wire">
        <div>
          <dt>lookup ID</dt>
          <dd><CopyValue value={dep.lookupId} title="Tap to copy the lookup id: the d tag of the bag this is in" /></dd>
        </div>
        <div>
          <dt>coord</dt>
          <dd><CopyValue value={coord} title={`Tap to copy the C coordinate\nx ${at.x}\ny ${at.y}\nz ${at.z}`} /></dd>
        </div>
        <div>
          <dt>height</dt>
          <dd><span className="eventdata__plain">{dep.height}</span></dd>
        </div>
        <div>
          <dt>relays</dt>
          <dd>
            {relays.length > 0
              ? relays.map((r) => <span key={r} className="eventdata__plain eventdata__line">{r}</span>)
              : <span className="eventdata__none">nowhere yet: signed and kept on this device</span>}
          </dd>
        </div>
      </dl>
      {dep.published && (
        <button
          className={`secret__act eventdata__test eventdata__test--${test}`}
          title={test === 'refused'
            ? 'The bag is there and this item is in it, signed, but the format refuses it, so every client drops it and only this device shows it. Fix it in the workshop and hide it again; DELETE removes this copy.'
            : 'Derive the region key from the coordinate, as a stranger would, ask the relay, and open what comes back'}
          onClick={() => void runTest()}
          disabled={test === 'testing'}
        >{/* One mark to a state: the radar until there is a result, then its ✓ or ✗. */}
          {(test === 'idle' || test === 'testing') && <Radar size={12} strokeWidth={2.25} aria-hidden />}{TEST_WORDS[test]}</button>
      )}
      {refusal && <p className="eventdata__refusal" role="status">{refusal}</p>}
    </>
  )
}
