/**
 * KeyFoundChip.tsx — the HUD half of the find ceremony.
 *
 * When a scan opens a bag, a chip rises in the instruments stack saying how
 * many were found here, with the last find's label resolving out of glyphs in
 * step with the scene. It has no clock: it stays until tapped, more finds
 * add to its count, and the tap opens the Nearby Loot list.
 */

import { useEffect, useState } from 'react'
import { decodeText, seedOf, TEXT_DECODE_MS } from '../lib/decode'
import { foundLabel } from '../lib/nearby'
import { useCeremony } from '../store/useCeremony'
import { useShards } from '../store/useShards'

export function KeyFoundChip(): JSX.Element | null {
  const chip = useCeremony((s) => s.chip)
  const [shown, setShown] = useState('')

  useEffect(() => {
    if (!chip) return
    const seed = seedOf(chip.id)
    let frame = 0
    let raf = 0
    const tick = (): void => {
      frame++
      const t = (performance.now() - chip.at) / TEXT_DECODE_MS
      setShown(decodeText(chip.label, t, seed, frame))
      if (t < 1) raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [chip])

  if (!chip) return null
  const open = (): void => { useCeremony.getState().dismiss(); useShards.getState().setNearbyOpen(true) }
  return (
    <div className="hyperbar hyperbar--found" role="status" onClick={open} title="Tap to see what was found here">
      <span className="hyperbar__glyph" aria-hidden="true">◈</span>
      <span className="hyperbar__text">
        <span className="hyperbar__label">{foundLabel(chip.count)}</span>
        <span className="hyperbar__meta">{chip.meta} · tap to see</span>
      </span>
      <span className="foundchip__decode">{shown}</span>
    </div>
  )
}
