/**
 * ShareLine.tsx - the bag's line about sharing your blocks (store/terrainShare.ts):
 * saved on this device, sharing, or shared, in plain words, and RETIRE for
 * this device's building key (DECK-0009 §4.3), asked twice.
 */

import { useEffect, useState } from 'react'
import { Cloud, CloudUpload, HardDrive } from 'lucide-react'
import { retireDeviceKey, useShare } from '../store/terrainShare'

/** How long the second tap of RETIRE is waited for, ms. */
const CONFIRM_MS = 4000

export function ShareLine(): JSX.Element {
  const { state, words } = useShare()
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!asking) return
    const t = window.setTimeout(() => setAsking(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [asking])
  const Icon = state === 'shared' ? Cloud : state === 'sharing' ? CloudUpload : HardDrive
  const retire = (): void => {
    if (!asking) { setAsking(true); return }
    setAsking(false)
    retireDeviceKey()
  }
  return (
    <p className="terrain-sheet__foot" data-share={state} role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Icon size={13} strokeWidth={2} aria-hidden />
      <span>{words}</span>
      <button
        type="button"
        className="terrain-key"
        onClick={retire}
        style={{ marginLeft: 'auto', cursor: 'pointer', background: 'transparent' }}
        title="Retire this device's building key: from your next move, what it writes stops counting as yours, and a new key takes over here"
        aria-label={asking ? 'Tap again to retire this device\'s building key' : 'Retire this device\'s building key'}
      >
        {asking ? 'TAP AGAIN TO RETIRE' : 'RETIRE KEY'}
      </button>
    </p>
  )
}
