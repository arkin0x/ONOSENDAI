/**
 * KeyFoundChip.tsx — the HUD half of the find ceremony.
 *
 * When a scan opens a bag, a chip rises in the instruments stack saying how
 * many were found here, with the last find's label resolving out of glyphs in
 * step with the scene. It has no clock: it stays until tapped, more finds
 * add to its count, and the tap opens the Nearby Loot list. Finds standing in a
 * room closed since (CLOSE) leave the count, and come back with OPEN; with
 * every find counted closed away, the chip waits unseen (store/useCeremony chipCount).
 * Its lines name the newest find still in the world (chipLine).
 */

import { useEffect, useState } from 'react'
import { decodeText, seedOf, TEXT_DECODE_MS } from '../lib/decode'
import { foundLabel } from '../lib/nearby'
import { chipCount, chipLine, useCeremony } from '../store/useCeremony'
import { useShards } from '../store/useShards'

export function KeyFoundChip(): JSX.Element | null {
  const chip = useCeremony((s) => s.chip)
  const [shown, setShown] = useState('')
  // The newest find still in the world (store/useCeremony chipLine): a close or an OPEN
  // changes the line at once, with no decode of its own, since chip.at is the last find's.
  const line = chipLine(chip)

  useEffect(() => {
    if (!chip || !line) return
    const seed = seedOf(chip.id)
    let frame = 0
    let raf = 0
    const tick = (): void => {
      frame++
      const t = (performance.now() - chip.at) / TEXT_DECODE_MS
      setShown(decodeText(line.label, t, seed, frame))
      if (t < 1) raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
    // `line` is derived from `chip`, so a new chip is a new line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chip])

  const count = chipCount(chip)
  if (!chip || !line || count <= 0) return null
  const open = (): void => { useCeremony.getState().dismiss(); useShards.getState().setNearbyOpen(true) }
  return (
    <div className="hyperbar hyperbar--found" role="status" onClick={open} title="Tap to see what was found here">
      <span className="hyperbar__glyph" aria-hidden="true">◈</span>
      <span className="hyperbar__text">
        <span className="hyperbar__label">{foundLabel(count)}</span>
        <span className="hyperbar__meta">{line.meta} · tap to see</span>
      </span>
      <span className="foundchip__decode">{shown}</span>
    </div>
  )
}
