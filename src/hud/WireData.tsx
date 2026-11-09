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
 * TEST DISCOVERY proves the round-trip: up to this device's ceiling it
 * derives the region key fresh from the coordinate, as a stranger would (in a
 * room, the room key, with the door secret), off the main thread, requires it
 * to be the key the bag was sealed with, asks the relay, and opens what comes
 * back (useShards testDiscovery). Above the ceiling, or in a room without its
 * door secret, it can only check with the stored key, and says so: its words
 * are true for the path it takes (review of #622). It is offered once the bag
 * is LIVE: a LOCAL bag is on no relay to find.
 */

import { CYBERSPACE_RELAY, retryFailedAuth } from '../lib/relay'
import { useState } from 'react'
import { Radar } from 'lucide-react'
import { positionHex } from '../lib/events'
import { shardRefusal } from '../lib/hidden'
import { useCalibration } from '../lib/calibration'
import { useCyberspace } from '../store/useCyberspace'
import { discoveryKeyOf, positionOf, useShards, type DiscoveryKey, type MyDeployment } from '../store/useShards'
import { CopyValue } from './EventData'

export type TestState = 'idle' | 'testing' | 'found' | 'missing' | 'refused' | 'unread' | 'wrongKey' | 'underived'

/** What TEST DISCOVERY says in each state. `testing` is the derived path's for a region bag; a room bag's is ROOM_TESTING, the stored key's STORED_TESTING. */
export const TEST_WORDS: Record<TestState, string> = {
  idle: 'TEST DISCOVERY',
  testing: 'DERIVING REGION KEY…',
  found: '✓ FOUND & OPENED FROM THE RELAY',
  missing: '✗ NOT FOUND, TAP TO RETRY',
  refused: '✗ ON THE RELAY, BUT NO CLIENT CAN OPEN IT',
  unread: '✗ COULD NOT READ THE RELAY, TAP TO RETRY',
  wrongKey: '✗ WRONG KEY: STRANGERS CANNOT FIND IT',
  underived: '✗ COULD NOT DERIVE THE KEY, TAP TO RETRY',
}

/** The test under way with the stored key: nothing is derived. */
export const STORED_TESTING = 'CHECKING WITH THE STORED KEY…'

/** The test under way in a room: the room key is derived, from the region key and the door secret. */
export const ROOM_TESTING = 'DERIVING ROOM KEY…'

/** The line under a result checked with the stored key, or null when the key was derived. */
export function storedKeyNote(key: DiscoveryKey): string | null {
  if (key.via === 'derived') return null
  return key.why === 'height'
    ? `CHECKED WITH THE STORED KEY: THIS DEVICE CAN'T DERIVE HEIGHT ${key.height}`
    : 'CHECKED WITH THE STORED KEY: NO DOOR SECRET ON THIS DEVICE'
}

/** The button's tooltip: what the test will do on this path, or why it refused. */
function testTitle(test: TestState, key: DiscoveryKey, room: boolean, gone = false): string {
  if (test === 'refused') return 'The bag is there and this item is in it, signed, but the format refuses it, so every client drops it and only this device shows it. Fix it in the workshop and hide it again; DELETE removes this copy.'
  if (test === 'underived') return 'This device could not derive the key from the coordinate (its key worker failed or ran out of time), so the relay was never asked. Tap to try again.'
  if (test === 'wrongKey') return 'The key derived from the coordinate is not the key this bag was sealed with, so it is filed where no stranger looks.'
  if (gone) return 'This is gone from its bag, so this asks the relay with the stored key and derives nothing: it reads as not found unless the bag holds it again.'
  if (key.via === 'stored') {
    return key.why === 'height'
      ? `This device can't derive height ${key.height}, so this asks the relay with the stored key and opens what comes back. It cannot prove a stranger finds it.`
      : 'This device holds no secret for its door, so this asks the relay with the stored room key and opens what comes back.'
  }
  return room
    ? 'Derive the room key from the coordinate and the door secret, check it is the key this bag was sealed with, ask the relay, and open what comes back'
    : 'Derive the region key from the coordinate, as a stranger would, check it is the key this bag was sealed with, ask the relay, and open what comes back'
}

/** The relays as they read: no scheme, one to a line. */
export function relayNames(dep: Pick<MyDeployment, 'published' | 'relays'>): string[] {
  return dep.published ? dep.relays.map((r) => r.replace(/^wss?:\/\//, '')) : []
}

export function WireData({ dep, initialTest = 'idle', initialChecked = null }: { dep: MyDeployment; initialTest?: TestState; initialChecked?: DiscoveryKey | null }): JSX.Element {
  const [test, setTest] = useState<TestState>(initialTest)
  // The key the last result was checked with: its note stays with that result.
  const [checked, setChecked] = useState<DiscoveryKey | null>(initialChecked)
  const me = useCyberspace((s) => s.identity.pubkey)
  // The ceiling discoveryKeyOf compares against is the calibration's: a
  // benchmark or cache read that lands after the card opened moves it, and
  // this re-renders so the path below follows.
  useCalibration((s) => s.hopHeight)
  // Which path the test takes: a comparison of heights and a stored secret,
  // never a derivation, so it is safe to ask while rendering.
  const path = discoveryKeyOf(dep, me)
  const at = positionOf(dep)
  const coord = positionHex(at, dep.plane)
  const relays = relayNames(dep)
  const runTest = async (): Promise<void> => {
    setTest('testing')
    setChecked(null)
    // A sign-in that failed is asked for again first (no-op otherwise).
    retryFailedAuth(CYBERSPACE_RELAY)
    // A relay that throws reads as not found: the button offers the retry.
    const result = await useShards.getState().testDiscovery(dep.eventId).catch(() => ({ outcome: 'missing' as const, key: path }))
    setChecked(result.key)
    setTest(result.outcome)
  }
  const note = checked && test !== 'idle' && test !== 'testing' ? storedKeyNote(checked) : null
  // A row GONE FROM ITS BAG is asked about with its stored key and nothing is
  // derived (useShards testDiscovery), so it never says DERIVING (review of #625).
  const derives = path.via === 'derived' && dep.goneFrom === undefined
  const words = test !== 'testing' ? TEST_WORDS[test] : !derives ? STORED_TESTING : dep.room ? ROOM_TESTING : TEST_WORDS.testing
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
          title={testTitle(test, path, !!dep.room, dep.goneFrom !== undefined)}
          onClick={() => void runTest()}
          disabled={test === 'testing'}
        >{/* One mark to a state: the radar until there is a result, then its ✓ or ✗. */}
          {(test === 'idle' || test === 'testing') && <Radar size={12} strokeWidth={2.25} aria-hidden />}{words}</button>
      )}
      {note && <p className="eventdata__note" role="status">{note}</p>}
      {refusal && <p className="eventdata__refusal" role="status">{refusal}</p>}
    </>
  )
}
