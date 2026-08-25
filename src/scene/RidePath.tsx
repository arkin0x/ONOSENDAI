/**
 * RidePath.tsx - the ride, traced through the whole of cyberspace.
 *
 * Starting a ride pulls the camera back to the cube (startRide sets the
 * focus), and this draws why: every block passed is a real place, and the
 * path visits each one in order, so the proof literally threads the space.
 * A rainbow line strip grows stop by stop as leaves complete, brightest at
 * the head and fading comet-style down the tail (additive blending, so
 * fading to black is fading to nothing under the bloom).
 *
 * The plane bit is deliberately collapsed here: the trace is the path
 * through the cube's volume, and flickering half the vertices out whenever
 * the anchor's plane disagreed would cut the thread in half. The stop
 * renders that care about the plane still filter; the ride's line does not.
 */
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Line, LineBasicMaterial } from 'three'
import { coordToXyz } from 'cyberspace-core'
import { pointCentre, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { getStopByHeight } from '../store/useHyperspace'
import { rideTrail } from '../lib/hyperspace/ride'
import { useRideRun } from '../hud/HyperspacePanel'

function approxPosition(coord: bigint): Position {
  const { x, y, z } = coordToXyz(coord)
  return { x, y, z }
}

/** The comet keeps this much tail; older stops have already been proven. */
const MAX_TRAIL = 4096

export function RidePath({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const progress = useRideRun((s) => s.progress)
  const path = useRideRun((s) => s.path)

  const heights = useMemo(
    () => (path && progress ? rideTrail(path.fromHeight, path.toHeight, progress.done, progress.total, MAX_TRAIL) : null),
    [path, progress],
  )

  const object = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3))
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3))
    geometry.setDrawRange(0, 0)
    const material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const line = new Line(geometry, material)
    line.frustumCulled = false
    line.renderOrder = 4
    return line
  }, [])
  useEffect(() => () => { object.geometry.dispose(); (object.material as LineBasicMaterial).dispose() }, [object])

  // Refill on every hop and on every change of frame. At most MAX_TRAIL
  // fixed-point placements per refill, a few milliseconds at a rate of a
  // few hops a second; the buffers are preallocated so nothing churns.
  useEffect(() => {
    const geometry = object.geometry
    if (!heights) {
      geometry.setDrawRange(0, 0)
      return
    }
    const origin = alignedOrigin(anchor, scaleExp)
    const pos = geometry.getAttribute('position') as BufferAttribute
    const col = geometry.getAttribute('color') as BufferAttribute
    const tone = new Color()
    let last: [number, number, number] = [0, 0, 0]
    const n = heights.length
    for (let i = 0; i < n; i++) {
      const stop = getStopByHeight(heights[i])
      // Every passed block has a stop (the ride refused to start without its
      // hash), but a mid-ride index rebuild can be briefly behind: reuse the
      // previous vertex rather than stitching in the origin.
      // Approx on purpose: the trail is thousands of stops at cube zoom,
      // where the float shortcut's nanometre error is invisible, and the
      // exact decimal derivation would cost seconds across the tail.
      const c = stop ? pointCentre(approxPosition(stop.coordApprox), origin, scaleExp, axes) : last
      last = c
      pos.setXYZ(i, c[0], c[1], c[2])
      // Rainbow along the trail, brightest at the head, dying to black down
      // the tail: under additive blending black IS gone.
      const t = n <= 1 ? 1 : i / (n - 1)
      tone.setHSL((0.03 + 0.9 * t) % 1, 1, 0.55)
      const fade = 0.12 + 0.88 * t * t
      col.setXYZ(i, tone.r * fade, tone.g * fade, tone.b * fade)
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    geometry.setDrawRange(0, n)
  }, [heights, anchor, scaleExp, axes, object])

  if (!heights || heights.length < 2) return null
  return <primitive object={object} />
}
