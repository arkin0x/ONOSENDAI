/**
 * KeyFoundChip.tsx — the HUD half of the find ceremony.
 *
 * When a scan opens a bag, a chip rises in the instruments stack: KEY FOUND,
 * the region's size and the item count, and the found item's label resolving
 * out of glyphs in step with the scene. It stays a few seconds or until tapped.
 */

import { useEffect, useState } from 'react'
import { CHIP_MS, decodeText, seedOf, TEXT_DECODE_MS } from '../lib/decode'
import { useCeremony } from '../store/useCeremony'

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
    const timer = window.setTimeout(() => useCeremony.getState().dismiss(), CHIP_MS)
    return () => { window.cancelAnimationFrame(raf); window.clearTimeout(timer) }
  }, [chip])

  if (!chip) return null
  return (
    <div className="hyperbar hyperbar--found" role="status" onClick={() => useCeremony.getState().dismiss()}>
      <span className="hyperbar__glyph" aria-hidden="true">◈</span>
      <span className="hyperbar__text">
        <span className="hyperbar__label">KEY FOUND</span>
        <span className="hyperbar__meta">{chip.meta}</span>
      </span>
      <span className="foundchip__decode">{shown}</span>
    </div>
  )
}
