/**
 * coachPlace.ts: where the tutorial's caption panel goes so it never covers
 * the menu panel a step points at (owner, 2026-11-15: the "Your items" box
 * sat on top of ITEMS, so the panel it was about could not be seen).
 *
 * The coach sits at the top of the screen (styles.css .demo). It stays there
 * when the panel is in view and clear of it, or can be scrolled there; it
 * goes to the foot only when no scroll the menu can make clears the top (the
 * panel near the top of a phone's menu, which cannot scroll up past its
 * start). Only this arithmetic lives here; hud/TutorialCoach.tsx measures,
 * scrolls and draws.
 */

/** A box on screen, in CSS pixels from the viewport's top left. */
export interface Box { top: number; bottom: number; left: number; right: number }

export type CoachSide = 'top' | 'bottom'

export interface CoachPlaceInput {
  /** The highlighted panel (or what of it is highlighted), as it is now. */
  target: Box
  /** The coach's height as drawn. */
  coachHeight: number
  /** The coach's left and right edges (it is centred, and the side does not move it across). */
  coachLeft: number
  coachRight: number
  viewportHeight: number
  /** Where the coach's top edge is at the top (the safe area and its margin). */
  topInset: number
  /** How far above the viewport's foot the coach's bottom edge is at the bottom (the safe area, and clear of what is docked there). */
  bottomInset: number
  /** The room kept between the coach and the panel. */
  gap: number
  /** How far the panel's scroller can still scroll up (its scrollTop) and down; 0 for both when nothing scrolls it. */
  canScrollUp: number
  canScrollDown: number
}

export interface CoachPlacement {
  side: CoachSide
  /** How far to scroll the panel's scroller first, px (positive scrolls down, moving the panel up); 0 for none. */
  scroll: number
}

/** The coach's box on `side`. */
export function coachBox(side: CoachSide, i: Pick<CoachPlaceInput, 'coachHeight' | 'coachLeft' | 'coachRight' | 'viewportHeight' | 'topInset' | 'bottomInset'>): Box {
  const top = side === 'top' ? i.topInset : i.viewportHeight - i.bottomInset - i.coachHeight
  return { top, bottom: top + i.coachHeight, left: i.coachLeft, right: i.coachRight }
}

/** Whether two boxes overlap, `gap` apart counting as touching. */
export function overlaps(a: Box, b: Box, gap = 0): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom + gap && b.top < a.bottom + gap
}

/** `box` moved by a scroll of `scroll` px. */
export function scrolled(box: Box, scroll: number): Box {
  return { ...box, top: box.top - scroll, bottom: box.bottom - scroll }
}

/** Whether the panel, moved by `scroll`, is clear of the coach on `side` and its top on screen. */
export function clearOf(side: CoachSide, scroll: number, i: CoachPlaceInput): boolean {
  const moved = scrolled(i.target, scroll)
  return !overlaps(moved, coachBox(side, i), i.gap) && moved.top >= 0 && moved.top < i.viewportHeight
}

/**
 * Top when the panel is (or can be scrolled) clear of the coach there and
 * on screen, else the foot, else the top as near as the scroll allows. For
 * each side, the scroll asked for is the least that puts the panel in the
 * room the coach leaves (the whole height when the coach is beside it, not
 * over it), or its top edge at the room's top when it is taller than the
 * room; never more than the scroller can do.
 */
export function placeCoach(i: CoachPlaceInput): CoachPlacement {
  const height = i.target.bottom - i.target.top
  const across = i.target.left < i.coachRight && i.coachLeft < i.target.right
  const scrollFor = (side: CoachSide): number => {
    const coach = coachBox(side, i)
    const room = !across ? { from: 0, to: i.viewportHeight }
      : side === 'top' ? { from: coach.bottom + i.gap, to: i.viewportHeight } : { from: 0, to: coach.top - i.gap }
    let want = 0
    if (height > room.to - room.from || i.target.top < room.from) want = i.target.top - room.from
    else if (i.target.bottom > room.to) want = i.target.bottom - room.to
    return Math.round(Math.max(-i.canScrollUp, Math.min(i.canScrollDown, want)))
  }
  const top = scrollFor('top')
  if (clearOf('top', top, i)) return { side: 'top', scroll: top }
  const bottom = scrollFor('bottom')
  if (clearOf('bottom', bottom, i)) return { side: 'bottom', scroll: bottom }
  return { side: 'top', scroll: top }
}
