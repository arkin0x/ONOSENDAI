/**
 * RegionChip.tsx - region mode's readout, top left (store/useRegion.ts).
 *
 * Open the moment the Region button turns region mode on. It shows the prefix
 * the selection fixes, tap it to copy, and carries a link to reserve that
 * region as a private speakeasy on the relay. Nothing here signs or pays.
 */

import { useState } from 'react'
import { Copy, Scan } from 'lucide-react'
import { useRegion } from '../store/useRegion'

const RELAY = 'https://relay.onosendai.tech/C/'

export function RegionChip(): JSX.Element | null {
  const active = useRegion((s) => s.active)
  const prefix = useRegion((s) => s.prefix)
  const [copied, setCopied] = useState(false)
  if (!active) return null

  const copy = (): void => {
    if (!prefix) return
    navigator.clipboard?.writeText(prefix).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1200) },
      () => { /* a copy that fails leaves the coordinate on screen to select */ },
    )
  }

  return (
    <div className="regionchip" role="status">
      <div className="regionchip__head">
        <Scan size={13} strokeWidth={2.25} aria-hidden />
        <span className="regionchip__title">REGION</span>
      </div>
      {prefix ? (
        <>
          <button className="regionchip__coord" onClick={copy} title="Copy this region coordinate">
            <span className="regionchip__hex">C/{prefix}</span>
            <Copy size={12} strokeWidth={2.25} aria-hidden />
          </button>
          <span className="regionchip__note">{copied ? 'Copied' : `${prefix.length} hex`}</span>
          <a className="regionchip__reserve" href={`${RELAY}${prefix}`} target="_blank" rel="noreferrer">
            Reserve this region for a private speakeasy
          </a>
        </>
      ) : (
        <span className="regionchip__note">Move or zoom to a valid region</span>
      )}
    </div>
  )
}
