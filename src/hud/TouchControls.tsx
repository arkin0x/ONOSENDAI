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
 *
 * The LOCAL/LIVE switch under COMMIT is the identity's only publishing
 * control, and going LIVE asks first. Only that direction: LOCAL takes
 * something back off the wire's path and needs no ceremony, while LIVE is the
 * decision that the next thing you do is seen, and it carries everything
 * already signed out with it (see lib/release.ts). Cancelling leaves the
 * switch exactly where it was, on LOCAL.
 */

import { useState } from 'react'
import { Box, Globe, MapPinOff } from 'lucide-react'
import { ConfirmModal } from './ConfirmModal'
import { useCyberspace } from '../store/useCyberspace'
import { moveDirection, type MoveName } from '../lib/moves'
import { MAX_SCALE_EXP } from '../lib/space'
import { EARTH_SCALE_EXP } from '../lib/hyperspace/interest'
import { useShards } from '../store/useShards'
import { ACTION_LABEL, useNextAction, useOffer } from '../store/useOffer'
import { useUiHints } from '../store/useUiHints'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'

/**
 * arkinox's wording, kept exactly as he wrote it, bullet shapes and blank
 * lines included: `.modal__pre` is `white-space: pre-wrap` so the line
 * breaks and the leading space on the first bullet survive to the screen.
 */
const GO_LIVE_BODY = [
  'LIVE means actions you take and things you hide in cyberspace are published to relays so others can see them. LOCAL holds all the data on this device privately.',
  '',
  'If you switch to LIVE,',
  ' - your next movement action will be published as well as your entire chain history',
  '- hidden objects stay LOCAL until each one is published by clicking the LIVE button next to it',
  '',
  'Switch to LIVE now?',
].join('\n')

export function TouchControls(): JSX.Element {
  const proof = useCyberspace((s) => s.proof)
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const pin = useCyberspace((s) => s.pin)
  const live = useCyberspace((s) => s.live)
  const deploying = useShards((s) => s.pending !== null)
  const bind = useRepeatable()
  // Open only while going LOCAL to LIVE. The switch itself is not moved until
  // the confirm, so a cancel, a tap on the backdrop, or the component going
  // away all leave the identity on LOCAL.
  const [goLive, setGoLive] = useState(false)
  // The scene's covering box reports when the region it draws is a clipped
  // stand-in; the zoom-out key is the remedy, so it echoes that (useUiHints).
  const coveringClipped = useUiHints((s) => s.coveringClipped)
  // Off your own head there is nothing to drive: spectating, viewing a block
  // and viewing Earth all anchor the scene somewhere that is not you. The six
  // directions and the commit row stand down, but scale still decides how much
  // of the line the field draws and which regime owns the frame, so the pad
  // stays, at its own size and in its own place, with those cells emptied.
  // Hiding the whole pad instead left EARTH opening at 2^52 with no way down.
  const atHead = useCyberspace((s) => s.canDrive())
  // The commit row is for a move of your own: only at your head.
  const home = useCyberspace((s) => s.atHead())

  const computing = proof.status === 'computing'
  const armed = !(position.x === cursor.x && position.y === cursor.y && position.z === cursor.z)
  // The button names the one action the next commit takes: COMMIT for a hop
  // to the cursor, HOP TO BOUNDARY or SIDESTEP for a step of the way, OFFLOAD
  // in blue when the step is HOSAKA's (pressing it brings up the card;
  // pressing again goes), TOO FAR in red, disabled, when nobody computes it.
  const next = useNextAction()
  const action = armed && !deploying && !computing ? next?.action ?? null : null
  const offload = action === 'offload'
  const tooFar = action === 'too-far'

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
      <div className={`touchpad${atHead ? '' : ' touchpad--scale'}`} role="group" aria-label="Move cursor and change scale">
        {/* The purple cube: the scale key taken to its end, 2^84, in one press.
            It changes the scale and nothing else, so whatever you are looking
            at stays what you are looking at, only seen from the top of the
            ladder. Viewing cyberspace itself is the CYBERSPACE button in the
            view menu, which is a different thing and stays where it is.
            On every pad, at your head or off it. */}
        {/* REMOVE PIN: only while there is a pin to remove, so the cell is
            empty the rest of the time and nothing moves when it appears.
            The pin itself is dropped by a click on the globe or a POSITION
            panel VIEW, and RETURN already clears it; this is the way to put
            a look down without leaving the place you are looking at. */}
        {pin && (
          <button className="touchpad__key touchpad__key--pin" title={`Remove the pin at ${pin.label}`} aria-label="Remove the pin" {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); useCyberspace.getState().clearPin() }}>
            <MapPinOff size={16} strokeWidth={2.25} aria-hidden />
          </button>
        )}
        {/* The planet at 2^52, the same thing the Hyperspace panel's EARTH
            button means, through the same function so the two can never
            drift: dataspace lined up, no viewed stop, the planet's centre.
            Beside the cube, which is the other one-press view. */}
        {/* Zoom only, like the cube beside it: it takes you to the scale the
            planet is legible at and leaves what you are looking at alone.
            It used to call viewEarth, which also re-targets the planet's
            centre, so pressing it while looking at a place threw the place
            away (arkinox, 2026-09-14). adjustScale takes a delta, so the
            delta is whatever gets this view to EARTH_SCALE_EXP. */}
        <button className="touchpad__key touchpad__key--earth" title="Zoom to Earth's scale (2^52)" aria-label="Zoom to 2^52" {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); const s = useCyberspace.getState(); s.adjustScale(EARTH_SCALE_EXP - s.scaleExp) }}>
          <Globe size={16} strokeWidth={2.25} aria-hidden />
        </button>
        <button className="touchpad__key touchpad__key--cube" title="Zoom all the way out (2^84)" aria-label="Zoom out to 2^84" {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); useCyberspace.getState().adjustScale(MAX_SCALE_EXP) }}>
          <Box size={16} strokeWidth={2.25} aria-hidden />
        </button>
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

      {home && <div className="touchops">
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
          className={`touchops__commit ${deploying ? 'is-armed' : computing ? 'is-busy' : tooFar ? 'is-too-far' : offload ? 'is-offload' : armed ? 'is-armed' : ''}`}
          disabled={(!deploying && !armed && !computing) || tooFar}
          title={deploying ? 'Place shard here' : tooFar ? 'Higher than anyone computes: bring the cursor nearer, or ride hyperspace' : offload ? 'This step needs HOSAKA: see the offer (Space)' : action === 'hop-to-boundary' ? 'Hop to the boundary on the way (Space)' : action === 'sidestep' ? 'Sidestep one gibson through the boundary (Space)' : 'Commit hop (Space)'}
          {...noCallout}
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            if (deploying) void useShards.getState().deploy()
            else if (offload && next && useOffer.getState().requestedFor !== next.cursorKey) useOffer.getState().request(next.cursorKey)
            else useCyberspace.getState().commit()
          }}
        >
          {deploying ? 'PLACE' : computing ? `${Math.round(proof.progress * 100)}%` : action ? ACTION_LABEL[action] : 'COMMIT'}
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
            title="Live: your next action publishes it and the whole chain behind it to cyberspace.nostr1.com"
            {...noCallout}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); if (!live) setGoLive(true) }}
          >LIVE</button>
        </div>
      </div>}

      {/* Outside the commit block: once it is up it stays up until it is
          answered, even if the avatar stops being somewhere you can act. */}
      {goLive && (
        <ConfirmModal
          title="Publishing"
          body={<span className="modal__pre">{GO_LIVE_BODY}</span>}
          confirmLabel="SWITCH TO LIVE"
          cancelLabel="CANCEL"
          danger={false}
          cardClassName="golive"
          onConfirm={() => { setGoLive(false); useCyberspace.getState().setLive(true) }}
          onCancel={() => setGoLive(false)}
        />
      )}
    </>
  )
}
