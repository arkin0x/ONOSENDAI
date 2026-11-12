/**
 * TouchControls.tsx - cyberspace operations for touch, as an overlay.
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
 *
 * The commit slot is also the pad's mode switch (arkinox, 2026-10-13,
 * 2026-11-02 and 2026-11-11; store/padMode.ts): HOP, the resting state,
 * where the pad lines up a move and COMMIT sends it; VIEW, a free look from
 * your head; BUILD, placing things at a build cursor (store/useBuilder.ts).
 * HOP turns VIEW on, VIEW turns BUILD on where it was looking, BUILD goes
 * back to HOP. The mode button is lit while its mode is the one the pad is
 * in, HOP as lit as COMMIT.
 *
 * WALK, first person, where every press is a step (store/useWalk.ts), is a
 * toggle in RECALL's slot (arkinox, 2026-11-12): with the cursor on your
 * avatar and nothing under way, in HOP, VIEW or BUILD, the slot is WALK,
 * dim. Pressed, WALK lights and the mode button dims, still naming the mode
 * WALK came from; pressing either goes back to that mode, the colors
 * crossing over in 400 ms. While steps wait on their proofs the lit WALK is
 * STOP, as before. With the cursor off your avatar the slot is RECALL, which
 * brings the cursor home and stays in the mode (store/padMode.ts recall).
 * Each mode tints the pad's keys its own color, blue, yellow, red, white, so
 * the hand knows what a press will do before it presses.
 *
 * WALK's pad is its own (arkinox, 2026-11-02): no scale keys, one large
 * FORWARD where FAR, up and NEAR were, BACKWARD where down was, JUMP where
 * + and the scale readout were, and DOWN where - was. The keys are the same
 * as before (lib/walkKeys.ts): W, S, A, D, Space or R, C or F.
 *
 * WALK's keys walk while held, from the press on, and what is held
 * combines (store/walkHold.ts; play test of 2026-11-10): FORWARD or BACK
 * held with a side arrow goes 45 degrees to that side. FORWARD itself is
 * plain forward (its diagonal end zones went after the next play test, the
 * same day). Each key is its own hold: JUMP pressed with FORWARD held is a
 * running jump, and FORWARD walks on.
 *
 * JUMP and DOWN stand on the left (arkinox, 2026-11-10: "move jump/down to
 * the left side above the menu button and below the LOOK sphere"), at the
 * height they had in the pad's bottom row, so a jump is the left thumb's
 * and the walk the right's. The right keeps a compact cluster: GRAVITY,
 * FORWARD, and the sides with BACK.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Box, Globe, Scan } from 'lucide-react'
import { ConfirmModal } from './ConfirmModal'
import { busyLabel, useCyberspace } from '../store/useCyberspace'
import { DEFAULT_RELAY } from '../store/useRelays'
import { moveDirection, type MoveName } from '../lib/moves'
import { MAX_SCALE_EXP } from '../lib/space'
import { EARTH_SCALE_EXP } from '../lib/hyperspace/interest'
import { useShards } from '../store/useShards'
import { useAtLastSpot } from './DeployBar'
import { ACTION_LABEL, useNextAction, useOffer } from '../store/useOffer'
import { useUiHints } from '../store/useUiHints'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { ChainStatusStrip, useChainStatus } from './ChainStatus'
import { moveUnderWay } from '../lib/buildCursor'
import { useWalk } from '../store/useWalk'
import { onAvatar, useBuilder } from '../store/useBuilder'
import { buildHeld, cycleMode, enterWalk, leaveWalk, padMode, recall } from '../store/padMode'
import type { WalkFrom } from '../store/useWalk'
import { useCover } from '../hooks/useCover'
import { ForwardArrow3D, ReverseArrow3D } from './ui/FlyArrows'
import { regionAtOriginalSize, useRegion } from '../store/useRegion'
import { holdEnd, holdEndAll, holdStart } from '../store/walkHold'
import { walkHeldDir, type HeldDir } from '../lib/walkKeys'

/**
 * arkinox's wording, kept exactly as he wrote it, bullet shapes and blank
 * lines included: `.modal__pre` is `white-space: pre-wrap` so the line
 * breaks and the leading space on the first bullet survive to the screen.
 */
export const GO_LIVE_BODY = [
  'LIVE means actions you take and things you hide in cyberspace are published to relays so others can see them. LOCAL holds your chain and what you hide on this device privately.',
  '',
  'If you switch to LIVE,',
  ' - your next movement action will be published as well as your entire chain history',
  '- hidden objects stay LOCAL until each one is published by clicking the LIVE button next to it',
  '',
  'Switch to LIVE now?',
].join('\n')

/** The mode button's word for each mode it can name. */
const MODE_WORD: Record<WalkFrom, string> = { hop: 'HOP', view: 'VIEW', build: 'BUILD' }

/** One key of the pad: the grid cell it stands in, what it shows, and what a press does. */
export interface PadKey {
  cell: string
  glyph: ReactNode
  sub?: string
  title: string
  act: () => void
  disabled?: boolean
  hint?: boolean
  scale?: boolean
  /** The keyboard key for this button, drawn tiny at its bottom centre (per mode, since the keys differ). */
  keyHint?: string
  /** WALK: the direction this key holds while pressed (store/walkHold.ts). */
  hold?: HeldDir
  /** WALK's JUMP and DOWN: drawn on the left of the screen, over the menu button, not in the pad. */
  left?: boolean
  /** The aria-label, when it says more than the title. */
  label?: string
}

/**
 * WALK's keys (arkinox, 2026-11-02), each the same step its key on the
 * keyboard takes (lib/walkKeys.ts), so the pad and the keys never disagree:
 *
 * | Key | Keyboard | Was |
 * |---|---|---|
 * | FORWARD, one large key | W | FAR, up and NEAR |
 * | BACKWARD | S | down |
 * | left, right | A, D | the same |
 * | JUMP | Space or R | + and the 2^ readout |
 * | DOWN | C or F | - |
 *
 * Under GRAVITY JUMP is a jump, and DOWN moves nothing but absorbs a bounce
 * pressed just before the landing, or every landing while held
 * (store/useWalk.ts (E), ruled D5),
 * so it stays on: on a phone it is the only way to absorb one (review of
 * #649). JUMP pressed again in the air is a double jump (store/useWalk.ts
 * (F)). With gravity off, JUMP and DOWN are one cell up and down. Both
 * stand on the left of the screen (`left`), the rest in the pad.
 * The forward and reverse arrows are the pair VIEW's fly keys wear too
 * (hud/ui/FlyArrows.tsx).
 *
 * Each key holds its direction while pressed (store/walkHold.ts).
 */
export function walkPad(gravity: boolean, move: (name: MoveName) => () => void): PadKey[] {
  const key = (name: MoveName): Pick<PadKey, 'act' | 'hold'> => ({ act: move(name), hold: walkHeldDir(name) })
  return [
    { cell: 'forward', glyph: <ForwardArrow3D size={26} />, sub: 'FORWARD', title: 'Forward (W)', keyHint: 'W', ...key('away') },
    { cell: 'left', glyph: '◀', title: 'Left (A)', keyHint: 'A', ...key('left') },
    { cell: 'backward', glyph: <ReverseArrow3D size={20} />, sub: 'BACK', title: 'Backward (S)', keyHint: 'S', ...key('toward') },
    { cell: 'right', glyph: '▶', title: 'Right (D)', keyHint: 'D', ...key('right') },
    { cell: 'jump', glyph: 'JUMP', title: gravity ? 'Jump (Space or R). Press again in the air to double jump.' : 'Jump: up one cell (Space or R)', keyHint: 'SPACE', ...key('up'), left: true },
    { cell: 'down', glyph: '▼', title: gravity ? 'Down: hold to absorb a bounce (C or F)' : 'Down one cell (C or F)', keyHint: 'C', ...key('down'), left: true },
  ]
}

/**
 * A WALK key's handlers: held from pointerdown to pointerup, pointercancel
 * or leave, walking all the while (store/walkHold.ts).
 */
export function padHold(b: PadKey): {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerLeave: () => void
  onLostPointerCapture: () => void
  onContextMenu: (e: React.MouseEvent) => void
} {
  const source = `pad:${b.cell}`
  const hold = b.hold ?? { fwd: 0, strafe: 0, vert: 0 }
  const end = (): void => holdEnd(source)
  return {
    onPointerDown: (e) => {
      // Keeps the press off the canvas, and off a scroll or a synthetic click.
      e.preventDefault()
      e.stopPropagation()
      holdStart(source, hold)
    },
    onPointerUp: end,
    onPointerCancel: end,
    onPointerLeave: end,
    onLostPointerCapture: end,
    ...noCallout,
  }
}

export function TouchControls(): JSX.Element {
  // The pad and the block under it cover the scene from below: BUILD frames
  // the cursor above them (hooks/useCover).
  const padRef = useCover('bottom')
  const opsRef = useCover('bottom')
  const proof = useCyberspace((s) => s.proof)
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const live = useCyberspace((s) => s.live)
  // What the chain's publishing is doing when the switch alone cannot say:
  // held, a conflict waiting for a choice, or LIVE with nothing reachable.
  // Null, and not drawn, when there is nothing to report.
  const chainStatus = useChainStatus()
  const deploying = useShards((s) => s.pending !== null)
  // A copy on the spot the last one landed on: PLACE is refused there.
  const placedHere = useAtLastSpot()
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
  // The commit row is for a move of your own: only at your head, and while
  // the pad's VIEW is on, where it holds RECALL and the lit VIEW.
  const home = useCyberspace((s) => s.atHead())
  const viewing = useCyberspace((s) => s.viewing())
  const walking = useCyberspace((s) => s.walking)
  // No move planned or under way, and no cloud job: with the cursor home, RECALL's slot is WALK.
  const resting = useCyberspace((s) => s.plan === null && !moveUnderWay(s) && s.cloud.status === 'idle')
  // Your own head is there to walk from once VIEW or BUILD's view lets go of it (padMode enterWalk).
  const ownHead = useCyberspace((s) => s.spectate === null && s.exploreIndex === null && s.transit === null)
  // BUILD's build cursor on your avatar (useBuilder onAvatar): the slot is WALK there.
  const buildHome = useCyberspace((s) => onAvatar(s))
  // A WALK key held as the pad goes away (the menu covers it, an offer comes
  // up) or WALK ends gets no pointerup: let go of it here.
  useEffect(() => { if (!walking) holdEndAll('pad:') }, [walking])
  useEffect(() => () => holdEndAll('pad:'), [])
  // Steps pressed in WALK and not yet proven, queued or still being walked:
  // STOP has something to stop.
  const behind = useWalk((s) => s.behind + (s.open ? 1 : 0) + (s.falling ? 1 : 0))
  // The mode WALK was entered from: the dim mode button names it, and goes back to it.
  const walkFrom = useWalk((s) => s.from)
  // GRAVITY in WALK (store/useWalk.ts): JUMP jumps, DOWN absorbs a bounce.
  const gravity = useWalk((s) => s.gravity)
  const building = useBuilder((s) => s.active)
  // Region mode, a tool inside VIEW (store/useRegion.ts): the Region button
  // turns it on, RECALL becomes RESET once the region has grown, and the pad
  // grows the region instead of lining up a move.
  const regionActive = useRegion((s) => s.active)
  const regionGrown = useRegion((s) => !regionAtOriginalSize(s))
  // A deploy lined up that leaving BUILD would cancel: BUILD and WALK wait
  // for PLACE or CANCEL (store/padMode.ts buildHeld).
  const held = useShards((s) => buildHeld(s))
  const mode = padMode(walking, building, viewing)
  // The commit block under the pad: at your head, in VIEW, and in BUILD, but
  // not while spectating, where the SPECTATING bar holds that corner (BUILD
  // is left there by EXIT, B or Esc, as before). Whenever it is drawn with
  // the chain status strip it is a row taller, and the pad is lifted by that
  // row, or RECALL and the mode button stand over the pad's bottom row
  // (review of #588: in BUILD a low tap on a scale key left BUILD).
  const spectating = useCyberspace((s) => s.spectate !== null)
  const opsUp = home || viewing || (building && !spectating)

  const computing = proof.status === 'computing'
  const armed = !(position.x === cursor.x && position.y === cursor.y && position.z === cursor.z)
  // RECALL's slot (arkinox, 2026-11-12; store/padMode.ts): WALK, dim, with
  // the cursor on your avatar and nothing under way, in HOP, VIEW (not over a
  // grown region, which is RESET's) and BUILD (where a deploy lined up holds
  // it, disabled); lit in WALK; STOP in WALK while steps wait on their
  // proofs; RECALL with the cursor off your avatar.
  const stopping = walking && (computing || behind > 0)
  const walkSlot = walking ? !stopping : resting && !computing && (
    mode === 'hop' ? home && !armed && !deploying
    : mode === 'view' ? ownHead && !armed && !deploying && !(regionActive && regionGrown)
    : ownHead && buildHome
  )
  const walkHeld = !walking && building && held
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
    // In WALK a press is a step, committed now (store/useWalk.ts).
    if (s.walking) { useWalk.getState().press(name); return }
    s.moveCursor(moveDirection(s.screenAxes ?? s.axes(), name))
  }
  const scale = (delta: number) => () => useCyberspace.getState().adjustScale(delta)

  // Six directions plus the two scale steps: exactly nine things, which is
  // exactly how many cells a 3x3 pad has. WALK's are its own (walkPad).
  const pad: PadKey[] = walking ? walkPad(gravity, move) : [
    // The physics convention for a vector through the page: a tail seen from
    // behind going in, an arrow tip seen head-on coming out. It is the right
    // symbol and it is not enough on its own, because the two differ only by a
    // small mark inside the circle and that mark is the first thing to go at
    // this size. The word carries the meaning; the glyph carries the convention.
    // FAR and NEAR wear the forward and reverse arrows VIEW's fly buttons and
    // WALK's forward wear (hud/ui/FlyArrows.tsx; arkinox, 2026-11-11), full
    // size and with no word on the face: the arrow says it, and FAR/NEAR stay
    // in the title for a reader (arkinox, review, 2026-11-11).
    { cell: 'away', glyph: <ForwardArrow3D size={24} />, title: 'FAR: away from camera (R)', keyHint: 'R', act: move('away') },
    { cell: 'up', glyph: '▲', title: 'Up (W)', keyHint: 'W', act: move('up') },
    { cell: 'toward', glyph: <ReverseArrow3D size={24} />, title: 'NEAR: toward camera (F)', keyHint: 'F', act: move('toward') },
    { cell: 'left', glyph: '◀', title: 'Left (A)', keyHint: 'A', act: move('left') },
    { cell: 'right', glyph: '▶', title: 'Right (D)', keyHint: 'D', act: move('right') },
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
    { cell: 'zoomout', glyph: '+', title: 'Coarser scale (Q)', keyHint: 'Q', act: scale(1), disabled: scaleExp >= MAX_SCALE_EXP,
      hint: coveringClipped && scaleExp < MAX_SCALE_EXP, scale: true },
    { cell: 'down', glyph: '▼', title: 'Down (S)', keyHint: 'S', act: move('down') },
    { cell: 'zoomin', glyph: '−', title: 'Finer scale (E)', keyHint: 'E', act: scale(-1), disabled: scaleExp <= 0, scale: true },
  ]

  const padKey = (b: PadKey): JSX.Element => (
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
      aria-label={b.label ?? b.title}
      disabled={b.disabled}
      {...(walking && b.hold ? padHold(b) : bind(b.act))}
    >
      {b.glyph}
      {b.sub && <span className="touchpad__sub">{b.sub}</span>}
      {b.keyHint && <span className="touchpad__keyhint" aria-hidden>{b.keyHint}</span>}
    </button>
  )
  // The mode button: lit while its mode is on (a press goes round the ring),
  // dim in WALK naming the mode WALK came from (a press goes back to it).
  const modeButton = (m: WalkFrom, on: boolean): JSX.Element => {
    const wait = on && m === 'build' && held
    const title = !on ? `Leave WALK and go back to ${MODE_WORD[m]}`
      : wait ? 'Place or cancel what is lined up first'
      : m === 'build' ? 'Building: the pad moves the build cursor and never you. Press to go back to HOP'
      : m === 'view' ? 'Viewing: the pad moves the cursor without planning a hop. Press for BUILD here; RECALL brings the cursor home and stays in VIEW'
      : 'Hop: the pad lines up a move and COMMIT sends it. Press for VIEW, a free look that moves nothing'
    return (
      <button
        key={`mode-${m}`}
        className={`touchops__commit is-${m}${on ? ' is-on' : ''}`}
        aria-pressed={on}
        disabled={wait}
        title={title}
        {...noCallout}
        onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); if (wait) return; if (on) cycleMode(); else leaveWalk() }}
      >{m === 'hop' ? <>HOP<span className="touchops__sub">(MODES)</span></> : MODE_WORD[m]}</button>
    )
  }

  // WALK's JUMP and DOWN, on the left over the menu button (walkPad `left`).
  // Not while placing, when the deploy bar docks in that corner, nor off
  // your head, where the pad stands its direction keys down.
  const leftKeys = deploying || !atHead ? [] : pad.filter((b) => b.left)

  return (
    <>
      <div ref={padRef} className={`touchpad touchpad--mode-${mode}${atHead ? '' : ' touchpad--scale'}${opsUp && chainStatus ? ' is-lifted' : ''}`} role="group" aria-label={walking ? 'Walk' : 'Move cursor and change scale'}>
        {/* The purple cube: the scale key taken to its end, 2^84, in one press.
            It changes the scale and nothing else, so whatever you are looking
            at stays what you are looking at, only seen from the top of the
            ladder. Viewing cyberspace itself is the CYBERSPACE button in the
            view menu, which is a different thing and stays where it is.
            On every pad, at your head or off it. */}
        {/* The planet at 2^52, the scale the view menu's EARTH
            button means, through the same function so the two can never
            drift: dataspace lined up, no viewed stop, the planet's centre.
            Beside the cube, which is the other one-press view. */}
        {/* Zoom only, like the cube beside it: it takes you to the scale the
            planet is legible at and leaves what you are looking at alone.
            It used to call viewEarth, which also re-targets the planet's
            centre, so pressing it while looking at a place threw the place
            away (arkinox, 2026-09-14). adjustScale takes a delta, so the
            delta is whatever gets this view to EARTH_SCALE_EXP. */}
        {/* WALK has no one-press zoom: the owner removed both (2026-11-01). */}
        {!walking && (
          <>
            {/* Region (lucide scan): picks a speakeasy region, VIEW only, left
                of the globe. On turns region mode on and opens the REGION chip
                (store/useRegion.ts, hud/RegionChip.tsx). The pin cell is its
                own: REMOVE PIN is gone with the cross marker (arkinox, 2026-11-11). */}
            {viewing && !building && (
              <button
                className={`touchpad__key touchpad__key--region${regionActive ? ' is-on' : ''}`}
                title="Region: pick a region for a private speakeasy"
                aria-label="Region selector"
                aria-pressed={regionActive}
                {...noCallout}
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); const r = useRegion.getState(); if (r.active) r.exit(); else r.enter() }}
              >
                <Scan size={16} strokeWidth={2.25} aria-hidden />
              </button>
            )}
            <button className="touchpad__key touchpad__key--earth" title="Zoom to Earth's scale (2^52)" aria-label="Zoom to 2^52" {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); const s = useCyberspace.getState(); s.adjustScale(EARTH_SCALE_EXP - s.scaleExp) }}>
              <Globe size={16} strokeWidth={2.25} aria-hidden />
            </button>
            <button className="touchpad__key touchpad__key--cube" title="Zoom all the way out (2^84)" aria-label="Zoom out to 2^84" {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); useCyberspace.getState().adjustScale(MAX_SCALE_EXP) }}>
              <Box size={16} strokeWidth={2.25} aria-hidden />
            </button>
          </>
        )}
        {walking && (
          <button
            className={`touchpad__key touchpad__key--gravity${gravity ? ' is-on' : ''}`}
            aria-pressed={gravity}
            title="Gravity (Z)"
            aria-label="Gravity"
            {...noCallout}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); useWalk.getState().setGravity(!gravity) }}
          >GRAVITY</button>
        )}
        {pad.filter((b) => !b.left).map(padKey)}
        {/* The hub doubles as the scale readout and its reset: a tap returns
            to 2^0, the finest scale. Hiding the pad lives on the canvas tap,
            where it always also lived, so nothing is lost to the reset.
            Not in WALK, where JUMP has its cell (walkPad). */}
        {!walking && <button
          className="touchpad__hub"
          aria-label={`Scale 2^${scaleExp}. Tap to reset scale to 2^0.`}
          title="Reset scale to 2^0"
          {...noCallout}
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            const s = useCyberspace.getState()
            s.adjustScale(-s.scaleExp)
          }}
        >2^{scaleExp}</button>}
      </div>

      {leftKeys.length > 0 && (
        <div className="walkside" role="group" aria-label="Jump and down">
          {leftKeys.map(padKey)}
        </div>
      )}

      {opsUp && <div ref={opsRef} className={`touchops touchops--mode-${mode}${chainStatus ? ' touchops--status' : ''}`}>
        {/* RECALL is RESET while a grown region is up (store/useRegion.ts): it
            returns the region to the size it had when region mode started.
            With the cursor on your avatar the slot is WALK, dim, and lit in
            WALK (arkinox, 2026-11-12): pressing it goes in, or back to the
            mode WALK came from. Keyed apart from RECALL and STOP, so only
            WALK's own dim to lit (and back) eases (.touchops__walk). */}
        {walkSlot ? (
          <button
            key="walk"
            className={`touchops__cancel touchops__walk ${walking ? 'is-on' : 'is-dim'}`}
            aria-pressed={walking}
            title={walking
              ? `Walking: every press is a step, proved behind you. Keys: W forward, S back, A and D sideways, Space or R jump, C or F down. Press to go back to ${MODE_WORD[walkFrom]} (X)`
              : walkHeld ? 'Place or cancel what is lined up first'
              : 'Walk: first person, every press a step'}
            aria-label={walking ? `Walking. Press to go back to ${MODE_WORD[walkFrom]}` : 'Walk: first person, every press a step'}
            disabled={walkHeld}
            {...noCallout}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); if (walking) leaveWalk(); else if (!walkHeld) enterWalk() }}
          >WALK</button>
        ) : <button
          key="cancel"
          className="touchops__cancel"
          title={walking ? 'Stop the walk where the chain is now (X)'
            : computing ? 'Cancel proof (X)'
            : regionActive && regionGrown ? 'Reset the region to its size when region mode started (RECALL)'
            : building ? 'Bring the build cursor back to your avatar, still in BUILD (X)'
            : regionActive ? 'Recall the cursor to where region mode started; there already, end region mode and recall it home, still in VIEW'
            : viewing ? 'Recall the cursor and the view to your avatar, still in VIEW (X)' : 'Recall cursor (X)'}
          {...noCallout}
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            if (walking) {
              if (computing || behind > 0) useWalk.getState().stop()
              else leaveWalk()
              return
            }
            recall()
          }}
        >
          {computing || stopping ? 'STOP' : regionActive && regionGrown ? 'RESET' : 'RECALL'}
        </button>}
        {/* The mode switch, in the commit slot while there is nothing to
            commit: HOP to VIEW to BUILD and back to HOP (store/padMode.ts,
            arkinox 2026-11-11), lit, HOP as lit as COMMIT (2026-11-12). In
            WALK it names the mode WALK came from, dim, and goes back to it.
            VIEW (arkinox, 2026-10-10) is a free view from your head, the pad
            moving the cursor to look around without planning a hop; BUILD
            (2026-11-02 in the ring) places things and never moves you. Keyed
            by the mode it names, so only its own dim to lit eases. */}
        {walking ? modeButton(walkFrom, false)
          : building ? modeButton('build', true)
          : viewing ? modeButton('view', true)
          : (!armed && !deploying && !computing) ? modeButton('hop', true)
          : (
        <button
          key="commit"
          className={`touchops__commit ${deploying ? 'is-armed' : computing ? 'is-busy' : tooFar ? 'is-too-far' : offload ? 'is-offload' : armed ? 'is-armed' : ''}`}
          disabled={(!deploying && !armed && !computing) || tooFar || (deploying && placedHere)}
          title={deploying ? (placedHere ? 'The last one stands here. Move to place another' : 'Place shard here') : tooFar ? 'Higher than anyone computes: bring the cursor nearer, or ride hyperspace' : offload ? 'This step needs HOSAKA: see the offer (Space)' : action === 'hop-to-boundary' ? 'Hop to the boundary on the way (Space)' : action === 'sidestep' ? 'Sidestep one gibson through the boundary (Space)' : 'Commit hop (Space)'}
          {...noCallout}
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            if (deploying) void useShards.getState().deploy()
            else if (offload && next && useOffer.getState().requestedFor !== next.cursorKey) useOffer.getState().request(next.cursorKey)
            else useCyberspace.getState().commit()
          }}
        >
          {deploying ? (placedHere ? 'PLACED' : 'PLACE') : computing ? busyLabel(proof) : action ? ACTION_LABEL[action] : 'COMMIT'}
        </button>
        )}
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
            title={`Live: your next action publishes it and the whole chain behind it to ${DEFAULT_RELAY.replace(/^wss:\/\//, '')}`}
            {...noCallout}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); if (!live) setGoLive(true) }}
          >LIVE</button>
        </div>
        {/* Directly under the switch, which itself never changes: it says
            what was chosen, this says what is happening (ChainStatus.tsx). */}
        {chainStatus && <ChainStatusStrip status={chainStatus} />}
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
