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

import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import { GRID_RADIUS, OCCUPANCY_SCALE_MAX, cellCentre, cellDelta, originShift, pointCentre, type Position, type ViewAxes } from '../lib/space'
import { ACCENT, SIDESTEP } from '../lib/palette'
import { heightAt, kindIsPort, stopAt, xyzAt } from '../lib/hyperspace/compactIndex'
import { coverageRuns } from '../lib/hyperspace/station'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { getStopIndex, useHyperspace } from '../store/useHyperspace'
import { selectStopInScene } from '../hud/HyperspacePanel'
import { stopCoordExact } from '../lib/hyperspace/stops'
import { coordToXyz } from 'cyberspace-core'

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
 * Main-thread budget per build slice, in milliseconds. The scan chips away
 * between frames instead of blocking: rows are processed in small batches,
 * and when the budget is spent the loop yields through setTimeout so input
 * and rendering run before the next slice.
 */
const SLICE_MS = 12

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
  /** The aligned origin the positions were computed against; the render
   * rebases the whole cloud by originShift when the anchor has since moved. */
  origin: Position
  /** The anchor at build time, for measuring how far the view has drifted. */
  anchor: Position
  /** Plane, zoom and axes of the build. A mismatch is a different frame
   * entirely: those positions are never drawn, and a rebuild starts. */
  frameKey: string
  /** The rebuildVersion the rows were read at. */
  version: number
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

  const [built, setBuilt] = useState<Built | null>(null)
  const builtRef = useRef<Built | null>(null)

  const frameKey = `${anchorPlane} ${scaleExp} ` +
    `${axes.right.axis}${axes.right.dir} ${axes.up.axis}${axes.up.dir} ${axes.out.axis}${axes.out.dir}`
  const anchorKey = `${anchor.x} ${anchor.y} ${anchor.z}`

  useEffect(() => {
    const job = { cancelled: false }

    // A pure translation of the anchor does not invalidate the geometry:
    // the render rebases the whole cloud by originShift. Rebuild only when
    // the frame itself changed, stops arrived, or the view has drifted far
    // enough into the REACH margin that fresh content is due. This is what
    // keeps clicking a block (which re-anchors the scene on it) from
    // blanking and rebuilding the field mid-burst.
    const cur = builtRef.current
    if (cur && cur.frameKey === frameKey && cur.version === rebuildVersion) {
      const drift = Math.max(
        Math.abs(cellDelta(anchor.x, cur.anchor.x, scaleExp)),
        Math.abs(cellDelta(anchor.y, cur.anchor.y, scaleExp)),
        Math.abs(cellDelta(anchor.z, cur.anchor.z, scaleExp)),
      )
      if (drift < REACH / 4) return
    }
    // Positions from another frame cannot be shown while the rebuild runs;
    // a same-frame rebuild keeps the old cloud visible (rebased) instead.
    if (cur && cur.frameKey !== frameKey) {
      builtRef.current = null
      setBuilt(null)
    }

    const index = getStopIndex()
    const wantPort = anchorPlane === 1
    const budget = wantPort ? MAX_POINTS : MAX_LANDFALL_POINTS
    const commit = (next: Built | null): void => {
      if (job.cancelled) return
      builtRef.current = next
      setBuilt(next)
    }

    if (index.size === 0 || index.permCount === 0) {
      commit(null)
      return
    }

    // The sorted view bounds the scan to rows that can possibly be in range
    // (coverageRuns), so a spawn-scale build touches a handful of rows
    // instead of cold-decoding a million to keep none of them. That cold
    // decode, measured at ~7 microseconds a row, was the six-second boot
    // freeze once the index snapshot began delivering the whole line at
    // once, and the same freeze on VIEW NEAREST STOP.
    const runs = coverageRuns(index, anchor.x, anchor.y, anchor.z, scaleExp, REACH + 2)
    let runTotal = 0
    for (const [runStart, runEnd] of runs) runTotal += runEnd - runStart
    if (runTotal === 0) {
      commit(null)
      return
    }

    // Decimate BEFORE decoding: the run total already bounds the in-range
    // population, so sampling down to about twice the point budget cuts a
    // dense view's decode work by an order of magnitude, and the post-filter
    // stride below still lands the budget. Row ids are copied out up front
    // because a background merge may re-sort perm between slices; the rows
    // themselves never move.
    const preStride = Math.max(1, Math.floor(runTotal / (budget * 2)))
    const rows = new Uint32Array(Math.ceil(runTotal / preStride))
    let w = 0
    {
      let i = 0
      let next = 0
      for (const [runStart, runEnd] of runs) {
        for (let pos = runStart; pos < runEnd; pos++, i++) {
          if (i === next) {
            rows[w++] = index.perm[pos]
            next += preStride
          }
        }
      }
    }

    const origin = alignedOrigin(anchor, scaleExp)
    // At occupancy zooms (cells of about a metre and finer) the handful of
    // stops in range render from their EXACT coordinates, snapped to their
    // cells like the avatar: the float shortcut's nanometre error is tens
    // of gibsons, which at these zooms put the dot for the block you are
    // standing on visibly beside you. The coverage cull guarantees the
    // exact decimal derivations stay countable on one hand here.
    const occupancy = scaleExp <= OCCUPANCY_SCALE_MAX
    const kept: number[] = []
    const centres: number[] = []
    let i = 0

    const finish = (): void => {
      if (kept.length === 0) {
        commit(null)
        return
      }
      const stride = Math.max(1, Math.ceil(kept.length / budget))
      const count = Math.ceil(kept.length / stride)
      const positions = new Float32Array(count * 3)
      const colors = new Float32Array(count * 3)
      const heights: number[] = new Array(count)
      let v = 0
      for (let k = 0; k < kept.length; k += stride) {
        positions[v * 3] = centres[k * 3]
        positions[v * 3 + 1] = centres[k * 3 + 1]
        positions[v * 3 + 2] = centres[k * 3 + 2]
        const col = kindIsPort(index, kept[k]) ? PORT_COLOR : LANDFALL_COLOR
        colors[v * 3] = col.r
        colors[v * 3 + 1] = col.g
        colors[v * 3 + 2] = col.b
        heights[v] = heightAt(index, kept[k])
        v++
      }
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      // Same dev hook style as ShaderPointField: lets the browser harness
      // read what actually reached the GPU, decimation factor included.
      if (import.meta.env.DEV) {
        ;(window as unknown as { __stopField?: unknown }).__stopField = {
          rendered: count, inRange: kept.length, stride: preStride * stride, runTotal,
        }
      }
      commit({
        geometry,
        heights,
        stride: preStride * stride,
        origin,
        anchor: { ...anchor },
        frameKey,
        version: rebuildVersion,
      })
    }

    // Chip away between frames. The first slice runs synchronously, so the
    // common case after the coverage cull (a small view) commits in the same
    // React flush as the clear above and never flickers through an empty
    // frame.
    const slice = (): void => {
      if (job.cancelled) return
      const t0 = performance.now()
      while (i < w) {
        const batchEnd = Math.min(w, i + 1024)
        for (; i < batchEnd; i++) {
          const row = rows[i]
          // Ports live on plane 1, landfalls on plane 0, so matching the
          // anchor's plane shows one cloud instead of superimposing two
          // unrelated ones; the kind byte IS the plane bit.
          if (kindIsPort(index, row) !== wantPort) continue
          const d = occupancy ? coordToXyz(stopCoordExact(stopAt(index, row))) : xyzAt(index, row)
          const c = occupancy ? cellCentre(d, origin, scaleExp, axes) : pointCentre(d, origin, scaleExp, axes)
          if (Math.abs(c[0]) > REACH || Math.abs(c[1]) > REACH || Math.abs(c[2]) > REACH) continue
          kept.push(row)
          centres.push(c[0], c[1], c[2])
        }
        if (performance.now() - t0 >= SLICE_MS) {
          setTimeout(slice, 0)
          return
        }
      }
      finish()
    }
    slice()

    return () => { job.cancelled = true }
    // The spatial deps ride in the keys on purpose: listing the objects too
    // would re-run the build on identity changes that changed nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildVersion, frameKey, anchorKey])

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

  if (!built || built.frameKey !== frameKey) return null
  const portView = anchorPlane === 1
  // Rebase the cloud into the current frame: a re-anchor is a change of
  // origin, not of where the stops are.
  const rebase = originShift(built.origin, alignedOrigin(anchor, scaleExp), scaleExp, axes)

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
      // The list is sorted by distance, so the first hit that is not a dot
      // is something solid in front of the rest (the Earth occluder): dots
      // beyond it are on the far side of the planet and not clickable, even
      // when one of them lines up with the ray better than any near dot.
      if (hit.object !== e.eventObject) break
      if (hit.index === undefined) continue
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
    <group position={rebase}>
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
