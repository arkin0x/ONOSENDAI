/**
 * CrossingFlash.tsx — light up the region you just paid for.
 *
 * When a commit lands, the proof covered one specific thing: the covering
 * aligned subtree of the move, per axis. §4.5 gives it as `h = lca(v1, v2)` and
 * `base = (v1 >> h) << h`, and §4.7 says each axis computes its root over its
 * own subtree before the three are paired into region_n. So the box that lights
 * up here IS region_n's extent, and its size is literally the work done: 2^h
 * leaves per axis.
 *
 * This is the moment the protocol's central property is legible. Cost is set by
 * which boundary you cross, not how far you travel, and until now the crossing
 * happened instantaneously and unmarked: you saw the aftermath, never the event.
 * A single gibson step that flashes a box thirty-two cells wide explains more
 * than any number in a panel.
 *
 * The heights are per axis and genuinely independent, so the box is not a cube.
 * A move that is expensive on z and free on x and y flashes a slab, which is the
 * honest shape of what was computed.
 */

import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial } from 'three'
import { findLcaHeight } from 'cyberspace-core'
import { GRID_RADIUS, stepFor, type Position, type ViewAxes } from '../lib/space'
import { boundaryColor } from '../lib/palette'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

/** Seconds the flash takes to fade out. */
const DURATION = 1.4

/**
 * Largest box we will build, in cells.
 *
 * A ruinous crossing produces a box far wider than the view. Drawing it at true
 * size is honest and it reads as walls blowing past you, but the geometry still
 * has to stay finite.
 */
const MAX_CELLS = GRID_RADIUS * 3

interface Props {
  axes: ViewAxes
}

interface Flash {
  geometry: BufferGeometry
  color: string
  /** Heights crossed per screen axis, for the record. */
  heights: [number, number, number]
}

/** Edges of an axis-aligned box given its centre and per-axis size, in cells. */
function boxEdges(
  centre: [number, number, number], size: [number, number, number],
): BufferGeometry {
  const h: [number, number, number] = [size[0] / 2, size[1] / 2, size[2] / 2]
  const corner = (sx: number, sy: number, sz: number): number[] =>
    [centre[0] + sx * h[0], centre[1] + sy * h[1], centre[2] + sz * h[2]]

  const v: number[] = []
  for (const sz of [-1, 1]) {
    for (const sy of [-1, 1]) v.push(...corner(-1, sy, sz), ...corner(1, sy, sz))
    for (const sx of [-1, 1]) v.push(...corner(sx, -1, sz), ...corner(sx, 1, sz))
  }
  for (const sy of [-1, 1]) {
    for (const sx of [-1, 1]) v.push(...corner(sx, sy, -1), ...corner(sx, sy, 1))
  }

  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(v, 3))
  return geom
}

function buildFlash(
  from: Position, to: Position, scaleExp: number, axes: ViewAxes,
): Flash | null {
  const step = stepFor(scaleExp)
  const origin = alignedOrigin(to, scaleExp)
  const screen = [axes.right, axes.up, axes.out]

  const centre: [number, number, number] = [0, 0, 0]
  const size: [number, number, number] = [1, 1, 1]
  const heights: [number, number, number] = [0, 0, 0]
  let peak = 0

  for (let s = 0; s < 3; s++) {
    const axis = screen[s].axis
    const height = findLcaHeight(from[axis], to[axis])
    heights[s] = height
    peak = Math.max(peak, height)

    // An axis that did not move has no covering subtree, so it contributes the
    // single cell you are standing in rather than a degenerate zero-width face.
    const h = BigInt(Math.max(height, scaleExp))
    const cells = Math.min(Number((1n << h) / step), MAX_CELLS)
    const base = (from[axis] >> h) << h
    const lo = Number((base - origin[axis]) / step)

    size[s] = cells
    centre[s] = (lo + (cells - 1) / 2) * screen[s].dir
  }

  if (peak === 0) return null

  return { geometry: boxEdges(centre, size), color: `#${boundaryColor(peak).getHexString()}`, heights }
}

export function CrossingFlash({ axes }: Props): JSX.Element | null {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const [flash, setFlash] = useState<Flash | null>(null)
  const previous = useRef<Position>(position)
  const started = useRef(0)
  const material = useRef<LineBasicMaterial>(null)

  useEffect(() => {
    const from = previous.current
    previous.current = position
    if (from.x === position.x && from.y === position.y && from.z === position.z) return

    const next = buildFlash(from, position, scaleExp, axes)
    setFlash((old) => {
      old?.geometry.dispose()
      return next
    })
    started.current = 0
    // scaleExp and axes are read at flash time, not tracked: a zoom or rotation
    // mid-fade should not rebuild a flash that is already on its way out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position])

  useEffect(() => () => flash?.geometry.dispose(), [flash])

  useFrame((state) => {
    if (!flash || !material.current) return
    if (started.current === 0) started.current = state.clock.elapsedTime

    const t = (state.clock.elapsedTime - started.current) / DURATION
    if (t >= 1) {
      setFlash((old) => {
        old?.geometry.dispose()
        return null
      })
      return
    }
    // Ease out: bright on arrival, then a long tail rather than a linear wipe.
    const k = 1 - t
    material.current.opacity = k * k
  })

  if (!flash) return null

  return (
    <lineSegments geometry={flash.geometry} frustumCulled={false} renderOrder={11}>
      <lineBasicMaterial
        ref={material}
        color={flash.color}
        toneMapped={false}
        transparent
        opacity={1}
        depthTest={false}
      />
    </lineSegments>
  )
}
