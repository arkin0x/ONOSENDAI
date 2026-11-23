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
 *
 * Never over the menu (owner, 2026-11-23: "can we make these target markers
 * not go over the menus?"). The layer sits under the HUD, so a panel always
 * draws over a marker (styles.css). And a chevron stops short of the panels
 * and the other overlays BUILD's framing measures (hooks/useCover), in the
 * part of the screen they leave uncovered, so it stays in sight instead of
 * going under them (lib/markerClear). A target on screen but behind a panel
 * is pointed at from the panel's edge the same way.
 */

import { useEffect, useRef } from 'react'
import { formatDistance } from 'sno-core/scale'
import { targetScreens, viewAxis, type CyberTarget } from '../lib/targets'
import { labelDrop } from '../lib/avatarLabel'
import { edgePlace, hiddenByCover, type Reach } from '../lib/markerClear'
import type { Box, Cover } from '../lib/coverBand'
import { readCovers, setCoverWatch } from '../hooks/useCover'
import { useProfile } from '../hooks/useProfile'
import { ProfilePic } from './ProfileBadge'

/** Keep chevrons off the very edge, where they get clipped. */
const EDGE_INSET = 26

/**
 * How far the chevron reaches from the marker's point, turned any way: the
 * 13px glyph about the point, with a margin.
 */
const CHEVRON: Reach = { left: -10, top: -10, right: 10, bottom: 10 }

/** The name and distance's width before it has been measured, px. */
const BODY_GUESS = 96

/**
 * The name and distance's measured width is rounded up to this many pixels,
 * so a distance ticking from 31.1 to 31.2 nm does not nudge a chevron that
 * stands beside a panel on the right.
 */
const BODY_STEP = 16

/**
 * How far a marker off screen reaches from its point, its name and distance
 * as well as the chevron: the body stands 14px right of the point
 * (styles.css .target__body), centred on it vertically.
 */
function reachFor(bodyWidth: number, bodyHeight: number): Reach {
  const w = Math.ceil(bodyWidth / BODY_STEP) * BODY_STEP
  const half = Math.max(CHEVRON.bottom, Math.ceil(bodyHeight / 2) + 2)
  return { left: CHEVRON.left, top: -half, right: Math.max(CHEVRON.right, 14 + w + 4), bottom: half }
}

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
  /** How far the marker reaches off screen, from its name's measured size. */
  reach: Reach
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
  // The name and distance's size, from a ResizeObserver (its callback runs
  // after layout, so the read is free), never read inside the frame.
  const sizer = useRef<ResizeObserver | null>(null)
  const byBody = useRef(new Map<Element, Written>())
  // The covers in this layer's pixels, worked out again only when the
  // measurement or the layer's size changes.
  const local = useRef<{ from: readonly Cover[] | null; w: number; h: number; boxes: Box[] }>({ from: null, w: 0, h: 0, boxes: [] })

  // The overlays are measured while the markers are up (hooks/useCover).
  useEffect(() => {
    setCoverWatch(true, 'targets')
    return () => {
      setCoverWatch(false, 'targets')
      sizer.current?.disconnect()
      sizer.current = null
      byBody.current.clear()
    }
  }, [])

  useEffect(() => {
    let raf = 0
    const kept = written.current
    const bodies = byBody.current
    const ids = new Set(targets.map((t) => t.id))
    const forget = (m: Written): void => {
      if (!m.body) return
      bodies.delete(m.body)
      sizer.current?.unobserve(m.body)
    }
    for (const [id, m] of kept) if (!ids.has(id)) { forget(m); kept.delete(id) }
    if (!sizer.current && typeof ResizeObserver !== 'undefined') {
      sizer.current = new ResizeObserver((entries) => {
        for (const e of entries) {
          const m = bodies.get(e.target)
          if (m) m.reach = reachFor(e.contentRect.width, e.contentRect.height)
        }
      })
    }
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const root = host.current
      if (!root) return
      const w = root.clientWidth
      const h = root.clientHeight
      const covers = readCovers()
      const lc = local.current
      if (lc.from !== covers || lc.w !== w || lc.h !== h) {
        // Measured in viewport pixels; this layer's are from its own corner.
        const o = covers.length ? root.getBoundingClientRect() : { left: 0, top: 0 }
        lc.from = covers
        lc.w = w
        lc.h = h
        // Not the pad (hooks/useCover CoverOptions).
        lc.boxes = covers.filter((c) => c.markers !== false).map(({ box }) => ({ left: box.left - o.left, top: box.top - o.top, right: box.right - o.left, bottom: box.bottom - o.top }))
      }
      const boxes = lc.boxes
      // The picture's middle, which BUILD's lens shift moves off the window's
      // (lib/targets viewAxis): an off-screen marker points from here.
      const cx = ((viewAxis.x + 1) / 2) * w
      const cy = ((1 - viewAxis.y) / 2) * h

      for (const t of targets) {
        const s = targetScreens[t.id]
        if (!s) continue
        let m = kept.get(t.id)
        if (!m || !m.el.isConnected) {
          const el = root.querySelector<HTMLElement>(`[data-target="${t.id}"]`)
          if (!el) continue
          if (m) forget(m)
          m = {
            el,
            body: el.querySelector<HTMLElement>('.target__body'),
            arrow: el.querySelector<HTMLElement>('.target__arrow'),
            ring: el.querySelector<HTMLElement>('.target__ring'),
            dist: el.querySelector<HTMLElement>('.target__dist'),
            reach: reachFor(BODY_GUESS, 20),
            last: {},
          }
          kept.set(t.id, m)
          if (m.body) {
            bodies.set(m.body, m)
            sizer.current?.observe(m.body)
          }
        }
        const { el, body, arrow, ring, dist, last } = m

        // The avatar as drawn, when it is drawn and on screen: the marker sits
        // on its middle and the name and picture hang under its lowest point
        // (lib/avatarLabel; arkinox, 2026-10-11). Otherwise the marker is the
        // raw coordinate, as for Earth or a target out of the field.
        const a = s.avatar
        const drawn = !!a && Math.abs(a.x) <= 1 && Math.abs(a.y) <= 1

        // Normalised device coords are +y up; screen pixels are +y down.
        let px = ((drawn && a ? a.x : s.x) + 1) / 2 * w
        let py = ((1 - (drawn && a ? a.y : s.y)) / 2) * h
        let angle = 0

        // On screen but behind a panel, it is out of sight as surely as off
        // the edge: pointed at from the panel's side instead.
        const shown = (s.onScreen || drawn) && !(boxes.length > 0 && hiddenByCover(px, py, cx, cy, boxes, CHEVRON))
        const under = drawn && shown

        if (!shown) {
          // Slide along the true bearing until it meets the frame or a panel,
          // rather than clamping x and y separately. Independent clamps pull
          // anything far off-screen into a corner, so two targets in quite
          // different directions pile up in the same place and the marker
          // stops meaning "that way" (lib/markerClear).
          const p = edgePlace(w, h, cx, cy, px, py, EDGE_INSET, boxes, m.reach, CHEVRON)
          px = p.x
          py = p.y
          angle = p.angle
        }

        const transform = `translate(${px}px, ${py}px)`
        if (last.transform !== transform) {
          last.transform = transform
          el.style.transform = transform
        }
        const mode = shown ? 'on' : 'off'
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
