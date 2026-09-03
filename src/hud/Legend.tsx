/**
 * Legend.tsx — decodes the two visual encodings.
 */

import { boundaryColor, terrainColor } from '../lib/palette'
import { Explanation } from './Explanation'

const TERRAIN_SAMPLES = [0, 4, 6, 8, 10, 12, 14, 16]
const HEIGHT_SAMPLES = [5, 20, 40, 60, 80]

/** A faceted ball in outline, the avatar's wireframe seen small. */
const ball = (stroke: string): JSX.Element => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <g fill="none" stroke={stroke} strokeWidth="1.2" strokeLinejoin="round">
      <polygon points="10,1.5 17.5,5.75 17.5,14.25 10,18.5 2.5,14.25 2.5,5.75" />
      <path d="M10 1.5 L10 18.5 M2.5 5.75 L17.5 14.25 M17.5 5.75 L2.5 14.25" />
    </g>
  </svg>
)

/** The things drawn in the world that are not terrain: what each glyph is. */
const KEYS: Array<{ what: string; glyph: JSX.Element }> = [
  { what: 'Red dodecahedron: your avatar', glyph: ball('#ff2323') },
  { what: "White dodecahedron: another identity's avatar", glyph: ball('#ffffff') },
  {
    what: 'Yellow rotating cube: hyperjump station',
    glyph: (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <g fill="rgba(247, 147, 26, 0.18)" stroke="#f7931a" strokeWidth="1.2" strokeLinejoin="round">
          <path d="M10 2 L17 6 L17 14 L10 18 L3 14 L3 6 Z" />
          <path fill="none" d="M3 6 L10 10 L17 6 M10 10 L10 18" />
        </g>
      </svg>
    ),
  },
  {
    what: 'Purple ring: the Black Sun, the fixed bearing at +Z',
    glyph: (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" fill="rgba(146, 88, 209, 0.22)" stroke="#9258d1" strokeWidth="2.2" />
      </svg>
    ),
  },
  {
    what: 'Spawn point mesh: spawn point',
    glyph: (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <g fill="none" strokeWidth="1.2" strokeLinejoin="round">
          <polygon stroke="#ff7a90" points="10,1.5 17.5,5.75 17.5,14.25 10,18.5 2.5,14.25 2.5,5.75" />
          <rect stroke="#ff7a90" x="8" y="8" width="4" height="4" />
          <path stroke="#ff2323" d="M10 8 L10 4.5 M8.2 11.2 L5.2 13.2 M11.8 11.2 L14.8 13.2" />
          <path stroke="#c07dff" d="M8.2 8.8 L5.2 6.8 M11.8 8.8 L14.8 6.8 M10 12 L10 15.5" />
        </g>
      </svg>
    ),
  },
]

export function Legend(): JSX.Element {
  return (
    <section className="panel panel--legend">
      <header className="panel__head">
        <h2>Legend</h2>
      </header>

      <div className="legend__row">
        <span className="legend__label">Terrain K</span>
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

      <ul className="legend__keys">
        {KEYS.map((k) => (
          <li key={k.what} className="legend__key">
            <span className="legend__glyph">{k.glyph}</span>
            <span>{k.what}</span>
          </li>
        ))}
      </ul>

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
