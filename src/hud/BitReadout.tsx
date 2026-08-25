/**
 * BitReadout.tsx: what the pending move costs, drawn as a shape instead of a
 * number.
 *
 * Every other cost readout in this HUD is a figure you have to take on trust.
 * This one shows the reason: twenty bits of the avatar's coordinate, the same
 * twenty bits of the target's, and their XOR, per axis. The leading run of
 * zeroes is the prefix the two share, the highest set bit is the wall being
 * crossed, and h is that bit's index plus one. Nudge the target one gibson
 * across a power of two and you watch the wall jump up the column while the
 * distance on screen does not change at all.
 *
 * It rides on the scene rather than sitting in a panel, because it is an
 * instrument you read while driving, not a fact you look up. That is also why
 * it survives the hamburger: hiding the panels to see the space should not take
 * away the one readout that explains what the space costs.
 *
 * Columns follow the screen axes, so the first column is the one W and D drive,
 * but each is labelled with its cyberspace letter because Shift+WASD reshuffles
 * that order. Whether those columns sit side by side or stack is a question of
 * room, so the stylesheet owns it; the markup is the same either way.
 *
 * Its own heading is the button that folds it away, the way tapping the compass
 * is what opens the view menu. A separate chip elsewhere would be one more thing
 * floating on the scene, and it would have to explain which block it belonged to.
 * It is dressed as the same chip as CONTROLS, because it is the same kind of
 * thing: a floating handle that brings an instrument back.
 */

import { useState } from 'react'
import { WINDOW_BITS, xorReadout } from '../lib/bits'
import { useCyberspace } from '../store/useCyberspace'

/** The row labels, which double as the palette hook for each row's tone. */
type Tone = 'pos' | 'trg' | 'xor'

/** An out-of-frame marker: one cell wide always, lit only when it means something. */
function Slot({ on = false }: { on?: boolean }): JSX.Element {
  return <span className={on ? 'bits__edge bits__edge--set' : 'bits__edge'}>{'…'}</span>
}

/**
 * One line of a column.
 *
 * Both out-of-frame slots are rendered on every row, not just the XOR row, so
 * that lighting one up cannot shift the bits sideways: a column you cannot read
 * straight down is worse than no column. The row label is drawn per column and
 * hidden by CSS wherever the columns sit abreast, which is what lets the same
 * markup stack on a phone, where each column needs its own labels back.
 */
function Row({
  tone,
  bits,
  above = false,
  below = false,
}: {
  tone: Tone
  bits: JSX.Element | string
  above?: boolean
  below?: boolean
}): JSX.Element {
  return (
    <div className={`bits__row--${tone}`}>
      <span className="bits__key">{`${tone} `}</span>
      <Slot on={above} />
      {bits}
      <Slot on={below} />
    </div>
  )
}

/** The WINDOW_BITS-wide binary string as right-padded hex, MSB first. */
function toHex(binary: string): string {
  const width = Math.ceil(binary.length / 4)
  return (parseInt(binary || '0', 2) >>> 0).toString(16).padStart(width, '0')
}

export function BitReadout(): JSX.Element {
  // Open by default: it is the readout that explains what everything else on
  // screen costs, so it has to be seen before anyone would think to dismiss it.
  // Closed by default: screen space in the instrument stack is contested,
  // and the readout is a thing you open when you want it, not a landlord.
  const [open, setOpen] = useState(false)
  // The window can be read as binary, where the wall is a shape, or as hex,
  // where it is compact. Tapping the open grid flips between them.
  const [hex, setHex] = useState(false)
  // At the head: you and the cursor. In history: the hop into the action
  // shown, so scrubbing the chain reads each crossing's cost off the bits.
  const [from, to] = useCyberspace((s) => s.readoutPair())
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const axes = useCyberspace((s) => s.axes())
  const columns = xorReadout(from, to, axes, scaleExp)

  return (
    <div className="bits">
      <button
        className="chip bits__toggle"
        onContextMenu={(e) => e.preventDefault()}
        /* pointerdown, swallowed, which is how the controls chip does it: a tap
           here must not also reach the canvas and toggle the pad. */
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v) }}
        aria-label={open ? 'Hide XOR readout' : 'Show XOR readout'}
        aria-pressed={open}
      >
        XOR {hex ? 'HEX' : 'BITS'}{open ? ` ${scaleExp}..${scaleExp + WINDOW_BITS - 1}` : ''}
      </button>

      {open && (
        <div
          className="bits__grid"
          title={hex ? 'Tap for binary' : 'Tap for hex'}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setHex((v) => !v) }}
        >
          {columns.map((c) => (
            <div className="bits__col" key={c.axis}>
              {/* The heading carries the same two lead-ins as the rows below it,
                  empty, so the axis letter sits over its own first bit instead
                  of floating a cell to the left of the column. */}
              <div className="bits__head">
                <span className="bits__key">{'    '}</span>
                {!hex && <Slot />}
                {c.axis.toUpperCase()} h={c.height}
              </div>
              {hex ? (
                <>
                  <div className="bits__row--pos"><span className="bits__key">{'pos '}</span>{toHex(c.avatar)}</div>
                  <div className="bits__row--trg"><span className="bits__key">{'trg '}</span>{toHex(c.cursor)}</div>
                  <div className="bits__row--xor"><span className="bits__key">{'xor '}</span>{toHex(c.xor)}</div>
                </>
              ) : (
                <>
                  <Row tone="pos" bits={c.avatar} />
                  <Row tone="trg" bits={c.cursor} />
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
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
