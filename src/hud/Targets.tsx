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
import { formatDistance } from 'sno-core/scale'
import { targetScreens, viewAxis, type CyberTarget } from '../lib/targets'
import { labelDrop } from '../lib/avatarLabel'
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

/** One marker's elements, found once, and the values last written to them. */
interface Written {
  el: HTMLElement
  body: HTMLElement | null
  arrow: HTMLElement | null
  ring: HTMLElement | null
  dist: HTMLElement | null
  last: {
    transform?: string
    mode?: string
    under?: string
    top?: string
    arrow?: string
    ring?: string
    dist?: string
  }
}

export function Targets({ targets }: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  // Each marker's elements and what it was last given, so a frame writes
  // only what changed. Every write used to happen every frame, the distance
  // text included: replacing a text node is a layout and a repaint of that
  // marker's layer (each is its own, will-change: transform), so a still
  // view with forty people in it re-rastered forty markers a frame
  // (arkinox, 2026-10-20: the laptop "still isn't great"; a Chrome trace of
  // a loaded scene). Kept across the effect's runs: the target list is
  // rebuilt whenever anyone nearby moves, and starting over then would
  // rewrite every marker each time.
  const written = useRef(new Map<string, Written>())

  useEffect(() => {
    let raf = 0
    const kept = written.current
    const ids = new Set(targets.map((t) => t.id))
    for (const id of kept.keys()) if (!ids.has(id)) kept.delete(id)
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const root = host.current
      if (!root) return
      const w = root.clientWidth
      const h = root.clientHeight

      for (const t of targets) {
        const s = targetScreens[t.id]
        if (!s) continue
        let m = kept.get(t.id)
        if (!m || !m.el.isConnected) {
          const el = root.querySelector<HTMLElement>(`[data-target="${t.id}"]`)
          if (!el) continue
          m = {
            el,
            body: el.querySelector<HTMLElement>('.target__body'),
            arrow: el.querySelector<HTMLElement>('.target__arrow'),
            ring: el.querySelector<HTMLElement>('.target__ring'),
            dist: el.querySelector<HTMLElement>('.target__dist'),
            last: {},
          }
          kept.set(t.id, m)
        }
        const { el, body, arrow, ring, dist, last } = m

        // The avatar as drawn, when it is drawn and on screen: the marker sits
        // on its middle and the name and picture hang under its lowest point
        // (lib/avatarLabel; arkinox, 2026-10-11). Otherwise the marker is the
        // raw coordinate, as for Earth or a target out of the field.
        const a = s.avatar
        const under = !!a && Math.abs(a.x) <= 1 && Math.abs(a.y) <= 1

        // Normalised device coords are +y up; screen pixels are +y down.
        let px = ((under && a ? a.x : s.x) + 1) / 2 * w
        let py = ((1 - (under && a ? a.y : s.y)) / 2) * h
        let angle = 0

        if (!s.onScreen && !under) {
          // Slide along the true bearing until it meets the frame, rather than
          // clamping x and y separately. Independent clamps pull anything far
          // off-screen into a corner, so two targets in quite different
          // directions pile up in the same place and the marker stops meaning
          // "that way". From the picture's middle, which BUILD's lens shift
          // moves off the window's (lib/targets viewAxis).
          const cx = ((viewAxis.x + 1) / 2) * w
          const cy = ((1 - viewAxis.y) / 2) * h
          const dx = px - cx
          const dy = py - cy
          angle = Math.atan2(dy, dx)
          // How far the frame's inset edge is from the middle, the way the line goes.
          const reachX = dx >= 0 ? w - EDGE_INSET - cx : cx - EDGE_INSET
          const reachY = dy >= 0 ? h - EDGE_INSET - cy : cy - EDGE_INSET
          const t = Math.max(0, Math.min(
            reachX / Math.max(Math.abs(dx), 1e-6),
            reachY / Math.max(Math.abs(dy), 1e-6),
          ))
          px = cx + dx * t
          py = cy + dy * t
        }

        const transform = `translate(${px}px, ${py}px)`
        if (last.transform !== transform) {
          last.transform = transform
          el.style.transform = transform
        }
        const mode = s.onScreen || under ? 'on' : 'off'
        if (last.mode !== mode) {
          last.mode = mode
          el.dataset.mode = mode
        }
        const underText = under ? 'yes' : 'no'
        if (last.under !== underText) {
          last.under = underText
          el.dataset.under = underText
        }
        if (body) {
          const top = under && a ? `${labelDrop(a, h, RING_MIN / 2)}px` : ''
          if (last.top !== top) {
            last.top = top
            body.style.top = top
          }
        }
        if (arrow) {
          const turn = `rotate(${angle}rad)`
          if (last.arrow !== turn) {
            last.arrow = turn
            arrow.style.transform = turn
          }
        }
        if (ring) {
          // Hints at extent without standing in for it. Earth is already drawn
          // as a globe when you are near enough to see one, so a reticle scaled
          // to its true screen size was a 400px circle tracing something you can
          // see perfectly well, sweeping across the panels on its way. A marker
          // marks; the geometry is what shows size.
          const d = `${Math.max(RING_MIN, Math.min(RING_MAX, s.px * 2))}px`
          if (last.ring !== d) {
            last.ring = d
            ring.style.width = d
            ring.style.height = d
          }
        }
        if (dist) {
          const text = formatDistance(s.distance)
          if (last.dist !== text) {
            last.dist = text
            dist.textContent = text
          }
        }
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
 * by the parent's animation frame, which finds it by data-target and reaches
 * the spans by class once per marker element, then keeps them: so those spans
 * are always rendered and never replaced while the marker stands.
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
    <div className={`target${target.presence ? ' target--presence' : ''}`} data-target={target.id} style={{ color: target.color }}>
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
