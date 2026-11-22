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

/**
 * While `on`, keeps --hud-cover-l and --hud-cover-r on the document root in
 * step with the columns inside `hudRef`; off, or on unmount, removes both.
 */
export function useMenuInset(hudRef: RefObject<HTMLElement>, on: boolean): void {
  useLayoutEffect(() => {
    const hud = hudRef.current
    if (!on || !hud) return
    const root = document.documentElement
    const shown: MenuCover = { left: -1, right: -1 }
    const measure = (): void => {
      const cover = measureMenuCover(hud, root.clientWidth)
      for (const side of ['left', 'right'] as const) {
        if (cover[side] === shown[side]) continue
        shown[side] = cover[side]
        root.style.setProperty(PROPS[side], `${cover[side]}px`)
      }
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    for (const col of hud.querySelectorAll<HTMLElement>('.hud__col')) observer?.observe(col)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      root.style.removeProperty(PROPS.left)
      root.style.removeProperty(PROPS.right)
    }
  }, [hudRef, on])
}
