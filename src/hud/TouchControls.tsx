/**
 * TouchControls.tsx — cyberspace operations for touch, as an overlay.
 *
 * The camera is untouched: OrbitControls already handles touch on the canvas,
 * and orbiting is the one thing that already worked on a phone. What was
 * missing is everything else, because every other control was a key. Without
 * these you can look around a phone screen and do nothing at all.
 *
 * These are DOM buttons sitting above the canvas, so a press here never reaches
 * OrbitControls and a drag on open space still orbits. `touch-action: none`
 * stops the browser treating a press as a scroll or a double-tap zoom.
 *
 * Directions resolve through `moveDirection` against the axes currently on
 * screen, exactly as the keyboard does, so the pad obeys a free orbit the same
 * way WASD does and the two can never disagree about which way is up.
 */

import { useCyberspace } from '../store/useCyberspace'
import { moveDirection, type MoveName } from '../lib/moves'
import { MAX_SCALE_EXP } from '../lib/space'
import { useShards } from '../store/useShards'
import { useUiHints } from '../store/useUiHints'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'

export function TouchControls(): JSX.Element {
  const proof = useCyberspace((s) => s.proof)
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const live = useCyberspace((s) => s.live)
  const deploying = useShards((s) => s.pending !== null)
  const bind = useRepeatable()
  // The scene's covering box reports when the region it draws is a clipped
  // stand-in; the zoom-out key is the remedy, so it echoes that (useUiHints).
  const coveringClipped = useUiHints((s) => s.coveringClipped)
  // Off your own head there is nothing to drive: spectating, viewing a block
  // and viewing Earth all anchor the scene somewhere that is not you. The six
  // directions and the commit row stand down, but scale still decides how much
  // of the line the field draws and which regime owns the frame, so the pad
  // stays, at its own size and in its own place, with those cells emptied.
  // Hiding the whole pad instead left EARTH opening at 2^52 with no way down.
  const atHead = useCyberspace((s) => s.atHead())

  const computing = proof.status === 'computing'
  const armed = !(position.x === cursor.x && position.y === cursor.y && position.z === cursor.z)

  const move = (name: MoveName) => () => {
    const s = useCyberspace.getState()
    s.moveCursor(moveDirection(s.screenAxes ?? s.axes(), name))
  }
  const scale = (delta: number) => () => useCyberspace.getState().adjustScale(delta)

  // Six directions plus the two scale steps: exactly nine things, which is
  // exactly how many cells a 3x3 pad has.
  const pad: Array<{
    cell: string; glyph: string; sub?: string; title: string
    act: () => void; disabled?: boolean; hint?: boolean; scale?: boolean
  }> = [
    // The physics convention for a vector through the page: a tail seen from
    // behind going in, an arrow tip seen head-on coming out. It is the right
    // symbol and it is not enough on its own, because the two differ only by a
    // small mark inside the circle and that mark is the first thing to go at
    // this size. The word carries the meaning; the glyph carries the convention.
    { cell: 'away', glyph: '⊗', sub: 'FAR', title: 'Away from camera (R)', act: move('away') },
    { cell: 'up', glyph: '▲', title: 'Up (W)', act: move('up') },
    { cell: 'toward', glyph: '⊙', sub: 'NEAR', title: 'Toward camera (F)', act: move('toward') },
    { cell: 'left', glyph: '◀', title: 'Left (A)', act: move('left') },
    { cell: 'right', glyph: '▶', title: 'Right (D)', act: move('right') },
    // Left is Q and right is E, matching where those keys sit on a keyboard.
    // Q raises the exponent and E lowers it, so the left button is the plus.
    // Putting the minus on the left made the pad and the keys disagree about
    // which way out is.
    //
    // adjustScale already clamps, but a key that silently does nothing reads as
    // broken rather than as the end of the range.
    //
    // Glows while the covering box is clipped, because coarser scale is the
    // fix the scene is asking for. Not while disabled: a glowing dead key
    // would promise a remedy it cannot deliver.
    { cell: 'zoomout', glyph: '+', title: 'Coarser scale (Q)', act: scale(1), disabled: scaleExp >= MAX_SCALE_EXP,
      hint: coveringClipped && scaleExp < MAX_SCALE_EXP, scale: true },
    { cell: 'down', glyph: '▼', title: 'Down (S)', act: move('down') },
    { cell: 'zoomin', glyph: '−', title: 'Finer scale (E)', act: scale(-1), disabled: scaleExp <= 0, scale: true },
  ]

  return (
    <>
      <div className="touchpad" role="group" aria-label="Move cursor and change scale">
        {pad.map((b) => (
          <button
            key={b.cell}
            className={
              `touchpad__key touchpad__key--${b.cell}${b.hint ? ' is-zoomhint' : ''}` +
              // Emptied rather than removed: the cell keeps its place in the
              // grid, so the scale keys and the readout stay exactly where the
              // hand already knows to find them.
              (!atHead && !b.scale ? ' is-standdown' : '')
            }
            title={b.title}
            aria-label={b.title}
            disabled={b.disabled}
            {...bind(b.act)}
          >
            {b.glyph}
            {b.sub && <span className="touchpad__sub">{b.sub}</span>}
          </button>
        ))}
        {/* The hub doubles as the scale readout and its reset: a tap returns
            to 2^0, the finest scale. Hiding the pad lives on the canvas tap,
            where it always also lived, so nothing is lost to the reset. */}
        <button
          className="touchpad__hub"
          aria-label={`Scale 2^${scaleExp}. Tap to reset scale to 2^0.`}
          title="Reset scale to 2^0"
          {...noCallout}
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            const s = useCyberspace.getState()
            s.adjustScale(-s.scaleExp)
          }}
        >2^{scaleExp}</button>
      </div>

      {atHead && <div className="touchops">
        <button
          className="touchops__cancel"
          title={computing ? 'Cancel proof (X)' : 'Recall cursor (X)'}
          {...noCallout}
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            useCyberspace.getState().cancel()
          }}
        >
          {computing ? 'STOP' : 'RECALL'}
        </button>
        <button
          className={`touchops__commit ${deploying ? 'is-armed' : computing ? 'is-busy' : armed ? 'is-armed' : ''}`}
          disabled={!deploying && !armed && !computing}
          title={deploying ? 'Place shard here' : 'Commit hop (Space)'}
          {...noCallout}
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            if (deploying) void useShards.getState().deploy()
            else useCyberspace.getState().commit()
          }}
        >
          {deploying ? 'PLACE' : computing ? `${Math.round(proof.progress * 100)}%` : 'COMMIT'}
        </button>
        {/* Whether a commit leaves the device. Under COMMIT because that is the
            only control whose meaning it changes, and a switch rather than a
            toggle so the current mode is always spelled out, not implied. */}
        <div className="touchmode" role="group" aria-label="Publishing mode">
          <button
            className={`touchmode__opt ${live ? '' : 'is-on'}`}
            aria-pressed={!live}
            title="Local: sign actions but keep them on this device"
            {...noCallout}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); useCyberspace.getState().setLive(false) }}
          >LOCAL</button>
          <button
            className={`touchmode__opt ${live ? 'is-on' : ''}`}
            aria-pressed={live}
            title="Live: publish every action to cyberspace.nostr1.com"
            {...noCallout}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); useCyberspace.getState().setLive(true) }}
          >LIVE</button>
        </div>
      </div>}
    </>
  )
}
