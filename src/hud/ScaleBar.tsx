/**
 * ScaleBar.tsx — vertical scale indicator along the grid edge.
 *
 * Displays the physical size of one tile at the current scale exponent.
 * The spec defines 2^33 Gibsons = 1 meter (§9.2, §9.7), so this component
 * converts scale exponent to human-readable units (pm through AU).
 *
 * Renders as a vertical bar with tick marks showing subdivisions, positioned
 * along the right edge of the viewport. Re-renders dynamically on zoom.
 */

import { useMemo } from 'react'
import { useCyberspace } from '../store/useCyberspace'

/**
 * Gibson size in meters: 2^-33 ≈ 1.16e-10 m (hydrogen atom diameter).
 */
const GIBSON_METERS = 2 ** -33

/**
 * Unit thresholds and labels for automatic unit selection.
 */
const UNITS = [
  { threshold: 1e-9, label: 'pm', scale: 1e12 },
  { threshold: 1e-6, label: 'nm', scale: 1e9 },
  { threshold: 1e-3, label: 'μm', scale: 1e6 },
  { threshold: 1e-2, label: 'mm', scale: 1e3 },
  { threshold: 1e-1, label: 'cm', scale: 1e2 },
  { threshold: 1e3, label: 'm', scale: 1 },
  { threshold: 1e6, label: 'km', scale: 1e-3 },
  { threshold: 1e9, label: 'Mm', scale: 1e-6 },
  { threshold: 1.496e11, label: 'AU', scale: 1 / 1.496e11 },
]

/**
 * Convert meters to the most appropriate unit.
 */
function formatSize(meters: number): { value: number; unit: string } {
  for (let i = 0; i < UNITS.length; i++) {
    const { threshold, label, scale } = UNITS[i]
    if (meters < threshold || i === UNITS.length - 1) {
      const value = meters * scale
      return { value: parseFloat(value.toPrecision(3)), unit: label }
    }
  }
  // Fallback (should never reach here)
  return { value: meters, unit: 'm' }
}

export function ScaleBar(): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const { size, label } = useMemo(() => {
    // One tile at scaleExp represents 2^scaleExp Gibsons
    const gibsons = 2 ** scaleExp
    const meters = gibsons * GIBSON_METERS
    const formatted = formatSize(meters)
    return {
      size: `${formatted.value} ${formatted.unit}`,
      label: `1 tile`,
    }
  }, [scaleExp])

  return (
    <div className="scale-bar">
      <div className="scale-bar__tick" />
      <div className="scale-bar__body">
        <div className="scale-bar__size">{size}</div>
        <div className="scale-bar__label">{label}</div>
      </div>
      <div className="scale-bar__tick" />
    </div>
  )
}
