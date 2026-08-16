/**
 * ScaleLadder.tsx — the whole scale range, with the places you know marked on it.
 *
 * Q and E move an exponent. The exponent runs 0 to 84 and spans a hydrogen atom
 * to half a light-year, and until now the only clue to where on that you were
 * standing was a text reading like "524 km". Which is accurate, and tells you
 * nothing about the trip: how much further out Earth is, how far below you the
 * human scale sits, whether you are near either end.
 *
 * So the range is drawn once with its landmarks fixed on it and the current zoom
 * riding it. The landmarks are not decoration; each is a consequence of the
 * spec's one anchor, Cantor height 34 = 2 metres (§9.2), which makes a gibson
 * 2^-33 m. Everything else follows by arithmetic, including the one that
 * surprises people: a sector is 2^30 gibsons, which is 12.5 cm.
 */

import { MAX_SCALE_EXP } from '../lib/space'
import { formatCellSize } from '../lib/scale'
import { useCyberspace } from '../store/useCyberspace'

/**
 * Heights worth naming, in ascending order.
 *
 * Earth is fractional because its diameter is not a power of two: 12,742 km is
 * 2^56.6 gibsons. Marking it at 56.6 rather than rounding keeps the ladder
 * honest about the fact that physical objects do not land on binary boundaries.
 */
const LANDMARKS: Array<{ h: number; name: string }> = [
  { h: 0, name: 'gibson' },
  { h: 30, name: 'sector' },
  { h: 34, name: 'human' },
  { h: 43, name: 'kilometre' },
  { h: 56.6, name: 'Earth' },
  { h: MAX_SCALE_EXP + 1, name: 'axis' },
]

const TOP = MAX_SCALE_EXP + 1

export function ScaleLadder(): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const pct = (h: number): number => (h / TOP) * 100

  return (
    <div className="ladder">
      <div className="ladder__rail">
        {LANDMARKS.map((l) => (
          <span key={l.name} className="ladder__tick" style={{ bottom: `${pct(l.h)}%` }}>
            <span className="ladder__tick-line" />
            <span className="ladder__tick-name">{l.name}</span>
          </span>
        ))}
        <span className="ladder__here" style={{ bottom: `${pct(scaleExp)}%` }}>
          <span className="ladder__here-dot" />
          <span className="ladder__here-text">{formatCellSize(scaleExp)}</span>
        </span>
      </div>
    </div>
  )
}
