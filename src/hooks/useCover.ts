/**
 * useCover.ts - the overlays that cover the scene, measured from the DOM.
 *
 * An overlay opts in with the ref this hook returns and the edge it covers
 * from (lib/coverBand.ts). Nothing is measured unless someone is watching
 * (setCoverWatch): the scene, only while the lens shift is in use in BUILD
 * (the pad is registered nearly all the time, and a layout read twice a
 * second through HOP, VIEW and TV bought nothing for the framing), and the
 * target markers, while there are any and the workshop is closed, so a
 * chevron stops beside the menu instead of drawing over it (hud/Targets.tsx).
 * With only the markers watching, the covers they ignore (the pad) are not
 * measured at all. While watched, the boxes
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
import { whileVisible } from '../lib/whileVisible'

/** How often the boxes are measured again while anyone watches them, ms. */
const REMEASURE_MS = 500

/** What an overlay says about itself when it opts in. */
interface Entry {
  edge: CoverEdge
  /** Whether the target markers keep clear of it (Cover.markers). */
  markers: boolean
}

const entries = new Map<HTMLElement, Entry>()
let snapshot: readonly Cover[] = []
let observer: ResizeObserver | null = null
let timer: number | null = null
let watching = false
/** Who is watching: the boxes are measured while anyone is. */
const watchers = new Set<string>()

/** Measures the boxes, only while watched: otherwise the last snapshot stands until the watch begins. */
function remeasure(): void {
  if (watching) measure()
}

function measure(): void {
  const next: Cover[] = []
  // The markers alone have no use for the covers they do not keep clear of.
  const all = watchers.has('lens') || [...watchers].some((w) => w !== 'targets')
  for (const [el, { edge, markers }] of entries) {
    if (!markers && !all) continue
    const r = el.getBoundingClientRect()
    // Hidden (display: none, or under a modal's hidden wrapper) measures empty.
    if (r.width <= 0 || r.height <= 0) continue
    const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    next.push(markers ? { edge, box } : { edge, box, markers: false })
  }
  // The same boxes keep the same snapshot, so a reader can tell nothing moved.
  const same = next.length === snapshot.length && next.every((c, i) => {
    const o = snapshot[i]
    return o.edge === c.edge && o.markers === c.markers && o.box.left === c.box.left && o.box.top === c.box.top && o.box.right === c.box.right && o.box.bottom === c.box.bottom
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
 * Starts or stops `who`'s watch (the scene's lens shift by default; the
 * target markers as 'targets'). While anyone watches: measured at once, then
 * on every change and twice a second. Once nobody does: nothing is read
 * until the next watch. One watcher ending never stops another's.
 */
export function setCoverWatch(on: boolean, who = 'lens'): void {
  if (on) watchers.add(who)
  else watchers.delete(who)
  const any = watchers.size > 0
  if (any === watching) {
    // Someone else joined or left: the covers worth measuring may have changed.
    if (any) measure()
    return
  }
  watching = any
  if (timer !== null) window.clearInterval(timer)
  timer = null
  if (!any) return
  measure()
  timer = window.setInterval(whileVisible(measure), REMEASURE_MS)
}

/** The overlays over the scene as last measured, in viewport pixels. */
export function readCovers(): readonly Cover[] {
  return snapshot
}

/**
 * Registers `el` as covering the scene from `edge`; the returned function
 * takes it out. `markers` false for an overlay the target markers need not
 * keep clear of (CoverOptions).
 */
export function registerCover(el: HTMLElement, edge: CoverEdge, markers = true): () => void {
  if (entries.size === 0) start()
  entries.set(el, { edge, markers })
  observer?.observe(el)
  remeasure()
  return () => {
    if (!entries.delete(el)) return
    observer?.unobserve(el)
    if (entries.size === 0) stop()
    remeasure()
  }
}

/** How an overlay takes part, beyond the edge it covers from. */
export interface CoverOptions {
  /**
   * Whether the target markers stop short of it (hud/Targets.tsx); true
   * unless said otherwise. False for the pad: it folds and comes back with
   * every tap on the scene, and a marker that dodged it would jump between
   * the screen's foot and the middle each time; the deploy bar too, which
   * docks beside the pad and narrows as it folds. A marker under them is
   * under them, as it always was (both draw over the markers).
   */
  markers?: boolean
}

/**
 * A ref for an overlay that covers the scene from `edge`: attach it to the
 * overlay's outer element. `on` false registers nothing, for an overlay that
 * only sometimes stands over the scene (the menu's columns on a desktop).
 */
export function useCover(edge: CoverEdge, on = true, { markers = true }: CoverOptions = {}): (el: HTMLElement | null) => void {
  const off = useRef<(() => void) | null>(null)
  return useCallback((el: HTMLElement | null) => {
    off.current?.()
    off.current = el && on ? registerCover(el, edge, markers) : null
  }, [edge, on, markers])
}
