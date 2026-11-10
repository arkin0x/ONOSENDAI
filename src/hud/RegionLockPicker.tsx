/**
 * RegionLockPicker.tsx: REGION in a chest's or a door's LOCK block (DECK-0004
 * §3.8, draft; conjunction seals design §4.2, slice 1).
 *
 * The hider picks a region, and the chest or door is sealed to its lock: it
 * then opens for whoever carries that region's key. A region is picked by
 * height around a point: THE CHEST (or THE DOOR) where it was placed, or ME,
 * where your avatar stands; or a region key already on your KEYRING, newest
 * first. The key is computed here (lib/regionKeyOffThread) for the heights
 * every visitor's scan computes too (1 to SCAN_MAX_HEIGHT); a larger region
 * comes from the keyring.
 *
 * Two warnings, one line each: a region that holds the chest opens for
 * whoever finds it, and a region nobody keeps the key of rarely opens.
 *
 * A lock it was given (`kept`: a draft back from MOVE, or a chest of yours
 * being edited) stands until the hider changes something here.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Plane } from 'cyberspace-core'
import { formatCellSize } from 'sno-core/scale'
import { formatAgo } from '../lib/time'
import { inRoom, regionBase } from '../lib/doors'
import { lockOf, lockOfHex } from '../lib/locks'
import { baseOf } from '../lib/secrets/base'
import { regionKeyOffThread } from '../lib/regionKeyOffThread'
import type { Position } from '../lib/space'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { heldList, useSecrets, type HeldKey } from '../store/useSecrets'
import { SCAN_MAX_HEIGHT, type ChestLock, type RegionChoice } from '../store/useShards'

/** The label a region lock carries in the draft, and the default `requires` line it suggests. */
export const REGION_LOCK_LABEL = 'a region'
export const REGION_REQUIRES = 'the key of a place'

/** The keys the KEYRING list offers: cubes you hold, height 1 and up, newest first. */
export function keyringRegions(keys: Record<string, HeldKey>): HeldKey[] {
  return heldList(keys, 'recent').filter((k) => k.height >= 1 && (!k.heights || (k.heights.x === k.heights.y && k.heights.y === k.heights.z)))
}

type From = RegionChoice['from']

export function RegionLockPicker({ spot, chestHeight, noun, kept, onLock }: {
  /** Where the chest or door stands; null before it is placed. */
  spot: { at: Position; plane: Plane } | null
  /** The height it is hidden at: the default region height. */
  chestHeight: number
  /** "chest" or "door", for the buttons and the warning. */
  noun: 'chest' | 'door'
  kept: ChestLock | null
  onLock: (lock: ChestLock | null) => void
}): JSX.Element {
  const keys = useSecrets((s) => s.keys)
  const regions = useMemo(() => keyringRegions(keys), [keys])
  const start = kept?.region
  const [from, setFrom] = useState<From>(start?.from ?? (spot ? 'chest' : 'me'))
  const [height, setHeight] = useState(() => Math.min(SCAN_MAX_HEIGHT, Math.max(1, start?.height ?? chestHeight)))
  const [keyringId, setKeyringId] = useState(() => (start?.from === 'keyring' && start.lookupId ? start.lookupId : regions[0]?.lookupId ?? ''))
  // ME is where your avatar stood when you chose it, so walking does not move the lock.
  const [meAt, setMeAt] = useState<Position>(() => useCyberspace.getState().position)
  const [touched, setTouched] = useState(!kept)
  const [computed, setComputed] = useState<{ lookupId: string; base: Position; height: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const centre = from === 'chest' ? spot?.at ?? null : from === 'me' ? meAt : null
  const chosen = from === 'keyring' ? regions.find((k) => k.lookupId === keyringId) ?? null : null

  // The key of the region asked for: computed for THE CHEST or ME, read from the keyring otherwise.
  useEffect(() => {
    if (!touched) return
    setError(null)
    if (from === 'keyring') {
      setComputed(null)
      if (!chosen) { onLock(null); return }
      const lock = lockOfHex(chosen.keyHex)
      onLock(lock ? { pubkey: lock.pubkey, label: REGION_LOCK_LABEL, kind: 'region', region: { from, height: chosen.height, lookupId: chosen.lookupId } } : null)
      if (!lock) setError('This region has no lock. Pick another.')
      return
    }
    if (!centre) { setComputed(null); onLock(null); return }
    let on = true
    setBusy(true)
    onLock(null)
    regionKeyOffThread(centre, height, MAX_COMPUTE_HEIGHT).then(
      (rk) => {
        if (!on) return
        setBusy(false)
        const lock = lockOf(rk.key)
        if (!lock) { setError('This region has no lock. Pick another.'); onLock(null); return }
        setComputed({ lookupId: rk.lookupId, base: regionBase(centre, height), height })
        onLock({ pubkey: lock.pubkey, label: REGION_LOCK_LABEL, kind: 'region', region: { from, height, lookupId: rk.lookupId } })
      },
      (err: unknown) => { if (on) { setBusy(false); setError(err instanceof Error ? err.message : String(err)); onLock(null) } },
    )
    return () => { on = false }
    // onLock is the composer's setter; centre is read through from, meAt and spot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touched, from, height, keyringId, meAt, spot?.at.x, spot?.at.y, spot?.at.z, chosen?.keyHex])

  const pick = (f: From): void => {
    setTouched(true)
    setFrom(f)
    if (f === 'me') setMeAt(useCyberspace.getState().position)
  }
  const step = (d: number): void => { setTouched(true); setHeight((h) => Math.min(SCAN_MAX_HEIGHT, Math.max(1, h + d))) }

  // Which region the lock is now, for the warnings.
  const region = from === 'keyring'
    ? (chosen ? { lookupId: chosen.lookupId, base: baseOf(chosen.base, chosen.height), height: chosen.height } : null)
    : computed ? { lookupId: computed.lookupId, base: computed.base, height: computed.height } : null
  const holdsIt = !!(touched && spot && region?.base && inRoom(region.base, region.height, spot.at))
  const someoneKeeps = !!(region && keys[region.lookupId])

  return (
    <div className="lock__region">
      <div className="compose__row" role="radiogroup" aria-label="Region around">
        <button className={`chest__act ${from === 'chest' ? 'is-on' : ''}`} role="radio" aria-checked={from === 'chest'} disabled={!spot} onClick={() => pick('chest')} title={`The region around the ${noun}`}>{noun === 'door' ? 'THE DOOR' : 'THE CHEST'}</button>
        <button className={`chest__act ${from === 'me' ? 'is-on' : ''}`} role="radio" aria-checked={from === 'me'} onClick={() => pick('me')} title="The region around where you stand">ME</button>
        <button className={`chest__act ${from === 'keyring' ? 'is-on' : ''}`} role="radio" aria-checked={from === 'keyring'} disabled={regions.length === 0} onClick={() => pick('keyring')} title={regions.length === 0 ? 'No region keys on your keyring yet' : 'A region key on your keyring'}>KEYRING</button>
      </div>
      {from === 'keyring' ? (
        <select className="avatars__input compose__select" value={keyringId} onChange={(e) => { setTouched(true); setKeyringId(e.target.value) }} aria-label="Region key from your keyring">
          {regions.map((k) => <option key={k.lookupId} value={k.lookupId}>{`2^${k.height} · ${formatCellSize(k.height)} · ${formatAgo(k.at)}`}</option>)}
        </select>
      ) : (
        <div className="secrets__buy-row">
          <button className="secrets__step" disabled={height <= 1} onClick={() => step(-1)} aria-label="Smaller region">−</button>
          <span className="secrets__buy-size">2^{height} · {formatCellSize(height)}</span>
          <button className="secrets__step" disabled={height >= SCAN_MAX_HEIGHT} onClick={() => step(1)} aria-label="Larger region">+</button>
        </div>
      )}
      {!touched && kept && <span className="lock__note">sealed to {kept.label}</span>}
      {/* region_n has no plane bit (spec §4.7): one key, one lock, in both planes. */}
      <span className="lock__note">Same key in dataspace and ideaspace.</span>
      {busy && <span className="chest__status" role="status">COMPUTING</span>}
      {error && <span className="chest__status" role="status">{error}</span>}
      {holdsIt && <span className="chest__status" role="status">This region holds the {noun}. Whoever finds it can open it.</span>}
      {touched && region && !someoneKeeps && !holdsIt && <span className="chest__status" role="status">Nobody keeps this region’s key unless something is hidden there. Hide something there too, at this height.</span>}
    </div>
  )
}
