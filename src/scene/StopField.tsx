/**
 * StopField.tsx — every stop on the hyperspace line, as a point you can pick.
 *
 * DECK-0001: every Bitcoin block is a stop. A merkle root with plane bit 1 is
 * a port in ideaspace at the root's own coordinate; plane bit 0 has fallen to
 * Earth as a landfall on the WGS84 surface. Nobody chose any of these
 * positions, which is why seeing them all at once matters: the cloud IS the
 * shape proof of work has scattered through the space. From a bird's-eye of
 * the whole cube the ports are a uniform dust; snapped to Earth the landfalls
 * shrink-wrap the planet.
 *
 * Placement follows the house rule exactly: cellCentre against the anchor's
 * aligned origin, fixed-point bigint deltas, never a coordinate through
 * Number. One GL_POINTS draw for the whole cloud, coloured per vertex
 * (landfall warm-blue EARTH, port purple SIDESTEP), and clicking a point
 * selects that stop as the ride's destination.
 */

import { useEffect, useMemo } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import { coordToXyz, type Xyz } from 'cyberspace-core'
import { GRID_RADIUS, cellCentre, type ViewAxes } from '../lib/space'
import { ACCENT, EARTH, SIDESTEP } from '../lib/palette'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { getStopIndex, useHyperspace } from '../store/useHyperspace'
import type { Stop } from '../lib/hyperspace/stops'

/** Same tap-vs-drag slop as every other clickable thing in the scene. */
const TAP_SLOP = 8

/** Same reach as WorldMessages and the sector cage: beyond this a stop is off-grid at this scale. */
const REACH = GRID_RADIUS * 8

/**
 * Hard ceiling on points actually built. The chain is near a million blocks;
 * a full-cube view puts half of them (one plane's worth) in range at once, and
 * a million-vertex transparent point cloud under bloom is overdraw the frame
 * budget does not have. Past the cap the field is decimated to every Nth stop,
 * which preserves the cloud's shape — the positions are hash-uniform, so a
 * stride is as unbiased a sample as any.
 */
const MAX_POINTS = 120_000

/**
 * Raycast threshold for GL_POINTS, in render units. Points have no surface, so
 * picking is "within this distance of the ray"; a third of a cell reads as
 * "I clicked that dot" without making neighbours ambiguous.
 */
const PICK_THRESHOLD = 0.35

/**
 * Decoded-coordinate cache. coordToXyz de-interleaves 255 bits per stop, and
 * doing that for ~950k stops costs seconds — far too much to repeat on every
 * anchor move or zoom, which only change the cheap cellDelta step. Stops are
 * stable objects (the index replaces the array, not the entries), so a WeakMap
 * keyed on the Stop itself survives every rebuild that keeps an entry and lets
 * the GC reclaim what a rebuild drops.
 */
const decoded = new WeakMap<Stop, Xyz>()

function decode(stop: Stop): Xyz {
  let d = decoded.get(stop)
  if (!d) {
    d = coordToXyz(stop.coordApprox)
    decoded.set(stop, d)
  }
  return d
}

/** Per-vertex colours: landfalls in Earth's blue, ports in ideaspace purple. */
const LANDFALL_COLOR = new Color(EARTH)
const PORT_COLOR = new Color(SIDESTEP)

interface Props {
  axes: ViewAxes
}

interface Built {
  geometry: BufferGeometry
  /** Parallel to the geometry's vertices, so a picked index maps to its stop. */
  stops: Stop[]
  /** 1 = every stop in range is drawn; N = every Nth survived the cap. */
  stride: number
}

export function StopField({ axes }: Props): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const indexVersion = useHyperspace((s) => s.indexVersion)
  const destination = useHyperspace((s) => s.destination)

  const built = useMemo((): Built | null => {
    const { stops } = getStopIndex()
    if (stops.length === 0) return null

    const origin = alignedOrigin(anchor, scaleExp)
    const centres: number[] = []
    const inRange: Stop[] = []

    for (const stop of stops) {
      const d = decode(stop)
      // Ports live on plane 1, landfalls on plane 0, so matching the anchor's
      // plane is what makes the Earth view show landfalls and the ideaspace
      // view show ports, rather than superimposing two unrelated clouds.
      if (d.plane !== anchorPlane) continue
      const c = cellCentre(d, origin, scaleExp, axes)
      if (Math.abs(c[0]) > REACH || Math.abs(c[1]) > REACH || Math.abs(c[2]) > REACH) continue
      centres.push(c[0], c[1], c[2])
      inRange.push(stop)
    }

    if (inRange.length === 0) return null

    const stride = Math.max(1, Math.ceil(inRange.length / MAX_POINTS))
    const count = Math.ceil(inRange.length / stride)
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const kept: Stop[] = new Array(count)

    let v = 0
    for (let i = 0; i < inRange.length; i += stride) {
      positions[v * 3] = centres[i * 3]
      positions[v * 3 + 1] = centres[i * 3 + 1]
      positions[v * 3 + 2] = centres[i * 3 + 2]
      const col = inRange[i].kind === 'landfall' ? LANDFALL_COLOR : PORT_COLOR
      colors[v * 3] = col.r
      colors[v * 3 + 1] = col.g
      colors[v * 3 + 2] = col.b
      kept[v] = inRange[i]
      v++
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))

    // Same dev hook style as ShaderPointField: lets the browser harness read
    // what actually reached the GPU, decimation factor included.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __stopField?: unknown }).__stopField = {
        rendered: count, inRange: inRange.length, stride,
      }
    }

    return { geometry, stops: kept, stride }
  }, [indexVersion, anchor, scaleExp, axes, anchorPlane])

  // GPU buffers are not garbage collected; release each one when replaced.
  useEffect(() => () => { built?.geometry.dispose() }, [built])

  // Points raycast by distance-to-ray, and the default threshold of 1 render
  // unit makes a click grab dots half a screen away. Scoped to this
  // component's lifetime and restored on unmount, because the raycaster is
  // shared by everything clickable in the Canvas.
  const raycaster = useThree((s) => s.raycaster)
  useEffect(() => {
    const prev = raycaster.params.Points.threshold
    raycaster.params.Points.threshold = PICK_THRESHOLD
    return () => { raycaster.params.Points.threshold = prev }
  }, [raycaster])

  // The chosen destination, re-marked in ACCENT. Found by height rather than
  // by identity because the destination can outlive a geometry rebuild.
  const highlight = useMemo((): [number, number, number] | null => {
    if (!built || destination === null) return null
    for (let i = 0; i < built.stops.length; i++) {
      if (built.stops[i].height === destination) {
        const p = built.geometry.getAttribute('position')
        return [p.getX(i), p.getY(i), p.getZ(i)]
      }
    }
    return null
  }, [built, destination])

  const highlightGeometry = useMemo(() => {
    if (!highlight) return null
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(highlight), 3))
    return g
  }, [highlight])
  useEffect(() => () => { highlightGeometry?.dispose() }, [highlightGeometry])

  if (!built) return null

  const pick = (e: ThreeEvent<MouseEvent>): void => {
    // An orbit-drag that happens to end on a dot is not a tap.
    if (e.delta > TAP_SLOP) return
    if (e.index === undefined) return
    const stop = built.stops[e.index]
    if (!stop) return
    e.stopPropagation()
    useHyperspace.getState().setDestination(stop.height)
  }

  return (
    <group>
      <points geometry={built.geometry} onClick={pick} frustumCulled={false}>
        {/*
          Pixel-sized like the terrain dust (sizeAttenuation off), so the cloud
          reads at every zoom instead of vanishing with distance. toneMapped
          and fog both off for the BlackSun reason: these colours are the
          encoding, and half the field sits beyond where the scene fog has
          already gone to black.
        */}
        <pointsMaterial
          vertexColors
          size={3}
          sizeAttenuation={false}
          transparent
          opacity={0.95}
          depthWrite={false}
          toneMapped={false}
          fog={false}
        />
      </points>
      {highlightGeometry && (
        <points geometry={highlightGeometry} frustumCulled={false}>
          {/* No click handler: a click on the marker should fall through to
              the dot beneath it rather than re-picking by a foreign index. */}
          <pointsMaterial
            color={ACCENT}
            size={9}
            sizeAttenuation={false}
            transparent
            opacity={0.9}
            depthWrite={false}
            toneMapped={false}
            fog={false}
          />
        </points>
      )}
    </group>
  )
}
