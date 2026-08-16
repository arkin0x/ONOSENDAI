/**
 * Targets.tsx — the HUD half of the target system.
 *
 * Reads the projections TargetProjector wrote and draws one marker per target,
 * on its own animation frame rather than through React. A marker moves whenever
 * the camera moves, which is most frames, and re-rendering the HUD tree at that
 * rate to nudge two divs would be absurd.
 *
 * In frame it is a reticle sitting on the thing. Out of frame it is a chevron
 * pinned to the nearest edge, rotated to point at it. Both carry the same label
 * and distance, so it reads as one object that is sometimes visible rather than
 * as two different indicators.
 */

import { useEffect, useRef } from 'react'
import { formatDistance } from '../lib/scale'
import { targetScreens, type CyberTarget } from '../lib/targets'

/** Keep chevrons off the very edge, where they get clipped. */
const EDGE_INSET = 26

/** Reticle bounds in pixels. Small enough to read as an annotation. */
const RING_MIN = 15
const RING_MAX = 46

interface Props {
  targets: CyberTarget[]
}

export function Targets({ targets }: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const root = host.current
      if (!root) return
      const w = root.clientWidth
      const h = root.clientHeight

      for (const t of targets) {
        const el = root.querySelector<HTMLElement>(`[data-target="${t.id}"]`)
        const s = targetScreens[t.id]
        if (!el || !s) continue

        // Normalised device coords are +y up; screen pixels are +y down.
        let px = ((s.x + 1) / 2) * w
        let py = ((1 - s.y) / 2) * h
        let angle = 0

        if (!s.onScreen) {
          // Clamp to the frame, and aim the chevron along the direction the
          // target actually lies in from the centre.
          const cx = w / 2
          const cy = h / 2
          angle = Math.atan2(py - cy, px - cx)
          px = Math.min(w - EDGE_INSET, Math.max(EDGE_INSET, px))
          py = Math.min(h - EDGE_INSET, Math.max(EDGE_INSET, py))
        }

        el.style.transform = `translate(${px}px, ${py}px)`
        el.dataset.mode = s.onScreen ? 'on' : 'off'
        const arrow = el.querySelector<HTMLElement>('.target__arrow')
        if (arrow) arrow.style.transform = `rotate(${angle}rad)`
        const ring = el.querySelector<HTMLElement>('.target__ring')
        if (ring) {
          // Hints at extent without standing in for it. Earth is already drawn
          // as a globe when you are near enough to see one, so a reticle scaled
          // to its true screen size was a 400px circle tracing something you can
          // see perfectly well, sweeping across the panels on its way. A marker
          // marks; the geometry is what shows size.
          const d = Math.max(RING_MIN, Math.min(RING_MAX, s.px * 2))
          ring.style.width = `${d}px`
          ring.style.height = `${d}px`
        }
        const dist = el.querySelector<HTMLElement>('.target__dist')
        if (dist) dist.textContent = formatDistance(s.distance)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [targets])

  return (
    <div className="targets" ref={host}>
      {targets.map((t) => (
        <div key={t.id} className="target" data-target={t.id} style={{ color: t.color }}>
          <span className="target__ring" />
          <span className="target__arrow">◤</span>
          <span className="target__text">
            <span className="target__label">{t.label}</span>
            <span className="target__dist" />
          </span>
        </div>
      ))}
    </div>
  )
}
