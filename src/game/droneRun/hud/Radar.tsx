/**
 * Radar.tsx - DRONE RUN's radar: a small round map in the top left corner,
 * under the HP pips, on phones and desktops alike.
 *
 * - A dark see-through disc with a thin ring; you at the centre, a small
 *   chevron pointing forward.
 * - It turns with you: forward is always up, right on screen is right.
 * - Drones are dots in their eyes' colours (a palette by enemy id). Its
 *   reach is the drones' sight (the variant's largest `detect`, else the
 *   fog's far edge); a drone farther than that sits on the rim, in its
 *   direction.
 * - The end zone is a small gold diamond: on the rim in its direction, or
 *   inside when it is within reach.
 *
 * It draws on a 2D canvas each screen frame from the run on screen
 * (runner.ts activeRunner) and the look (input.ts lookState), read only: no
 * store is touched, and nothing is allocated per frame once the variant's
 * colours are made. There is no sweep or blink, so reduced motion changes
 * nothing. Ledger class (c), client.
 */

import { useEffect, useRef } from 'react'
import type { DroneRunVariant, RunState } from '../../../lib/games/droneRun/sim'
import { lookState } from '../input'
import { activeRunner } from '../runner'

/** A point on the radar, CSS px from its centre (y down), and whether it was held to the rim. */
export interface RadarPoint { x: number; y: number; clamped: boolean }

/** Where the reach ends when the variant does not say, gibsons (the base variant's sight and fog). */
export const RADAR_RANGE_DEFAULT = 55
/** How far in from the rim the dots and the end zone sit when held to it, CSS px. */
export const RADAR_INSET = 5

/**
 * Where a thing at (tx, tz) lands on a radar of `radiusPx`, for a player at
 * (px, pz) looking along screen yaw `yaw` (input.ts: 0 faces -Z, positive
 * turns left), with `range` gibsons at the rim less RADAR_INSET. Forward is
 * up and right on screen is right (the simulation's forward (sin y, -cos y)
 * and right (-cos y, -sin y), sim/fluid.ts). Writes into `out`.
 */
export function radarPoint(px: number, pz: number, yaw: number, tx: number, tz: number, range: number, radiusPx: number, out: RadarPoint): RadarPoint {
  const dx = tx - px
  const dz = tz - pz
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  const ahead = dx * s - dz * c
  const right = -dx * c - dz * s
  const reach = Math.max(1, radiusPx - RADAR_INSET)
  const d = Math.hypot(ahead, right)
  const k = range > 0 ? reach / range : 0
  if (d * k > reach && d > 0) {
    out.x = (right / d) * reach
    out.y = (-ahead / d) * reach
    out.clamped = true
  } else {
    out.x = right * k
    out.y = -ahead * k
    out.clamped = false
  }
  return out
}

/** The drones' eye colours (their models' glowing points), by enemy id; anything else is white. */
export const RADAR_COLORS: Readonly<Record<string, string>> = {
  scout: 'rgb(255, 31, 61)',
  sniper: 'rgb(63, 240, 255)',
  heavy: 'rgb(255, 138, 74)',
  swarmer: 'rgb(255, 138, 153)',
}
const RADAR_GOLD = 'rgb(255, 201, 74)'

/** A variant's radar facts, made once: the reach, and each enemy def's dot colour and size. */
interface Facts { range: number; colors: string[]; sizes: number[] }
const factsBy = new WeakMap<DroneRunVariant, Facts>()

/** The reach (gibsons) for a variant: its drones' largest sight, else the fog's far edge, else RADAR_RANGE_DEFAULT. */
export function radarRange(v: Pick<DroneRunVariant, 'spec' | 'client'>): number {
  let r = 0
  for (const e of v.spec.enemies) if (e.detect > r) r = e.detect
  if (r > 0) return r
  const far = (v.client as { fog?: { far?: number } } | undefined)?.fog?.far
  return typeof far === 'number' && far > 0 ? far : RADAR_RANGE_DEFAULT
}

function factsOf(v: DroneRunVariant): Facts {
  let f = factsBy.get(v)
  if (!f) {
    f = {
      range: radarRange(v),
      colors: v.spec.enemies.map((e) => RADAR_COLORS[e.id] ?? '#fff'),
      // A big drone a bigger dot: from 1.6 px (a swarmer) to 3.2 px (a heavy).
      sizes: v.spec.enemies.map((e) => Math.max(1.6, Math.min(3.2, 1.2 + e.radius * 1.6))),
    }
    factsBy.set(v, f)
  }
  return f
}

/** The part of a 2D context the radar draws with, so a test can hand it a recorder. */
export type RadarCtx = Pick<CanvasRenderingContext2D, 'setTransform' | 'clearRect' | 'beginPath' | 'arc' | 'fill' | 'stroke' | 'moveTo' | 'lineTo' | 'closePath'> & {
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
}

const pt: RadarPoint = { x: 0, y: 0, clamped: false }

/** Draw the radar, `size` CSS px across at `dpr` device pixels each, for the run `st` (null: the empty disc and you). */
export function drawRadar(g: RadarCtx, size: number, dpr: number, st: RunState | null, yaw: number): void {
  const r = size / 2
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, size, size)
  // The disc, its ring, and a faint ring at half reach.
  g.beginPath()
  g.arc(r, r, r - 1, 0, Math.PI * 2)
  g.fillStyle = 'rgba(6, 14, 22, 0.6)'
  g.fill()
  g.lineWidth = 1
  g.strokeStyle = 'rgba(255, 255, 255, 0.55)'
  g.stroke()
  g.beginPath()
  g.arc(r, r, (r - RADAR_INSET) / 2, 0, Math.PI * 2)
  g.strokeStyle = 'rgba(255, 255, 255, 0.14)'
  g.stroke()

  if (st) {
    const f = factsOf(st.world.variant)
    const px = st.body.pos[0], pz = st.body.pos[2]
    // The end zone: its box's middle.
    const fin = st.world.level.finish
    radarPoint(px, pz, yaw, (fin.lo[0] + fin.hi[0]) / 2, (fin.lo[2] + fin.hi[2]) / 2, f.range, r, pt)
    const ex = r + pt.x, ey = r + pt.y, s = 4
    g.beginPath()
    g.moveTo(ex, ey - s); g.lineTo(ex + s, ey); g.lineTo(ex, ey + s); g.lineTo(ex - s, ey); g.closePath()
    g.fillStyle = RADAR_GOLD
    g.fill()
    g.lineWidth = 1
    g.strokeStyle = 'rgba(0, 0, 0, 0.8)'
    g.stroke()
    // The drones.
    const ds = st.drones
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i]
      if (d.hp <= 0) continue
      radarPoint(px, pz, yaw, d.pos[0], d.pos[2], f.range, r, pt)
      g.beginPath()
      g.arc(r + pt.x, r + pt.y, f.sizes[d.def] ?? 2, 0, Math.PI * 2)
      g.fillStyle = f.colors[d.def] ?? '#fff'
      g.fill()
    }
  }

  // You: a white chevron pointing up (forward).
  g.beginPath()
  g.moveTo(r, r - 6); g.lineTo(r + 4.5, r + 4); g.lineTo(r, r + 1.5); g.lineTo(r - 4.5, r + 4); g.closePath()
  g.fillStyle = '#fff'
  g.fill()
  g.lineWidth = 1
  g.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  g.stroke()
}

export function Radar(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    // A renderer with no DOM (tests) has no canvas to draw on.
    if (!c || typeof c.getContext !== 'function' || typeof requestAnimationFrame !== 'function') return
    const g = c.getContext('2d')
    if (!g) return
    let size = 0
    let dpr = 1
    const fit = (): void => {
      size = c.clientWidth || 96
      dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
      const px = Math.round(size * dpr)
      if (c.width !== px) { c.width = px; c.height = px }
    }
    fit()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    ro?.observe(c)
    let id = 0
    const frame = (): void => {
      const run = activeRunner()
      drawRadar(g, size, dpr, run ? run.state : null, lookState.yaw)
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(id); ro?.disconnect() }
  }, [])
  return <canvas ref={ref} className="drun-radar" aria-hidden />
}
