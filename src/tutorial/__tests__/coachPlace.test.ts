/**
 * coachPlace.test.ts: the tutorial's caption panel never covers the menu
 * panel a step points at (owner, 2026-11-15: the "Your items" box sat on top
 * of ITEMS). The cases check the promise itself: after the scroll asked for,
 * the panel's box and the coach's box on the side chosen do not meet, and the
 * panel's top is on screen; and no scroll is asked for that the menu cannot do.
 */

import { describe, expect, it } from 'vitest'
import { clearOf, coachBox, overlaps, placeCoach, scrolled, type Box, type CoachPlaceInput } from '../coachPlace'

const GAP = 8
const LOTS = 5000

/** A phone (375x812): the coach spans the screen, the menu button at the bottom left. */
const phone = (target: Box, coachHeight = 260, up = LOTS, down = LOTS): CoachPlaceInput => ({
  target, coachHeight, coachLeft: 8, coachRight: 367, viewportHeight: 812, topInset: 8, bottomInset: 76, gap: GAP, canScrollUp: up, canScrollDown: down,
})

/** A desktop (1440x900): the coach is 460 wide at the top centre, the left column 16 to 336. */
const desktop = (target: Box, coachHeight = 300, up = LOTS, down = LOTS): CoachPlaceInput => ({
  target, coachHeight, coachLeft: 490, coachRight: 950, viewportHeight: 900, topInset: 8, bottomInset: GAP, gap: GAP, canScrollUp: up, canScrollDown: down,
})

const box = (top: number, height: number, left = 16, right = 359): Box => ({ top, bottom: top + height, left, right })

/** The panel, after the scroll asked for, is clear of the coach and its top on screen; the scroll is one the menu can make. */
function clear(i: CoachPlaceInput): void {
  const at = placeCoach(i)
  const moved = scrolled(i.target, at.scroll)
  const why = JSON.stringify({ at, moved })
  expect(at.scroll, why).toBeGreaterThanOrEqual(-i.canScrollUp)
  expect(at.scroll, why).toBeLessThanOrEqual(i.canScrollDown)
  expect(overlaps(moved, coachBox(at.side, i), GAP), why).toBe(false)
  expect(moved.top, why).toBeGreaterThanOrEqual(0)
  expect(moved.top, why).toBeLessThan(i.viewportHeight)
}

describe('placeCoach', () => {
  it('stays at the top, unscrolled, when the panel is in view below it (ITEMS under IDENTITY on a phone)', () => {
    expect(placeCoach(phone(box(356, 110)))).toEqual({ side: 'top', scroll: 0 })
  })

  it('scrolls the panel out from under the top when the menu can scroll that way', () => {
    const i = phone(box(250, 110), 260, 300)
    const at = placeCoach(i)
    expect(at).toEqual({ side: 'top', scroll: 250 - (8 + 260 + GAP) })
    clear(i)
  })

  it('goes to the foot when the menu cannot scroll the panel out from under the top (ITEMS first, the menu at its start)', () => {
    const i = phone(box(162, 110), 195, 0, 1500)
    expect(placeCoach(i)).toEqual({ side: 'bottom', scroll: 0 })
    clear(i)
    // The reviewer's case: a scroll up is needed for the top, none is possible, and the foot needs a little scroll down.
    const j = phone(box(250, 350), 260, 0, 1500)
    expect(placeCoach(j).side).toBe('bottom')
    clear(j)
  })

  it('scrolls a panel that is off screen, above or below, into view', () => {
    for (const t of [box(-300, 200), box(900, 100), box(2000, 110)]) {
      clear(phone(t))
      clear(desktop(t))
      expect(placeCoach(phone(t)).scroll).not.toBe(0)
    }
  })

  it('shows the top of a panel taller than the room, under the coach at the top', () => {
    const i = phone(box(100, 700))
    const at = placeCoach(i)
    expect(at.side).toBe('top')
    expect(i.target.top - at.scroll).toBe(coachBox('top', i).bottom + GAP)
    clear(i)
  })

  it('on a desktop leaves the coach at the top, unscrolled: the left column is beside it, not under it', () => {
    expect(placeCoach(desktop(box(60, 140, 16, 336)))).toEqual({ side: 'top', scroll: 0 })
    expect(placeCoach(desktop(box(60, 140, 16, 336), 300, 0, 0))).toEqual({ side: 'top', scroll: 0 })
  })

  it('keeps clear of a menu panel wherever it is, on a phone and on a desktop, with room to scroll', () => {
    for (let top = -400; top <= 1400; top += 37) {
      for (const height of [40, 110, 240, 420, 600, 1200]) {
        clear(phone(box(top, height)))
        clear(phone(box(top, height), 180))
        clear(desktop(box(top, height, 16, 336)))
        // A desktop panel under the coach (a narrow window's stacked columns).
        clear(desktop(box(top, height, 400, 1040)))
      }
    }
  })

  it('with the scroll limited, keeps clear whenever some side and scroll the menu can make would', () => {
    for (let top = 0; top <= 800; top += 23) {
      for (const height of [40, 110, 240]) {
        for (const [up, down] of [[0, 0], [0, 2000], [2000, 0], [40, 40]]) {
          for (const i of [phone(box(top, height), 260, up, down), desktop(box(top, height, 400, 1040), 300, up, down)]) {
            // Some placement works when one side, at some scroll the menu allows, is clear.
            let possible = false
            for (let s = -up; s <= down && !possible; s += 1) possible = clearOf('top', s, i) || clearOf('bottom', s, i)
            if (possible) clear(i)
          }
        }
      }
    }
  })
})
