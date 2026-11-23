/**
 * RoomLockSelect.tsx: ROOM in a chest's or a door's LOCK block (DECK-0004
 * §3.8, draft). The room keys you carry (store/useKeyring roomKeysNow), by
 * the name of the door you opened them through; the chest or door is sealed
 * to the chosen room's lock. Offered only when a room key is known.
 */

import type { CarriedKey } from '../lib/keyringLocks'

export function RoomLockSelect({ rooms, value, keptLabel, onPick }: {
  rooms: CarriedKey[]
  value: string
  /** A kept room lock no longer among `rooms`: shown, so the choice is not silently changed. */
  keptLabel: string | null
  onPick: (lookupId: string) => void
}): JSX.Element {
  return (
    <select className="avatars__input compose__select" value={value} onChange={(e) => onPick(e.target.value)} aria-label="Seal to a room you opened" title="Whoever opened this room opens it">
      {keptLabel !== null && <option value={value}>{keptLabel}</option>}
      {rooms.map((r) => <option key={r.lookupId} value={r.lookupId}>{r.kind === 'room' && r.name ? r.name : 'a room'}</option>)}
    </select>
  )
}
