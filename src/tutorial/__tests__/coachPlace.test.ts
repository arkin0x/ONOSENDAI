/**
 * coachPlace.test.ts: the tutorial's caption panel never covers the menu
 * panel a step points at (owner, 2026-11-15: the "Your items" box sat on top
 * of ITEMS). Every case checks the promise itself: after the scroll asked
 * for, the panel's box and the coach's box on the side chosen do not meet.
 */

import { describe, expect, it } from 'vitest'
import { coachBox, overlaps, placeCoach, type Box, type CoachPlaceInput } from '../coachPlace'

const GAP = 8

/** A phone (375x812): the coach spans the screen, the menu button at the bottom left. */
const phone = (target: Box, coachHeight = 260): CoachPlaceInput => ({
  target, coachHeight, coachLeft: 8, coachRight: 367, viewportHeight: 812, topInset: 8, bottomInset: 76, gap: GAP,
})

/** A desktop (1440x900): the coach is 460 wide at the top centre, the left column 16 to 336. */
const desktop = (target: Box, coachHeight = 300): CoachPlaceInput => ({
  target, coachHeight, coachLeft: 490, coachRight: 950, viewportHeight: 900, topInset: 8, bottomInset: GAP, gap: GAP,
})

const box = (top: number, height: number, left = 16, right = 359): Box => ({ top, bottom: top + height, left, right })

/** The panel's box after the scroll, and the coach's on the side chosen, never meet. */
function clear(i: CoachPlaceInput): void {
  const at = placeCoach(i)
  const moved = { ...i.target, top: i.target.top - at.scroll, bottom: i.target.bottom - at.scroll }
  expect(overlaps(moved, coachBox(at.side, i), GAP), JSON.stringify({ at, moved })).toBe(false)
}

describe('placeCoach', () => {
  it('stays at the top when the panel is below it', () => {
    expect(placeCoach(phone(box(400, 120)))).toEqual({ side: 'top', scroll: 0 })
  })

  it('goes to the foot when the panel is under the top, and the foot is clear (ITEMS under IDENTITY on a phone)', () => {
    const i = phone(box(250, 110))
    expect(placeCoach(i)).toEqual({ side: 'bottom', scroll: 0 })
    clear(i)
  })

  it('scrolls the panel into the room when it is clear of neither side, and the least scroll wins', () => {
    // Middle of the screen, a tall coach: covered at the top and at the foot.
    const i = phone(box(300, 150), 330)
    const at = placeCoach(i)
    expect(at.scroll).not.toBe(0)
    clear(i)
  })

  it('shows the top of a panel taller than the room', () => {
    const i = phone(box(100, 700))
    const at = placeCoach(i)
    expect(at.side).toBe('top')
    expect(i.target.top - at.scroll).toBe(coachBox('top', i).bottom + GAP)
    clear(i)
  })

  it('on a desktop leaves the coach at the top: the left column is beside it, not under it', () => {
    expect(placeCoach(desktop(box(60, 140, 16, 336)))).toEqual({ side: 'top', scroll: 0 })
  })

  it('keeps clear of a menu panel wherever it is, on a phone and on a desktop', () => {
    for (let top = -200; top <= 1000; top += 37) {
      for (const height of [40, 110, 240, 420, 600, 1200]) {
        clear(phone(box(top, height)))
        clear(phone(box(top, height), 180))
        clear(desktop(box(top, height, 16, 336)))
        // A desktop panel dragged under the coach (a narrow window's stacked columns).
        clear(desktop(box(top, height, 400, 1040)))
      }
    }
  })
})
