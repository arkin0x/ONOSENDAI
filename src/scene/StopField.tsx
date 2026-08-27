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
import { markSceneTapHandled } from '../hooks/useCanvasTap'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, Color, Float32BufferAttribute } from 'three'
import { GRID_RADIUS, OCCUPANCY_SCALE_MAX, cellCentre, cellDelta, originShift, pointCentre, type Position, type ViewAxes } from '../lib/space'
import { ACCENT, SIDESTEP } from '../lib/palette'
import { heightAt, kindIsPort, stopAt, xyzAt } from '../lib/hyperspace/compactIndex'
import { coverageRuns } from '../lib/hyperspace/station'
import { drawnSet, hashHeight, projectedPopulation, sampleThreshold } from '../lib/hyperspace/sample'
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
 * budget does not have. Past the cap the field keeps the stops whose hashed
 * heights sort smallest (sample.ts): deterministic per block and nested as
 * the line grows, so the sample fills in and thins at the margin but never
 * reshuffles. The positions are hash-uniform, so a height-keyed subset is
 * as unbiased a sample as any.
 */
const MAX_POINTS = 120_000

/**
 * The landfall shell needs its own, far smaller budget. Ports fill a volume,
 * so 120k of them read as dust; landfalls crowd one planet's surface, and at
 * any zoom that shows the globe a generous budget paints it solid orange.
 * An identity-hash sample down to this many, drawn attenuated at a fixed
 * world size, keeps the crust reading as individual dots at every zoom.
 */
const MAX_LANDFALL_POINTS = 5_000

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
/**
 * Headroom between the sample's target size and the hard buffer cap, so
 * ordinary sampling noise never trips the cap. See the note at drawnSet.
 */
const HARD_CAP_SLACK = 1.1

/** DEV only: the previous rebuild's drawn set, for the eviction counter. */
let lastDrawn: { frameKey: string; set: Set<number> } | null = null

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

    // Filter BEFORE decoding, and by identity, not position: a block is a
    // candidate iff its hashed height clears a threshold sized to admit
    // about twice the point budget, which keeps a dense view's decode work
    // an order of magnitude under the population; drawnSet in finish()
    // lands the budget exactly. The old every-Nth stride re-dealt the whole
    // visible sample whenever the population grew or the perm re-sorted,
    // so the crust of Earth reshuffled on every growth rebuild during the
    // sync. A height's hash never changes, so now a drawn block stays
    // drawn (sample.ts has the nesting argument). Row ids are still copied
    // out up front because a background merge may re-sort perm between
    // slices; the rows themselves never move.
    // ...and size that threshold from the population the line will END at,
    // not the one loaded so far. A loaded-sized threshold is nested (no dot
    // moves, none returns) yet still evicts, because early in a sync it
    // draws a far more generous sample than the finished line can support
    // and every later rebuild thins it. Projected, the first frame already
    // draws the final sample, so loading only ever adds dots.
    //
    // Two things have to line up for that to hold, and both are ratios of
    // counts taken over the SAME population:
    //
    //  - permCount, not the sync's progress counter, is the denominator.
    //    runTotal is counted over the sorted view, so runTotal/permCount is
    //    the fraction of the line inside this window and nothing else.
    //    sync.loaded counts rows the view has not merged yet and headers not
    //    yet appended, so dividing by it understates the projection.
    //  - the count going in is IN-PLANE. The budget buys dots on one plane;
    //    the coverage cubes hold whatever is spatially near, and at a globe
    //    view that is every landfall and almost no port, since a port's
    //    coordinate is its merkle root and lands anywhere in the 2^85 space.
    //    Sizing off the raw run total therefore admitted roughly twice the
    //    budget, and drawnSet's cap, which is sized from kept.length and so
    //    moves on every rebuild, went back to being the working decimation.
    //    That is why the crust held until the sync passed the point where
    //    kept crossed the budget and then churned at the cut boundary: the
    //    dots well inside the cut stayed, the ones near it did not.
    //
    // Counting the plane costs one byte read per row and no coordinate
    // decode, which is why it can afford to run before the hash filter.
    let planeTotal = 0
    for (const [runStart, runEnd] of runs) {
      for (let pos = runStart; pos < runEnd; pos++) {
        if (kindIsPort(index, index.perm[pos]) === wantPort) planeTotal++
      }
    }
    if (planeTotal === 0) {
      commit(null)
      return
    }
    const total = useHyperspace.getState().sync.total
    const projected = projectedPopulation(planeTotal, index.permCount, total)
    const threshold = sampleThreshold(projected, budget)
    const rows: number[] = []
    for (const [runStart, runEnd] of runs) {
      for (let pos = runStart; pos < runEnd; pos++) {
        const row = index.perm[pos]
        // The kind byte IS the plane bit. Matching it here shows one cloud
        // instead of superimposing two unrelated ones, and keeps the sample
        // sized against the population it is actually drawn from.
        if (kindIsPort(index, row) !== wantPort) continue
        if (hashHeight(heightAt(index, row)) < threshold) rows.push(row)
      }
    }
    const w = rows.length

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
      // The drawn set, by identity. With the threshold sized from the
      // projected in-plane population this is a safety cap on the GPU, not
      // the working decimation, so it gets headroom: the threshold targets
      // the budget in EXPECTATION, and a sample of a few thousand out of
      // half a million lands a percent either side of it. Capping at exactly
      // the budget would trim that ordinary overshoot, and because the trim
      // is sized from kept.length it moves on every rebuild, which is the
      // reshuffle again for the dots nearest the cut. Ten percent of slack
      // is many sigma of sampling noise and still bounds the buffer.
      const keptHeights = kept.map((row) => heightAt(index, row))
      const draw = drawnSet(keptHeights, Math.ceil(budget * HARD_CAP_SLACK))
      const count = draw.size
      const positions = new Float32Array(count * 3)
      const colors = new Float32Array(count * 3)
      const heights: number[] = new Array(count)
      let v = 0
      for (let k = 0; k < kept.length; k++) {
        if (!draw.has(keptHeights[k])) continue
        positions[v * 3] = centres[k * 3]
        positions[v * 3 + 1] = centres[k * 3 + 1]
        positions[v * 3 + 2] = centres[k * 3 + 2]
        const col = kindIsPort(index, kept[k]) ? PORT_COLOR : LANDFALL_COLOR
        colors[v * 3] = col.r
        colors[v * 3 + 1] = col.g
        colors[v * 3 + 2] = col.b
        heights[v] = keptHeights[k]
        v++
      }
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      // Same dev hook style as ShaderPointField: lets the browser harness
      // read what actually reached the GPU, decimation factor included.
      if (import.meta.env.DEV) {
        // Churn is the whole point of the sampler, so measure it rather than
        // eyeball it: a stable field evicts nothing, and any non-zero
        // `removed` here is a dot that was drawn and then taken away.
        const prev = lastDrawn
        let removed = 0
        if (prev && prev.frameKey === frameKey) for (const h of prev.set) if (!draw.has(h)) removed++
        lastDrawn = { frameKey, set: draw }
        const w = window as unknown as { __stopField?: unknown; __stopFieldLog?: unknown[] }
        const entry = {
          rendered: count, inRange: kept.length, threshold, runTotal,
          planeTotal, projected, permCount: index.permCount, total, removed,
          cappedBy: kept.length > budget * HARD_CAP_SLACK ? 'cap' : 'threshold',
        }
        w.__stopField = entry
        const log = (w.__stopFieldLog ??= []) as unknown[]
        log.push(entry)
        if (removed > 0) console.warn(`[stopField] rebuild evicted ${removed} of ${prev?.set.size} dots`, entry)
      }
      commit({
        geometry,
        heights,
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
    markSceneTapHandled()
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
