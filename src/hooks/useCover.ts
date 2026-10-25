/**
 * useCover.ts - the overlays that cover the scene, measured from the DOM.
 *
 * An overlay opts in with the ref this hook returns and the edge it covers
 * from (lib/coverBand.ts). Nothing is measured unless the scene is watching
 * (setCoverWatch), which it does only while the lens shift is in use, in
 * BUILD: the pad is registered nearly all the time, and a layout read twice a
 * second through HOP, VIEW and TV bought nothing. While watched, the boxes
 * are measured when the watch begins, when one of them changes size (a
 * ResizeObserver, whose callback runs after layout, so the read is free),
 * when the window does, and twice a second, which catches a bar that moves
 * without changing size (the HOSAKA mark lifting the deploy bar). The scene
 * reads the last measurement each frame (readCovers) and never measures
 * anything itself.
 *
 * Opting in is deliberate: chips and toasts that come and go are left out, so
 * the picture does not slide every time one appears.
 */

import { useCallback, useRef } from 'react'
import type { Cover, CoverEdge } from '../lib/coverBand'

/** How often the boxes are measured again while the scene watches them, ms. */
const REMEASURE_MS = 500

const entries = new Map<HTMLElement, CoverEdge>()
let snapshot: readonly Cover[] = []
let observer: ResizeObserver | null = null
let timer: number | null = null
let watching = false

/** Measures the boxes, only while watched: otherwise the last snapshot stands until the watch begins. */
function remeasure(): void {
  if (watching) measure()
}

function measure(): void {
  const next: Cover[] = []
  for (const [el, edge] of entries) {
    const r = el.getBoundingClientRect()
    // Hidden (display: none, or under a modal's hidden wrapper) measures empty.
    if (r.width <= 0 || r.height <= 0) continue
    next.push({ edge, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
  }
  // The same boxes keep the same snapshot, so a reader can tell nothing moved.
  const same = next.length === snapshot.length && next.every((c, i) => {
    const o = snapshot[i]
    return o.edge === c.edge && o.box.left === c.box.left && o.box.top === c.box.top && o.box.right === c.box.right && o.box.bottom === c.box.bottom
  })
  if (!same) snapshot = next
}

function start(): void {
  if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(remeasure)
  window.addEventListener('resize', remeasure)
}

function stop(): void {
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', remeasure)
}

/**
 * Starts or stops measuring. On: measured at once, then on every change and
 * twice a second. Off: nothing is read until the next watch. The scene's
 * lens shift calls this as it turns on and off.
 */
export function setCoverWatch(on: boolean): void {
  if (on === watching) return
  watching = on
  if (timer !== null) window.clearInterval(timer)
  timer = null
  if (!on) return
  measure()
  timer = window.setInterval(measure, REMEASURE_MS)
}

/** The overlays over the scene as last measured, in viewport pixels. */
export function readCovers(): readonly Cover[] {
  return snapshot
}

/** Registers `el` as covering the scene from `edge`; the returned function takes it out. */
export function registerCover(el: HTMLElement, edge: CoverEdge): () => void {
  if (entries.size === 0) start()
  entries.set(el, edge)
  observer?.observe(el)
  remeasure()
  return () => {
    if (!entries.delete(el)) return
    observer?.unobserve(el)
    if (entries.size === 0) stop()
    remeasure()
  }
}

/**
 * A ref for an overlay that covers the scene from `edge`: attach it to the
 * overlay's outer element. `on` false registers nothing, for an overlay that
 * only sometimes stands over the scene (the menu's columns on a desktop).
 */
export function useCover(edge: CoverEdge, on = true): (el: HTMLElement | null) => void {
  const off = useRef<(() => void) | null>(null)
  return useCallback((el: HTMLElement | null) => {
    off.current?.()
    off.current = el && on ? registerCover(el, edge) : null
  }, [edge, on])
}
