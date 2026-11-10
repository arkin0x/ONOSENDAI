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
 * | a thumb slides on FORWARD | its side changes for the next press, with no press of its own |
 * | let go | the source goes; with none left, the loop stops, and nothing more is pressed |
 * | the keyboard's own repeats | ignored (hooks/useKeyboard.ts): the loop is the repeat |
 * | WALK ends or begins, or the window loses focus | everything held is let go |
 *
 * What is held combines, so two directions held are one diagonal press, as
 * W with D held always was on the keyboard (lib/walkKeys.ts) and now is on
 * the pad too: forward or back with a side is 45 degrees to that side of
 * the way you face (lib/walkSlide.ts walkHeading); a side alone is a step
 * to that side of the way you face; opposite directions cancel.
 *
 * A press is exactly the press a tap makes (store/useWalk.ts press), so a
 * hold of N presses builds the same open segment, closes it at the same
 * turns and publishes the same hops as N taps the same way. Up and down
 * (JUMP and DOWN) are pressed when they go down; held, they repeat only
 * when no level direction is held, except under GRAVITY, where they make no
 * level segment (a jump, a bounce's Up or Down) and a level press goes on
 * beside them: a running jump.
 */

import { useCyberspace } from './useCyberspace'
import { useWalk } from './useWalk'
import type { HeldDir } from '../lib/walkKeys'

export type { HeldDir }

/**
 * A held direction's press period, in ms: the pad's repeat period
 * (hooks/useRepeatable.ts), about nine presses a second, which is a quick
 * tap-tap-tap, now from the press on instead of after a pause.
 */
export const WALK_HOLD_MS = 110


/** What is held now, by source: `key:KeyW` for a key, `pad:forward` for a pad key. */
const held = new Map<string, HeldDir>()
let timer: ReturnType<typeof setInterval> | null = null

const sign = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0)

/** Everything held, combined: opposite directions cancel. */
export function heldNow(): HeldDir {
  let fwd = 0
  let strafe = 0
  let vert = 0
  for (const d of held.values()) { fwd += d.fwd; strafe += d.strafe; vert += d.vert }
  return { fwd: sign(fwd), strafe: sign(strafe), vert: sign(vert) }
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

/** The up or down press `vert` makes, if any. */
function verticalPress(vert: -1 | 0 | 1): void {
  if (vert !== 0) useWalk.getState().press(vert > 0 ? 'up' : 'down')
}

/** One beat of the loop: what is held, pressed once. */
function beat(): void {
  if (!useCyberspace.getState().walking || held.size === 0) { holdReleaseAll(); return }
  const d = heldNow()
  if (useWalk.getState().gravity) { verticalPress(d.vert); levelPress(d) }
  else if (!levelPress(d)) verticalPress(d.vert)
}

function restart(): void {
  if (timer !== null) clearInterval(timer)
  timer = setInterval(beat, WALK_HOLD_MS)
}

function stopLoop(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
}

/**
 * `source` goes down holding `dir`: one press at once, then one every
 * WALK_HOLD_MS while anything is held. Down again without a let go (a lost
 * keyup) is a fresh press, as a tap is.
 */
export function holdStart(source: string, dir: HeldDir): void {
  held.set(source, dir)
  if (dir.vert !== 0) verticalPress(dir.vert)
  if (dir.fwd !== 0 || dir.strafe !== 0) levelPress(heldNow())
  restart()
}

/** A held source's direction changes (a thumb sliding on FORWARD): the next press goes the new way. */
export function holdMove(source: string, dir: HeldDir): void {
  if (held.has(source)) held.set(source, dir)
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
}

// WALK beginning or ending lets go of everything: nothing held in one walk
// walks in the next, and a pad key that changed meaning under a finger (the
// HOP pad's left is a different key) never keeps walking.
useCyberspace.subscribe((s, prev) => {
  if (s.walking !== prev.walking) holdReleaseAll()
})
