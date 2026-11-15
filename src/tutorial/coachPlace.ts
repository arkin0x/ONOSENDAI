/**
 * coachPlace.ts: where the tutorial's caption panel goes so it never covers
 * the menu panel a step points at (owner, 2026-11-15: the "Your items" box
 * sat on top of ITEMS, so the panel it was about could not be seen).
 *
 * The coach sits at the top of the screen (styles.css .demo). When the panel
 * a step highlights is under it, it goes to the bottom instead, if the panel
 * is clear of the bottom; when it is clear of neither (a phone's menu, the
 * panel in the middle of a short screen), the menu scrolls the panel into the
 * room beside whichever side moves it least. Only this arithmetic lives here;
 * hud/TutorialCoach.tsx measures, scrolls and draws.
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
  /** How far above the viewport's foot the coach's bottom edge is at the bottom (clear of the menu button). */
  bottomInset: number
  /** The room kept between the coach and the panel. */
  gap: number
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

/**
 * Top when the panel is clear of the top, else bottom when it is clear of
 * the bottom, else the side whose room needs the least scroll to put the
 * panel in it (the panel's top edge first, when it is taller than the room).
 */
export function placeCoach(i: CoachPlaceInput): CoachPlacement {
  const top = coachBox('top', i)
  const bottom = coachBox('bottom', i)
  if (!overlaps(i.target, top, i.gap)) return { side: 'top', scroll: 0 }
  if (!overlaps(i.target, bottom, i.gap)) return { side: 'bottom', scroll: 0 }
  const height = i.target.bottom - i.target.top
  // The room under the coach at the top, and the room over it at the bottom.
  const underTop = { from: top.bottom + i.gap, to: i.viewportHeight }
  const overBottom = { from: 0, to: bottom.top - i.gap }
  const into = (room: { from: number; to: number }): number => {
    if (height > room.to - room.from || i.target.top < room.from) return i.target.top - room.from
    return Math.max(0, i.target.bottom - room.to)
  }
  const toTop = into(underTop)
  // A panel taller than the room over the foot would run under the coach there: the top only, its top edge under the coach.
  const toBottom = height > overBottom.to - overBottom.from ? Infinity : into(overBottom)
  return Math.abs(toTop) <= Math.abs(toBottom) ? { side: 'top', scroll: Math.round(toTop) } : { side: 'bottom', scroll: Math.round(toBottom) }
}
