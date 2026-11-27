/**
 * BlueprintModel.tsx - a blueprint's model as a finder sees it: the shape as
 * smoke, the revealed blocks in their real tiles, drawn isometric in world
 * axes (lib/blueprint/draw.ts drawIso). Sized for an 80px chamfered tile
 * (wrap it in ui/Chamfer) or a larger preview.
 *
 * The smoke drifts slowly, only while the model is on screen, only while
 * something is hidden, and never under reduced motion. With `onCellTap`, a
 * tap names the front-most block under the finger (draw.ts isoHit), so the
 * maker's preview can flip that block between shown and hidden.
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { TILE_IMAGES, blockCount, drawIso, hiddenCount, isoHit } from '../../lib/blueprint/draw'
import type { FinderView } from '../../lib/blueprint/format'

interface Props {
  view: FinderView
  /** Its width and height, in CSS pixels. */
  size: number
  /** A tap on a block: its scan index (format.ts cellIndex). */
  onCellTap?: (index: number) => void
  className?: string
  /** Its accessible name; by default how many blocks it shows. */
  label?: string
}

/** The smoke's frame interval while it drifts: slow motion needs no more than 30 a second. */
const SMOKE_FRAME_MS = 33

export function BlueprintModel({ view, size, onCellTap, className, label }: Props): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()
  const [onScreen, setOnScreen] = useState(true)
  const hidden = useMemo(() => hiddenCount(view), [view])
  const total = useMemo(() => blockCount(view), [view])
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)

  const paint = (phase: number): void => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    drawIso(ctx, view, { x: 0, y: 0, size, smokePhase: phase })
  }
  const paintRef = useRef(paint)
  paintRef.current = paint

  // Drawn once now, and again as each tile picture arrives.
  useEffect(() => {
    paintRef.current(reduced ? 0 : performance.now() / 1000)
    return TILE_IMAGES.onLoad(() => paintRef.current(reduced ? 0 : performance.now() / 1000))
  }, [view, size, dpr, reduced])

  useEffect(() => {
    const cv = ref.current
    if (!cv || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setOnScreen(es.some((e) => e.isIntersecting)))
    io.observe(cv)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (reduced || !onScreen || hidden === 0 || typeof requestAnimationFrame === 'undefined') return
    let raf = 0
    let last = 0
    const tick = (now: number): void => {
      if (now - last >= SMOKE_FRAME_MS) { last = now; paintRef.current(now / 1000) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduced, onScreen, hidden])

  const tap = (e: MouseEvent<HTMLCanvasElement>): void => {
    if (!onCellTap) return
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width || !r.height) return
    const hit = isoHit(view, { x: 0, y: 0, size }, ((e.clientX - r.left) * size) / r.width, ((e.clientY - r.top) * size) / r.height)
    if (hit !== null) onCellTap(hit)
  }

  const shown = total - hidden
  return (
    <canvas
      ref={ref}
      className={`bp-model${onCellTap ? ' bp-model--tap' : ''}${className ? ` ${className}` : ''}`}
      width={Math.round(size * dpr)}
      height={Math.round(size * dpr)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `Blueprint model: ${shown} of ${total} blocks shown`}
      title={onCellTap ? 'Tap a block to flip it' : undefined}
      onClick={onCellTap ? tap : undefined}
    />
  )
}
