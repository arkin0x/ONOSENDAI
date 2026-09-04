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
import { BufferGeometry, Color, LineBasicMaterial } from 'three'
import { GRID_RADIUS, type Position, type ViewAxes } from '../lib/space'
import { boxEdges, coveringBox } from '../lib/covering'
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

const WHITE = new Color('#ffffff')

interface Props {
  axes: ViewAxes
}

interface Flash {
  geometry: BufferGeometry
  color: Color
  /** Heights crossed per screen axis, for the record. */
  heights: [number, number, number]
}

function buildFlash(
  from: Position, to: Position, scaleExp: number, axes: ViewAxes,
): Flash | null {
  const origin = alignedOrigin(to, scaleExp)
  const c = coveringBox(from, to, origin, scaleExp, axes, MAX_CELLS)
  if (c.degenerate) return null
  return {
    geometry: boxEdges(c.centre, c.size),
    color: boundaryColor(c.peak).clone(),
    heights: c.heights,
  }
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
    // A commit that lands while you are looking at history would flash in a
    // frame anchored somewhere else entirely.
    if (!useCyberspace.getState().atHead()) return

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

    // Strikes white, then resolves into its cost color over the first third.
    // The lattice and the covering box now hold fixed hues so they can be told
    // apart at a glance, which leaves the LCA ramp free to mean what it was
    // written to mean, here, where the number genuinely varies: a cheap crossing
    // settles violet and a ruinous one settles red.
    material.current.color.copy(WHITE).lerp(flash.color, Math.min(1, t * 3))
  })

  if (!flash) return null

  return (
    <lineSegments geometry={flash.geometry} frustumCulled={false} renderOrder={11}>
      <lineBasicMaterial
        ref={material}
        color={WHITE}
        toneMapped={false}
        transparent
        opacity={1}
        depthTest={false}
      />
    </lineSegments>
  )
}
