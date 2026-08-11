/**
 * ScaleBar.tsx — integrated scale indicator on the left edge of the grid.
 *
 * An isometric cube drawn at exactly the on-screen size of one cell, with the
 * physical measurement beside it, so the reading is legible as "this cube is
 * 1.91 micrometers" rather than as an abstract bracket. It is the same shape and
 * colour as the cursor cube deliberately: the instrument and the thing it
 * measures should be recognisably the same object.
 *
 * Its size comes from `--cell-px`, published each frame by the scene, because
 * under a perspective camera a cell's screen size is the projection scale over
 * the orbit distance and changes as you dolly. The previous version derived it
 * from the orthographic zoom, which no longer exists, so it was reporting a
 * scale the view had stopped using.
 *
 * The spec defines 2^33 Gibsons = 1 meter (§9.2, §9.7).
 */

import { useMemo } from 'react'
import { useCyberspace } from '../store/useCyberspace'

/** Gibson size in meters: 2^-33 ≈ 1.16e-10 m (hydrogen atom diameter). */
const GIBSON_METERS = 2 ** -33

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

export function ScaleBar(): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const { value, symbol, name } = useMemo(() => {
    const gibsons = 2 ** scaleExp
    const meters = gibsons * GIBSON_METERS
    return formatSize(meters)
  }, [scaleExp])

  return (
    <div className="scale-bar" aria-label="Scale indicator">
      <IsoCube />
      <div className="scale-bar__text">
        <span className="scale-bar__value">{value} {symbol}</span>
        <span className="scale-bar__name">{name}</span>
      </div>
    </div>
  )
}

/**
 * A wireframe cube in isometric projection: hexagonal silhouette with three
 * edges meeting at the vertex nearest the viewer. Sized from `--cell-px` so it
 * matches the cursor cube exactly, at any orbit distance.
 */
function IsoCube(): JSX.Element {
  return (
    <svg className="scale-bar__cube" viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="50,4 94,29 94,71 50,96 6,71 6,29" />
      <path d="M50,50 L50,96 M50,50 L6,29 M50,50 L94,29" />
    </svg>
  )
}
