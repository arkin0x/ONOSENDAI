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
import { useProfile } from '../hooks/useProfile'
import { ProfilePic } from './ProfileBadge'

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
          // Slide along the true bearing until it meets the frame, rather than
          // clamping x and y separately. Independent clamps pull anything far
          // off-screen into a corner, so two targets in quite different
          // directions pile up in the same place and the marker stops meaning
          // "that way".
          const cx = w / 2
          const cy = h / 2
          const dx = px - cx
          const dy = py - cy
          angle = Math.atan2(dy, dx)
          const t = Math.min(
            (w / 2 - EDGE_INSET) / Math.max(Math.abs(dx), 1e-6),
            (h / 2 - EDGE_INSET) / Math.max(Math.abs(dy), 1e-6),
          )
          px = cx + dx * t
          py = cy + dy * t
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
        <TargetMarker key={t.id} target={t} />
      ))}
    </div>
  )
}

/**
 * One marker. Its position, distance, ring and chevron are driven imperatively
 * by the parent's animation frame (which finds it by data-target and reaches
 * the spans by class), so those stay in the DOM exactly where the loop expects.
 * The name and face are the reactive part: the profile arrives from the cache,
 * so a target that started as a wall of hex becomes a person without a reload.
 */
/** Real people have a 32-byte hex id; landmarks like Earth or the YOU marker
 * carry a plain word, which has no profile and no avatar. */
const IS_PUBKEY = /^[0-9a-f]{64}$/i

function TargetMarker({ target }: { target: CyberTarget }): JSX.Element {
  const person = IS_PUBKEY.test(target.id)
  const profile = useProfile(person ? target.id : null)
  const name = (person && profile?.name) || target.label
  return (
    <div className="target" data-target={target.id} style={{ color: target.color }}>
      <span className="target__ring" />
      {/* Points along +x unrotated, so a rotation by the screen bearing aims it
          at the target. The previous glyph pointed up and left, which put every
          chevron 135 degrees off. */}
      <span className="target__arrow">➤</span>
      <span className="target__body">
        {person && <ProfilePic pubkey={target.id} size={18} />}
        <span className="target__text">
          <span className="target__label">{name}</span>
          <span className="target__dist" />
        </span>
      </span>
    </div>
  )
}
