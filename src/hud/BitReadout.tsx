/**
 * BitReadout.tsx: what the pending move costs, drawn as a shape instead of a
 * number.
 *
 * Every other cost readout in this HUD is a figure you have to take on trust.
 * This one shows the reason: twenty bits of the avatar's coordinate, the same
 * twenty bits of the cursor's, and their XOR, per axis. The leading run of
 * zeroes is the prefix the two share, the highest set bit is the wall being
 * crossed, and h is that bit's index plus one. Nudge the cursor one gibson
 * across a power of two and you watch the wall jump up the column while the
 * distance on screen does not change at all.
 *
 * It rides on the scene rather than sitting in a panel, because it is an
 * instrument you read while driving, not a fact you look up. That is also why
 * it survives the hamburger: hiding the panels to see the space should not take
 * away the one readout that explains what the space costs.
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
  tone,
  bits,
  above = false,
  below = false,
}: {
  tone: 'pos' | 'cur' | 'xor'
  bits: JSX.Element | string
  above?: boolean
  below?: boolean
}): JSX.Element {
  const slot = (on: boolean): JSX.Element => (
    <span className={on ? 'bits__edge bits__edge--set' : 'bits__edge'}>{'…'}</span>
  )
  return (
    <div className={`bits__row--${tone}`}>
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
    <div className="bits">
      <div className="bits__title">
        XOR BITS {scaleExp}..{scaleExp + WINDOW_BITS - 1}
      </div>

      <div className="bits__grid">
        <div className="bits__col">
          <div className="bits__head">{' '}</div>
          <div className="bits__row--pos">pos</div>
          <div className="bits__row--cur">cur</div>
          <div className="bits__row--xor">xor</div>
          <div className="bits__head">{' '}</div>
        </div>

        {columns.map((c) => (
          <div className="bits__col" key={c.axis}>
            <div className="bits__head">{c.axis.toUpperCase()}</div>
            <Row tone="pos" bits={c.avatar} />
            <Row tone="cur" bits={c.cursor} />
            <Row
              tone="xor"
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
    </div>
  )
}
