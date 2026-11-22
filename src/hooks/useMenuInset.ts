/**
 * useMenuInset.ts - how far the open menu's columns reach over the scene,
 * written where the stylesheet can read it.
 *
 * On a desktop or a tablet held sideways the HUD's controls stand at the
 * screen's edges, and the open menu's columns cover both edges (owner,
 * 2026-11-22). While the menu is open beside the scene this measures the
 * columns' inner edges, in viewport pixels from their own side of the
 * screen, into --hud-cover-l and --hud-cover-r on the document root; the
 * stylesheet turns them into the shifts that slide every control inboard
 * ("The HUD's edges and the open menu" in styles.css). Closed, or as the
 * menu unmounts, both are taken away and the controls slide back out.
 *
 * Layout boxes, not transformed ones: offsetLeft and offsetWidth inside the
 * .hud, which stands at the viewport's origin, so a column caught mid-way
 * through any animation of its own still measures where it will rest.
 * Measured again whenever a column changes size and whenever the window
 * does; a value that has not changed is not written, so nothing restyles.
 *
 * The open and the close also set data-hud-slide on the root for a moment,
 * which is what lets the controls' slide run; nothing else animates them
 * (see the stylesheet's note on why a mode change must not).
 */

import { useLayoutEffect, type RefObject } from 'react'

/** The columns' reach over the scene, in CSS pixels from their own edge. */
export interface MenuCover {
  left: number
  right: number
}

/**
 * How far the columns inside `hud` reach: the left column's right edge
 * from the screen's left, the right column's left edge from the screen's
 * right. A missing or hidden column reaches nowhere.
 */
export function measureMenuCover(hud: HTMLElement, viewportWidth: number): MenuCover {
  const origin = hud.getBoundingClientRect().left
  const reach = (side: 'left' | 'right'): number => {
    const col = hud.querySelector<HTMLElement>(`.hud__col--${side}`)
    if (!col || col.offsetWidth <= 0) return 0
    const start = origin + col.offsetLeft
    return side === 'left' ? start + col.offsetWidth : viewportWidth - start
  }
  return { left: Math.max(0, Math.round(reach('left'))), right: Math.max(0, Math.round(reach('right'))) }
}

const PROPS = { left: '--hud-cover-l', right: '--hud-cover-r' } as const

/** The root attribute that lets the controls' slide run (styles.css). */
export const SLIDE_ATTR = 'data-hud-slide'

/**
 * How long the slide stays allowed once it has started, ms: its 240ms and a
 * margin. Counted from two frames after the open or close, by which time the
 * slide has begun: opening mounts every panel, and that first frame
 * can be long. Taking the attribute away while a slide still runs would cut
 * it short and the controls would jump to the end.
 */
export const SLIDE_MS = 400

/** What the watch touches, so a test can hand it stand-ins. */
export interface InsetHost {
  root: HTMLElement
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout' | 'requestAnimationFrame'>
  Observer?: typeof ResizeObserver
}

// Whether the page has painted once. A menu open at load measures before the
// first paint, and the controls start inside the columns without a slide.
let painted = false
let slideTimer: number | null = null
// Which open or close the pending removal belongs to: a newer one supersedes it.
let slideRun = 0

/** Lets the slide run until SLIDE_MS after it has started, once the page has painted. */
function allowSlide(host: InsetHost): void {
  if (!painted) return
  const { root, win } = host
  const run = ++slideRun
  root.setAttribute(SLIDE_ATTR, '')
  if (slideTimer !== null) win.clearTimeout(slideTimer)
  slideTimer = null
  win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
    if (run !== slideRun) return
    slideTimer = win.setTimeout(() => { slideTimer = null; if (run === slideRun) root.removeAttribute(SLIDE_ATTR) }, SLIDE_MS)
  }))
}

/**
 * Counts the page as painted two frames from now. App calls it once from an
 * effect after its first commit, which comes after the layout effect of a
 * menu open at load, so that one never slides and every later open does.
 */
export function armMenuSlide(): void {
  if (painted || typeof window === 'undefined') return
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => { painted = true }))
}

/** For tests: whether the page counts as painted. */
export function setPaintedForTest(on: boolean): void {
  painted = on
}

/**
 * Keeps --hud-cover-l and --hud-cover-r on `host.root` in step with the
 * columns inside `hud` until the returned function is called, which takes
 * both away. The first write (the menu opening) and the clearing (closing)
 * let the controls slide; a later re-measure (a resize) moves them at once.
 */
export function watchMenuInset(hud: HTMLElement, host: InsetHost): () => void {
  const { root, win } = host
  const shown: MenuCover = { left: -1, right: -1 }
  const measure = (): void => {
    const cover = measureMenuCover(hud, root.clientWidth)
    for (const side of ['left', 'right'] as const) {
      if (cover[side] === shown[side]) continue
      shown[side] = cover[side]
      root.style.setProperty(PROPS[side], `${cover[side]}px`)
    }
  }
  allowSlide(host)
  measure()
  const observer = host.Observer ? new host.Observer(measure) : null
  for (const col of hud.querySelectorAll<HTMLElement>('.hud__col')) observer?.observe(col)
  win.addEventListener('resize', measure)
  return () => {
    observer?.disconnect()
    win.removeEventListener('resize', measure)
    allowSlide(host)
    root.style.removeProperty(PROPS.left)
    root.style.removeProperty(PROPS.right)
  }
}

/**
 * While `on`, keeps --hud-cover-l and --hud-cover-r on the document root in
 * step with the columns inside `hudRef`; off, or on unmount, removes both.
 */
export function useMenuInset(hudRef: RefObject<HTMLElement>, on: boolean): void {
  useLayoutEffect(() => {
    const hud = hudRef.current
    if (!on || !hud) return
    return watchMenuInset(hud, {
      root: document.documentElement,
      win: window,
      Observer: typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined,
    })
  }, [hudRef, on])
}
