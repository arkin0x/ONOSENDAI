/**
 * Legend.tsx — decodes the two visual encodings.
 */

import { boundaryIntensity, terrainColor } from '../lib/palette'
import { useCyberspace } from '../store/useCyberspace'

const K_SAMPLES = [2, 4, 6, 8, 10, 12, 14, 16]

export function Legend(): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const floor = scaleExp + 1
  const excessSamples = [0, 2, 4, 6, 8, 10]

  return (
    <section className="panel panel--legend">
      <header className="panel__head">
        <h2>Legend</h2>
      </header>

      <div className="legend__row">
        <span className="legend__label">Terrain K (cell fill)</span>
        <div className="swatches">
          {K_SAMPLES.map((k) => (
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
        <span className="legend__label">LCA boundary (grid line)</span>
        <div className="swatches">
          {excessSamples.map((excess) => (
            <span
              key={excess}
              className="swatch swatch--line"
              style={{ opacity: boundaryIntensity(floor + excess, floor) }}
              title={`height ${floor + excess}`}
            />
          ))}
        </div>
        <span className="legend__ends">
          <em>h{floor}</em>
          <em>h{floor + 10}</em>
        </span>
      </div>

      <p className="legend__note">
        A bright line is a costly crossing. Cost tracks which power-of-two
        boundary you cross, not how far you travel.
      </p>
    </section>
  )
}
