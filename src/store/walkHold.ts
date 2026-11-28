/**
 * walkHold.ts: holding a WALK direction walks, from the press on (arkinox's
 * play test, 2026-11-10: "i have to tap tap tap forward quickly if i want to
 * move forward fast ... holding it now goes forward once, waits, and then
 * moves forward continuously").
 *
 * Before this, a held key walked by the operating system's key repeat (one
 * step, a pause of about half a second, then steps), and a held pad key by a
 * timer that imitated it (hooks/useRepeatable.ts: 380 ms, then one every
 * 110). Now every WALK direction, from the keyboard or the pad, is a held
 * source here, and one loop walks them all:
 *
 * | Moment | What happens |
 * |---|---|
 * | a direction goes down | one press at once, and the loop restarts from now |
 * | held | one press every WALK_HOLD_MS, the pad's old repeat, as fast as a quick tap-tap-tap: no pause first |
 * | let go | the source goes; with none left, the loop stops, and nothing more is pressed |
 * | the keyboard's own repeats | ignored (hooks/useKeyboard.ts): the loop is the repeat |
 * | WALK ends or begins, a STOP, the window loses focus or the page is hidden, Meta (Cmd) goes down or up | everything held is let go: macOS sends no keyup for a key let go while Cmd is down, so it would walk on forever |
 * | WALK's input closes (store/walkInput.ts: the menu, a modal, the workshop, TV) | nothing new is held, and the next beat lets go of everything |
 * | a text field takes focus | the keyboard's holds only: nothing new held from a key, and the next beat lets go of the keys held. The pad walks on |
 *
 * What is held combines, so two directions held are one diagonal press, as
 * W with D held always was on the keyboard (lib/walkKeys.ts) and now is on
 * the stick too: forward or back with a side is 45 degrees to that side of
 * the way you face (lib/walkSlide.ts walkHeading); a side alone is a step
 * to that side of the way you face; opposite directions cancel.
 *
 * Each pad key and key is its own source, so a second finger never ends the
 * first: the stick (or W) held, JUMP pressed and let go is a running jump, and the
 * walk goes on.
 *
 * Up and down held are read as held by a bounce (store/useWalk.ts (E)):
 * Up held adds its jump to every landing, Down held absorbs every landing.
 *
 * JUMP going down in the air under GRAVITY (falling, after a jump, in a
 * bounce's arc) is the double jump (store/useWalk.ts (F); play test of
 * 2026-11-10), once per time in the air, whatever else is held: Down held
 * does not cancel it. Only the press does it, never a beat, so JUMP held
 * from the floor jumps and never double jumps by itself: that takes a new
 * press in the air.
 *
 * A press is exactly the press a tap makes (store/useWalk.ts press), so a
 * hold of N presses builds the same open segment, closes it at the same
 * turns and publishes the same hops as N taps the same way. Up and down
 * (JUMP and DOWN) are pressed when they go down; held, they repeat only
 * when no level direction is held, except under GRAVITY, where they make no
 * level segment (a jump, a bounce's Up or Down) and a level press goes on
 * beside them: a running jump. With gravity off, a held level press that a
 * wall holds (a riser: the walk keeps its height) makes the held Up or Down
 * instead, so forward with Space held climbs a stair a gibson a beat.
 */

import { useCyberspace } from './useCyberspace'
import { useWalk } from './useWalk'
import { walkInputOpen } from './walkInput'
import { fluidNudge, fluidOn, noteNudge } from './fluidSwitch'
import { FLUID_NUDGE_MS } from '../lib/fluidWalk'
import type { HeldDir } from '../lib/walkKeys'
import { stickPeriod, type Dir8 } from '../lib/walkStick'

export type { HeldDir }

/**
 * A held direction's press period, in ms: the pad's repeat period
 * (hooks/useRepeatable.ts), about nine presses a second, which is a quick
 * tap-tap-tap, now from the press on instead of after a pause.
 */
export const WALK_HOLD_MS = 110


/** What is held now, by source: `key:KeyW` for a key, `pad:jump` for a pad key, STICK_SOURCE for the stick. */
const held = new Map<string, HeldDir>()
let timer: ReturnType<typeof setTimeout> | null = null
/** When the loop last pressed (or started), and when its next beat is due (Date.now ms), so a harder push can bring the beat forward. */
let lastBeat = 0
let nextAt = 0

/**
 * The phone's stick (hud/WalkStick.tsx), held while it is pushed past its
 * dead zone. A `pad:` source, so whatever lets go of the pad lets go of it.
 */
export const STICK_SOURCE = 'pad:stick'
/** The stick's analog reading (lib/walkStick.ts): forward and right, inside the unit circle, and the push. Read only while STICK_SOURCE is held. */
const stick = { fwd: 0, strafe: 0, mag: 0 }

const sign = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0)

/**
 * Everything held, combined: opposite directions cancel. The vertical is
 * the view's (`view`, lib/walkKeys.ts) when Space, C or the pad's JUMP or
 * DOWN pushes the way it comes out, else the camera's (R or F).
 */
export function heldNow(): HeldDir {
  let fwd = 0
  let strafe = 0
  let vert = 0
  let viewVert = 0
  for (const d of held.values()) { fwd += d.fwd; strafe += d.strafe; vert += d.vert; if (d.view) viewVert += d.vert }
  const v = sign(vert)
  return v !== 0 && sign(viewVert) === v ? { fwd: sign(fwd), strafe: sign(strafe), vert: v, view: true } : { fwd: sign(fwd), strafe: sign(strafe), vert: v }
}

/**
 * The level push of everything held, analog: the keys and pad keys as
 * heldNow combines them (each -1, 0 or 1), plus the stick's reading as it
 * is, so fluid WALK (store/walkFluid.ts) goes the stick's way at the
 * stick's speed. The keys alone give exactly what heldNow gives.
 */
export function heldLevel(): { fwd: number; strafe: number } {
  let fwd = 0
  let strafe = 0
  for (const [source, d] of held) if (source !== STICK_SOURCE) { fwd += d.fwd; strafe += d.strafe }
  const on = held.has(STICK_SOURCE)
  return { fwd: sign(fwd) + (on ? stick.fwd : 0), strafe: sign(strafe) + (on ? stick.strafe : 0) }
}

/** Whether anything is held. */
export function holding(): boolean {
  return held.size > 0
}

/** The level press `d` makes, if it has one. True when it pressed. */
function levelPress(d: HeldDir): boolean {
  const walk = useWalk.getState()
  if (d.fwd !== 0) { walk.press(d.fwd > 0 ? 'away' : 'toward', d.strafe); return true }
  if (d.strafe !== 0) { walk.press(d.strafe > 0 ? 'right' : 'left'); return true }
  return false
}

function samePlace(a: { x: bigint; y: bigint; z: bigint }, b: { x: bigint; y: bigint; z: bigint }): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/** The up or down press `vert` makes, if any: along the view's up when `view` (Space, C, the pad), else the camera's (R, F). */
function verticalPress(vert: -1 | 0 | 1, view = false): void {
  if (vert !== 0) useWalk.getState().press(vert > 0 ? 'up' : 'down', 0, view)
}

/** One beat of the loop: what is held, pressed once. */
function beat(): void {
  if (held.size === 0 || !walkInputOpen()) { holdReleaseAll(); return }
  // Typing into a field: the keys held are let go, and the pad walks on.
  if (!walkInputOpen(true) && [...held.keys()].some((source) => source.startsWith('key:'))) {
    holdEndAll('key:')
    if (held.size === 0) return
  }
  const d = heldNow()
  // Gravity off a held level step a wall holds (the walk keeps its height, store/walkStep.ts)
  // makes the Up or Down held with it instead, so forward and Space held climb a stair.
  const before = useCyberspace.getState().cursor
  const blockedNow = (): boolean => samePlace(before, useCyberspace.getState().cursor)
  // Fluid WALK (store/walkFluid.ts): what is held accelerates, read every
  // frame; nothing is pressed, except under GRAVITY Up and Down, which are
  // still a jump and Down as they were.
  if (fluidOn()) { if (useWalk.getState().gravity) verticalPress(d.vert, d.view); return }
  if (useWalk.getState().gravity) { verticalPress(d.vert, d.view); levelPress(d) }
  else if (!levelPress(d) || blockedNow()) verticalPress(d.vert, d.view)
}

/**
 * The loop's beat now, in ms: WALK_HOLD_MS, except while the stick alone
 * walks the level (no level key or pad key held with it), when it is the
 * stick's pace for its push (lib/walkStick.ts stickPeriod): a light push
 * steps slowly, a full push at the keys' pace.
 */
function period(): number {
  if (!held.has(STICK_SOURCE)) return WALK_HOLD_MS
  for (const [source, d] of held) if (source !== STICK_SOURCE && (d.fwd !== 0 || d.strafe !== 0)) return WALK_HOLD_MS
  return stickPeriod(stick.mag, WALK_HOLD_MS)
}

function schedule(delay: number): void {
  if (timer !== null) clearTimeout(timer)
  nextAt = Date.now() + Math.max(0, delay)
  timer = setTimeout(tick, Math.max(0, delay))
}

function tick(): void {
  timer = null
  lastBeat = Date.now()
  beat()
  // A beat can let go of everything (the input closed): then the loop is over.
  if (held.size > 0 && timer === null) schedule(period())
}

function restart(): void {
  lastBeat = Date.now()
  schedule(period())
}

function stopLoop(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

/**
 * `source` goes down holding `dir`: one press at once, then one every
 * WALK_HOLD_MS while anything is held. Down again without a let go (a lost
 * keyup) is a fresh press, as a tap is. Pressed with the input closed
 * (store/walkInput.ts; for a key, a focused text field closes it too),
 * nothing. The press is what everything held makes
 * together: on the floor, JUMP pressed while DOWN is held cancels, as the
 * two held do. In the air under GRAVITY JUMP's press is the double jump
 * instead (store/useWalk.ts (F)), whatever else is held, Down included.
 */
export function holdStart(source: string, dir: HeldDir): void {
  if (!walkInputOpen(source.startsWith('key:'))) return
  held.set(source, dir)
  const now = heldNow()
  // JUMP freshly pressed in the air: the double jump, Down held or not.
  const doubled = dir.vert > 0 && useWalk.getState().falling && useWalk.getState().doubleJump()
  if (fluidOn()) {
    // Fluid WALK: a press pushes for at least FLUID_NUDGE_MS (a tap is a
    // short nudge) and a hold accelerates; under GRAVITY Up and Down are
    // still a jump and Down, pressed as they were.
    const gravity = useWalk.getState().gravity
    if (gravity && dir.vert !== 0 && !doubled) verticalPress(now.vert, now.view)
    if (dir.fwd !== 0 || dir.strafe !== 0 || (!gravity && dir.vert !== 0)) noteNudge(dir, performance.now() + FLUID_NUDGE_MS)
    restart()
    return
  }
  if (dir.vert !== 0 && !doubled) verticalPress(now.vert, now.view)
  if (dir.fwd !== 0 || dir.strafe !== 0) levelPress(now)
  restart()
}

/**
 * The stick (hud/WalkStick.tsx) now: its reading (forward and right inside
 * the unit circle, and the push) and the nearest of its 8 directions, or
 * null inside the dead zone or let go. Only ever level: the stick never
 * goes up or down (owner, 2026-11-28: "vertical movement belongs to the
 * buttons on the right").
 *
 * | Moment | What happens |
 * |---|---|
 * | the push leaves the dead zone | held as STICK_SOURCE; the step WALK takes one step at once, as a key going down does |
 * | pushed on | the step WALK steps each beat the nearest of 8 ways, at the stick's pace (period); fluid WALK reads the reading every frame (heldLevel) |
 * | the direction or the push changes | no extra step: the next beat goes the new way, brought forward when a harder push makes it due sooner |
 * | back in the dead zone, or let go | no longer held; with nothing else held the loop stops |
 *
 * With WALK's input closed (store/walkInput.ts) nothing new is held.
 */
export function stickHold(vec: { fwd: number; strafe: number; mag: number }, dir: Dir8 | null): void {
  if (!dir) {
    stick.fwd = 0; stick.strafe = 0; stick.mag = 0
    if (held.has(STICK_SOURCE)) holdEnd(STICK_SOURCE)
    return
  }
  const was = held.has(STICK_SOURCE)
  if (!was && !walkInputOpen()) return
  stick.fwd = vec.fwd; stick.strafe = vec.strafe; stick.mag = vec.mag
  const d: HeldDir = { fwd: dir.fwd, strafe: dir.strafe, vert: 0 }
  held.set(STICK_SOURCE, d)
  if (!was) {
    // Fluid WALK reads the stick every frame: nothing to press, and no nudge.
    if (!fluidOn()) levelPress(heldNow())
    restart()
    return
  }
  // A harder push: the next beat comes when the new pace says, if that is sooner.
  const due = lastBeat + period()
  if (timer !== null && due < nextAt) schedule(due - Date.now())
}

/** `source` let go. With nothing left held, the loop stops. */
export function holdEnd(source: string): void {
  held.delete(source)
  if (held.size === 0) stopLoop()
}

/** Let go of every source whose name starts with `prefix` (`key:`, the window lost focus; `pad:`, the pad went away). */
export function holdEndAll(prefix: string): void {
  for (const source of [...held.keys()]) if (source.startsWith(prefix)) held.delete(source)
  if (held.size === 0) stopLoop()
}

/** Let go of everything. */
export function holdReleaseAll(): void {
  held.clear()
  stopLoop()
  // A tap's push goes too (fluid WALK): a STOP, a step that did not land or leaving WALK is never nudged on.
  fluidNudge.until = 0
}

// WALK beginning or ending lets go of everything: nothing held in one walk
// walks in the next, and a pad key that changed meaning under a finger (the
// HOP pad's left is a different key) never keeps walking.
useCyberspace.subscribe((s, prev) => {
  if (s.walking !== prev.walking) holdReleaseAll()
})
