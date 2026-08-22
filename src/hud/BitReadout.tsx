/**
 * BitReadout.tsx: what the pending move costs, drawn as a shape instead of a
 * number.
 *
 * Every other cost readout in this HUD is a figure you have to take on trust.
 * This one shows the reason: three bits of the avatar's coordinate, the same
 * three bits of the cursor's, and their XOR, per axis. The leading run of
 * zeroes is the prefix the two share, the highest set bit is the wall being
 * crossed, and h is that bit's index plus one. Nudge the cursor one gibson
 * across a power of two and you watch the wall jump up the column while the
 * distance on screen does not change at all.
 *
 * Columns follow the screen axes, so the leftmost column is the one W and D
 * drive, but each is labelled with its cyberspace letter because Shift+WASD
 * reshuffles that order.
 */

import { WINDOW_BITS, xorReadout } from '../lib/bits'
import { useCyberspace } from '../store/useCyberspace'

/**
 * One line of a column.
 *
 * The two out-of-frame slots are rendered on every row, not just the XOR row,
 * so that lighting one up cannot shift the bits sideways: a column you cannot
 * read straight down is worse than no column.
 */
function Row({
  bits,
  above = false,
  below = false,
}: {
  bits: JSX.Element | string
  above?: boolean
  below?: boolean
}): JSX.Element {
  const slot = (on: boolean): JSX.Element => (
    <span className={on ? 'bits__edge bits__edge--set' : 'bits__edge'}>{'…'}</span>
  )
  return (
    <div>
      {slot(above)}
      {bits}
      {slot(below)}
    </div>
  )
}

export function BitReadout(): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const axes = useCyberspace((s) => s.axes())
  const columns = xorReadout(position, cursor, axes, scaleExp)

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>XOR readout</h2>
        <span className="tag">
          BITS {scaleExp}..{scaleExp + WINDOW_BITS - 1}
        </span>
      </header>

      <div className="bits">
        <div className="bits__col">
          <div className="bits__head">{' '}</div>
          <div>pos</div>
          <div>cur</div>
          <div>xor</div>
          <div className="bits__head">{' '}</div>
        </div>

        {columns.map((c) => (
          <div className="bits__col" key={c.axis}>
            <div className="bits__head">{c.axis.toUpperCase()}</div>
            <Row bits={c.avatar} />
            <Row bits={c.cursor} />
            <Row
              above={c.hiddenAbove}
              below={c.hiddenBelow}
              bits={
                <>
                  <span className="bits__matched">{c.matched}</span>
                  <span className="bits__wall">{c.wall}</span>
                  {c.rest}
                </>
              }
            />
            <div className="bits__head">h={c.height}</div>
          </div>
        ))}
      </div>

      <p className="legend__note">
        Window low bit sits at the current scale, because the cursor only moves
        in steps of 2^{scaleExp}. Dim zeroes are the shared prefix; the bright
        bit is the wall, costing 2^h - 1 pairings to cross. A lit ellipsis means
        the coordinates also differ off the right (below this scale) or off the
        left (above the {WINDOW_BITS}-bit compute ceiling, so a sidestep).
      </p>
    </section>
  )
}
