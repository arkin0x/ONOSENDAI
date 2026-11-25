/**
 * ShareLine.tsx - the bag's part about sharing your blocks
 * (store/terrainShare.ts): saved on this device, sharing, or shared, in
 * plain words, and RETIRE for this device's building key, asked twice. The
 * Crew under it is CrewPanel.tsx.
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
    <p className="terrain-sheet__foot terrain-share" data-share={state} role="status">
      <Icon size={13} strokeWidth={2} aria-hidden />
      <span className="terrain-share__words">{words}</span>
      <button
        type="button"
        className={`crew-btn${asking ? ' crew-btn--danger' : ''}`}
        onClick={retire}
        title="Retire this device's building key: what it signed stops counting, and your blocks go out again under a new key"
        aria-label={asking ? 'Tap again to retire this device\'s building key' : 'Retire this device\'s building key'}
      >
        {asking ? 'TAP AGAIN TO RETIRE' : 'RETIRE KEY'}
      </button>
    </p>
  )
}
