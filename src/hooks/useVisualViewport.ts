/**
 * useVisualViewport.ts: keep a full-screen overlay inside the part of the
 * screen that is actually showing, above a phone's keyboard.
 *
 * On iOS Safari (and Android Chrome since 108) the keyboard does not shrink
 * the layout viewport: a `position: fixed; inset: 0` overlay keeps its full
 * height, the keyboard covers its bottom, and the page is scrolled under it
 * to show the focused field. A search box pinned to the bottom of a modal
 * would sit under the keyboard. The visual viewport is the part left
 * showing; while it is shorter than the window (and not because of a pinch
 * zoom), the overlay is placed on it exactly: its top at the visual
 * viewport's top, its height the visual viewport's height. Otherwise the
 * overlay's own CSS stands.
 */

import { useEffect, type RefObject } from 'react'

/** Where the overlay goes, or null to leave its CSS alone. Pure, so a test can pin it down. */
export function visualBox(innerHeight: number, vv: { height: number; offsetTop: number; scale: number } | null | undefined): { top: number; height: number } | null {
  if (!vv) return null
  // A pinch zoom shrinks the visual viewport too; following it would squeeze the modal into the zoomed corner.
  if (vv.scale > 1.01) return null
  if (innerHeight - vv.height < 1 && vv.offsetTop < 1) return null
  return { top: Math.max(0, vv.offsetTop), height: Math.max(0, vv.height) }
}

export function useVisualViewport(ref: RefObject<HTMLElement>, active = true): void {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const el = ref.current
    if (!active || !vv || !el) return
    const reset = (): void => {
      el.style.top = ''
      el.style.height = ''
      el.style.bottom = ''
      el.style.paddingBottom = ''
    }
    const place = (): void => {
      // The layout viewport's height: on some iOS versions innerHeight shrinks with the keyboard too.
      const box = visualBox(document.documentElement.clientHeight || window.innerHeight, vv)
      if (!box) { reset(); return }
      el.style.top = `${box.top}px`
      el.style.height = `${box.height}px`
      el.style.bottom = 'auto'
      // The home bar's safe area is under the keyboard now: no inset above it.
      el.style.paddingBottom = '16px'
    }
    place()
    vv.addEventListener('resize', place)
    vv.addEventListener('scroll', place)
    return () => {
      vv.removeEventListener('resize', place)
      vv.removeEventListener('scroll', place)
      reset()
    }
  }, [ref, active])
}
