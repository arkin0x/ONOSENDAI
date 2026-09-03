/**
 * Legend.tsx — decodes the two visual encodings.
 */

import { boundaryColor, terrainColor } from '../lib/palette'
import { Explanation } from './Explanation'

const TERRAIN_SAMPLES = [0, 4, 6, 8, 10, 12, 14, 16]
const HEIGHT_SAMPLES = [5, 20, 40, 60, 80]

export function Legend(): JSX.Element {
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
        <span className="legend__label">Cube grid - region cost</span>
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

      <Explanation>
        Cyberspace is not flat. A terrain function required for movement proofs
        imposes hills and valleys on the geography of cyberspace, represented by
        the colorful point cloud surrounding your avatar. The terrain K value is
        the difficulty to move to each point. The cubic grids represent the
        power-of-2 regions you are currently within. Leaving a region is when the
        cost of movement jumps the most; depending on the alignment of the region,
        the cost may be impossibly high, requiring either cloud compute or a trip
        through hyperspace.
      </Explanation>
    </section>
  )
}
