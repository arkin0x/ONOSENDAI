/**
 * Legend.tsx — decodes the two visual encodings.
 */

import { boundaryColor, terrainColor } from '../lib/palette'
import { useCyberspace } from '../store/useCyberspace'

const TERRAIN_SAMPLES = [0, 4, 6, 8, 10, 12, 14, 16]
const HEIGHT_SAMPLES = [5, 20, 40, 60, 80]

export function Legend(): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)

  return (
    <section className="panel panel--legend">
      <header className="panel__head">
        <h2>Legend</h2>
      </header>

      <div className="legend__row">
        <span className="legend__label">Terrain K (cell fill)</span>
        <div className="swatches">
          {TERRAIN_SAMPLES.map((k) => (
            <span
              key={k}
              className="swatch"
              style={{ background: `#${terrainColor(k).getHexString()}` }}
              title={`K = ${k}`}
            />
          ))}
        </div>
        <span className="legend__ends">
          <em>cheap</em>
          <em>costly</em>
        </span>
      </div>

      <div className="legend__row">
        <span className="legend__label">Crossing cost (commit flash)</span>
        <div className="swatches">
          {HEIGHT_SAMPLES.map((height) => (
            <span
              key={height}
              className="swatch swatch--line"
              style={{ background: `#${boundaryColor(height).getHexString()}` }}
              title={`height ${height}`}
            />
          ))}
        </div>
        <span className="legend__ends">
          <em>low</em>
          <em>high</em>
        </span>
      </div>

      <p className="legend__note">
        Committing flashes the region the proof covered, striking white and
        settling into its cost colour. Height is the power-of-two boundary you
        cross, not how far you travel. The indigo grid is the subtree lattice and
        the cyan box is the move you are lining up. Current scale: {scaleExp}.
      </p>
    </section>
  )
}
