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
 * Placement follows the house rule exactly: pointCentre against the anchor's
 * aligned origin, fixed-point bigint deltas, never a coordinate through
 * Number. One GL_POINTS draw for the whole cloud, coloured per vertex
 * (landfall warm-blue EARTH, port purple SIDESTEP), and clicking a point
 * selects that stop as the ride's destination.
 *
 * The cloud reads straight off the columnar index: the kind byte first (a
 * port is plane 1, a landfall plane 0, so the plane filter never has to
 * decode the wrong half of the line), then the cached per-row decode
 * (xyzAt de-interleaves each row once, ever). No Stop objects are
 * materialized here — a million of them per rebuild is exactly what the
 * columnar index exists to avoid — so picks carry heights, not stops.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import { GRID_RADIUS, pointCentre, type ViewAxes } from '../lib/space'
import { ACCENT, SIDESTEP } from '../lib/palette'
import { heightAt, kindIsPort, xyzAt } from '../lib/hyperspace/compactIndex'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { getStopIndex, useHyperspace } from '../store/useHyperspace'
import { selectStopInScene } from '../hud/HyperspacePanel'

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
 * The landfall shell needs its own, far smaller budget. Ports fill a volume,
 * so 120k of them read as dust; landfalls crowd one planet's surface, and at
 * any zoom that shows the globe a generous budget paints it solid orange.
 * A hash-uniform stride down to this many, drawn attenuated at a fixed
 * world size, keeps the crust reading as individual dots at every zoom.
 */
const MAX_LANDFALL_POINTS = 9_000

/**
 * Raycast threshold for GL_POINTS, in render units. Points have no surface, so
 * picking is "within this distance of the ray"; a third of a cell reads as
 * "I clicked that dot" without making neighbours ambiguous.
 */
const PICK_THRESHOLD = 0.35

/**
 * While the bulk sync churns, a rebuild is only worth its cost when the line
 * grew substantially: the cloud's shape is hash-uniform, so 10k more dots in
 * a field of half a million are invisible. Total index size is the cheap
 * proxy for "stops in range" — positions are uniform, so range population
 * grows in proportion.
 */
const REBUILD_MIN_GROWTH = 50_000
const REBUILD_GROWTH_FRACTION = 0.15

/** Per-vertex colours: landfalls in Earth's blue, ports in ideaspace purple. */
// Landfalls read as embers of bitcoin orange on the globe; the old EARTH
// blue made scrubbed stops look selected when nothing was.
const LANDFALL_COLOR = new Color('#b06f14')
const PORT_COLOR = new Color(SIDESTEP)

interface Props {
  axes: ViewAxes
}

interface Built {
  geometry: BufferGeometry
  /** Parallel to the geometry's vertices, so a picked index maps to its stop's height. */
  heights: number[]
  /** 1 = every stop in range is drawn; N = every Nth survived the cap. */
  stride: number
}

export function StopField({ axes }: Props): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const indexVersion = useHyperspace((s) => s.indexVersion)
  const syncStatus = useHyperspace((s) => s.sync.status)
  const destination = useHyperspace((s) => s.destination)

  // The calm-down gate: while syncing, an indexVersion bump only triggers a
  // geometry rebuild when the stop count changed materially. The ref carries
  // the last version we honoured; honouring one updates it during render,
  // which is safe because the decision is idempotent for a given version.
  const gate = useRef({ version: -1, size: -1 })
  {
    const size = getStopIndex().size
    const g = gate.current
    if (g.version !== indexVersion) {
      const syncing = syncStatus === 'syncing' || syncStatus === 'loading-cache'
      const grownEnough =
        size - g.size >= Math.max(REBUILD_MIN_GROWTH, g.size * REBUILD_GROWTH_FRACTION)
      if (g.version === -1 || !syncing || grownEnough) {
        g.version = indexVersion
        g.size = size
      }
    }
  }
  const rebuildVersion = gate.current.version

  const built = useMemo((): Built | null => {
    const index = getStopIndex()
    if (index.size === 0) return null

    const origin = alignedOrigin(anchor, scaleExp)
    const wantPort = anchorPlane === 1
    const centres: number[] = []
    const inRange: number[] = []

    for (let row = 0; row < index.size; row++) {
      // Ports live on plane 1, landfalls on plane 0, so matching the anchor's
      // plane is what makes the Earth view show landfalls and the ideaspace
      // view show ports, rather than superimposing two unrelated clouds. The
      // kind byte IS the plane bit, so the wrong half skips before decoding.
      if (kindIsPort(index, row) !== wantPort) continue
      const d = xyzAt(index, row)
      const c = pointCentre(d, origin, scaleExp, axes)
      if (Math.abs(c[0]) > REACH || Math.abs(c[1]) > REACH || Math.abs(c[2]) > REACH) continue
      centres.push(c[0], c[1], c[2])
      inRange.push(row)
    }

    if (inRange.length === 0) return null

    const stride = Math.max(1, Math.ceil(inRange.length / (wantPort ? MAX_POINTS : MAX_LANDFALL_POINTS)))
    const count = Math.ceil(inRange.length / stride)
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const heights: number[] = new Array(count)

    let v = 0
    for (let i = 0; i < inRange.length; i += stride) {
      positions[v * 3] = centres[i * 3]
      positions[v * 3 + 1] = centres[i * 3 + 1]
      positions[v * 3 + 2] = centres[i * 3 + 2]
      const col = kindIsPort(index, inRange[i]) ? PORT_COLOR : LANDFALL_COLOR
      colors[v * 3] = col.r
      colors[v * 3 + 1] = col.g
      colors[v * 3 + 2] = col.b
      heights[v] = heightAt(index, inRange[i])
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

    return { geometry, heights, stride }
  }, [rebuildVersion, anchor, scaleExp, axes, anchorPlane])

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
    for (let i = 0; i < built.heights.length; i++) {
      if (built.heights[i] === destination) {
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
  const portView = anchorPlane === 1

  const pick = (e: ThreeEvent<MouseEvent>): void => {
    // An orbit-drag that happens to end on a dot is not a tap.
    if (e.delta > TAP_SLOP) return
    // Points raycasting returns every dot within the threshold, sorted by
    // distance along the ray, so the event's own index is whichever
    // qualifying dot sits closest to the CAMERA. On the crowded landfall
    // shell that is routinely a neighbour of the dot under the pointer; the
    // dot the user means is the one nearest the ray itself.
    let bestIndex: number | undefined
    let bestDist = Infinity
    for (const hit of e.intersections) {
      if (hit.object !== e.eventObject || hit.index === undefined) continue
      const d = hit.distanceToRay ?? 0
      if (d < bestDist) {
        bestDist = d
        bestIndex = hit.index
      }
    }
    if (bestIndex === undefined) return
    const height = built.heights[bestIndex]
    if (height === undefined) return
    e.stopPropagation()
    selectStopInScene(height)
  }

  return (
    <group>
      <points geometry={built.geometry} onClick={pick} frustumCulled={false}>
        {/*
          Ports: pixel-sized like the terrain dust (sizeAttenuation off), so
          the cloud reads at every zoom instead of vanishing with distance.
          Landfalls: world-sized and attenuated, so the crust shrinks with the
          planet instead of blooming into a solid orange disc when the globe
          is small on screen. toneMapped and fog both off for the BlackSun
          reason: these colours are the encoding, and half the field sits
          beyond where the scene fog has already gone to black.
        */}
        <pointsMaterial
          vertexColors
          size={portView ? 6 : 0.24}
          sizeAttenuation={!portView}
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
