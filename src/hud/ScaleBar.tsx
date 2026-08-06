/**
 * ScaleBar.tsx — integrated scale indicator on the left edge of the viewport.
 *
 * A thin vertical line whose pixel height matches one tile on screen, with
 * the physical measurement and verbose unit name beside it. No panel chrome;
 * it lives directly on the grid edge so it reads as part of the interface.
 *
 * The spec defines 2^33 Gibsons = 1 meter (§9.2, §9.7).
 */

import { useEffect, useMemo, useState } from 'react'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'

/** Gibson size in meters: 2^-33 ≈ 1.16e-10 m (hydrogen atom diameter). */
const GIBSON_METERS = 2 ** -33

/** Grid span in world units: the camera zoom divides the viewport by this. */
const GRID_SPAN = GRID_RADIUS * 2 + 2

interface UnitEntry {
  threshold: number
  symbol: string
  name: string
  scale: number
}

const UNITS: UnitEntry[] = [
  { threshold: 1e-9, symbol: 'pm', name: 'picometers', scale: 1e12 },
  { threshold: 1e-6, symbol: 'nm', name: 'nanometers', scale: 1e9 },
  { threshold: 1e-3, symbol: 'μm', name: 'micrometers', scale: 1e6 },
  { threshold: 1e-2, symbol: 'mm', name: 'millimeters', scale: 1e3 },
  { threshold: 1e-1, symbol: 'cm', name: 'centimeters', scale: 1e2 },
  { threshold: 1e3, symbol: 'm', name: 'meters', scale: 1 },
  { threshold: 1e6, symbol: 'km', name: 'kilometers', scale: 1e-3 },
  { threshold: 1e9, symbol: 'Mm', name: 'megameters', scale: 1e-6 },
  { threshold: 1.496e11, symbol: 'AU', name: 'astronomical units', scale: 1 / 1.496e11 },
]

function formatSize(meters: number): { value: number; symbol: string; name: string } {
  for (let i = 0; i < UNITS.length; i++) {
    const { threshold, symbol, name, scale } = UNITS[i]
    if (meters < threshold || i === UNITS.length - 1) {
      const value = parseFloat((meters * scale).toPrecision(3))
      return { value, symbol, name }
    }
  }
  return { value: meters, symbol: 'm', name: 'meters' }
}

function useViewportMin(): number {
  const [min, setMin] = useState(() => Math.min(window.innerWidth, window.innerHeight))

  useEffect(() => {
    const onResize = () => setMin(Math.min(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return min
}

export function ScaleBar(): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const viewportMin = useViewportMin()

  /** Pixel height of one tile on screen. The orthographic camera zooms so
   *  that GRID_SPAN world units fill the smaller viewport dimension. */
  const tilePixels = viewportMin / GRID_SPAN

  const { value, symbol, name } = useMemo(() => {
    const gibsons = 2 ** scaleExp
    const meters = gibsons * GIBSON_METERS
    return formatSize(meters)
  }, [scaleExp])

  return (
    <div className="scale-bar" aria-label="Scale indicator">
      <div className="scale-bar__ruler" style={{ height: `${tilePixels}px` }}>
        <div className="scale-bar__tick scale-bar__tick--top" />
        <div className="scale-bar__line" />
        <div className="scale-bar__tick scale-bar__tick--bottom" />
      </div>
      <div className="scale-bar__text">
        <span className="scale-bar__value">{value} {symbol}</span>
        <span className="scale-bar__name">{name}</span>
      </div>
    </div>
  )
}
