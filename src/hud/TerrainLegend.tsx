/**
 * TerrainLegend.tsx — HUD component showing the terrain K color ramp.
 *
 * Displays a vertical gradient bar with labels for K values, helping users
 * understand which colors correspond to which terrain costs. K is Binomial(16, 0.5),
 * so most values cluster around 8, but the full range [0, 16] is shown.
 */

import { useMemo } from 'react'

const TERRAIN_STOPS: Array<[number, string]> = [
  [0, '#06111c'],
  [4, '#0b3550'],
  [6, '#0e5f7a'],
  [8, '#1c8f7a'],
  [10, '#8fbf3f'],
  [12, '#e8a33d'],
  [14, '#f2653c'],
  [16, '#ff2e6b'],
]

interface Props {
  className?: string
}

export function TerrainLegend({ className }: Props): JSX.Element {
  // Build CSS gradient from terrain stops.
  const gradientCSS = useMemo(() => {
    const stops = TERRAIN_STOPS.map(([k, color]) => {
      const percent = (k / 16) * 100
      return `${color} ${percent}%`
    })
    return `linear-gradient(to top, ${stops.join(', ')})`
  }, [])

  return (
    <div className={className} style={{
      position: 'absolute',
      right: '16px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '4px',
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      {/* Title */}
      <div style={{
        color: '#c8f5ff',
        fontSize: '11px',
        fontFamily: 'monospace',
        marginBottom: '4px',
        opacity: 0.8,
      }}>
        Terrain K
      </div>

      {/* Gradient bar with labels */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: '8px',
      }}>
        {/* Labels (right-aligned) */}
        <div style={{
          display: 'flex',
          flexDirection: 'column-reverse',
          justifyContent: 'space-between',
          height: '160px',
          color: '#c8f5ff',
          fontSize: '10px',
          fontFamily: 'monospace',
          opacity: 0.7,
        }}>
          {TERRAIN_STOPS.map(([k]) => (
            <div key={k} style={{ textAlign: 'right', lineHeight: '1' }}>
              {k}
            </div>
          ))}
        </div>

        {/* Gradient bar */}
        <div style={{
          width: '12px',
          height: '160px',
          background: gradientCSS,
          border: '1px solid rgba(200, 245, 255, 0.2)',
          borderRadius: '2px',
        }} />
      </div>

      {/* Cost hint */}
      <div style={{
        color: '#c8f5ff',
        fontSize: '9px',
        fontFamily: 'monospace',
        opacity: 0.5,
        marginTop: '4px',
        textAlign: 'right',
        maxWidth: '80px',
      }}>
        Higher K = more expensive terrain
      </div>
    </div>
  )
}
