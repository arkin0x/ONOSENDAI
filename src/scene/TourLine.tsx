/**
 * TourLine.tsx - the /demo hyperspace chapter's line (arkinox, 2026-10-15).
 *
 * While a tour step asks for it (DemoScene.hyperline), a line runs slowly
 * from one block's station to the next block's, on and on, turning around
 * at block 0 or the newest block known (demo/hyperLine.ts), and slowly cycles
 * through the hyperspace burst's colors (StopBurst BURST_COLOR_GLSL), once
 * round every HUE_TURN_S seconds.
 * Stations are placed as every stop marker is (stopPosition, markerCentre
 * against the anchor's aligned origin), and only the plane on show is
 * visited, as the stop field draws only that plane's stops.
 *
 * One Line: a fixed buffer of the last TRAIL stations plus the moving head,
 * written in place. Nothing is allocated per frame; placing a new station
 * (about once a second) is the only work beyond moving the head. The
 * geometry and material are freed when the step leaves, so the chapter
 * ends with nothing left behind.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, Line, ShaderMaterial } from 'three'
import { markerCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useDemo } from '../store/useDemo'
import { stopPlane, stopPosition } from '../hud/HyperspacePanel'
import { lineSource, nextStation, type LineSource, type LineWalk } from '../demo/hyperLine'
import { BURST_COLOR_GLSL } from './StopBurst'
import { useReducedMotion } from '../hooks/useReducedMotion'

/** Stations kept behind the head. */
const TRAIL = 48
/** Seconds the head takes from one station to the next. */
const SEGMENT_S = 0.9
/**
 * Seconds for the line's colors to go once round the hues. burstColor
 * multiplies what it is given by 9.31 before it takes the hue, so the old
 * 1.6 a second ran the rainbow about fifteen times a second, which read as
 * flicker (arkinox, 2026-10-27: "changing too fast to be perceptible").
 * Twelve seconds a turn is a color change you can watch happen.
 */
export const HUE_TURN_S = 12
/** What the shader adds to a vertex's seed per second for that: burstColor's 9.31 undone. */
export const CYCLE = 1 / (9.31 * HUE_TURN_S)

const vertexShader = /* glsl */ `
  attribute float aSeed;
  varying float vSeed;
  void main() {
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying float vSeed;
${BURST_COLOR_GLSL}
  void main() {
    gl_FragColor = vec4(burstColor(vSeed + uTime * ${CYCLE.toFixed(6)}), 0.9);
  }
`

/** Whether the step on screen asks for the line. */
export function TourLine({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const on = useDemo((s) => s.active && s.script.steps[s.index]?.scene.hyperline === true)
  return on ? <TourLineRun axes={axes} /> : null
}

interface Run {
  source: LineSource
  walk: LineWalk | null
  next: LineWalk | null
  /** Heights of the stations in the buffer, oldest first. */
  heights: Int32Array
  count: number
  t: number
  head: [number, number, number]
}

function TourLineRun({ axes }: { axes: ViewAxes }): JSX.Element {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // Asked for less motion, the colors hold still; the head still travels.
  const reduced = useReducedMotion()

  const line = useMemo(() => {
    const geometry = new BufferGeometry()
    const position = new BufferAttribute(new Float32Array((TRAIL + 1) * 3), 3)
    position.setUsage(DynamicDrawUsage)
    const seed = new BufferAttribute(new Float32Array(TRAIL + 1), 1)
    seed.setUsage(DynamicDrawUsage)
    geometry.setAttribute('position', position)
    geometry.setAttribute('aSeed', seed)
    geometry.setDrawRange(0, 0)
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      forceSinglePass: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    })
    const l = new Line(geometry, material)
    l.frustumCulled = false
    l.renderOrder = 9
    return l
  }, [])
  // Freed with the step: nothing of the line outlives the chapter.
  useEffect(() => () => { line.geometry.dispose(); (line.material as ShaderMaterial).dispose() }, [line])

  const run = useRef<Run | null>(null)

  // Where a block's station is drawn now, or null when it is not in the plane on show.
  const placeRef = useRef<(h: number) => [number, number, number] | null>(() => null)
  placeRef.current = (h: number) => {
    const stop = run.current?.source.stop(h)
    if (!stop || stopPlane(stop) !== anchorPlane) return null
    return markerCentre(stopPosition(stop), alignedOrigin(anchor, scaleExp), scaleExp, axes)
  }

  // Start from a random block's station; the view changing re-places what is drawn.
  useEffect(() => {
    if (!run.current) {
      const source = lineSource()
      const isStation = (h: number): boolean => { const s = source.stop(h); return !!s && stopPlane(s) === anchorPlane }
      const start = source.lo + Math.floor(Math.random() * (source.hi - source.lo + 1))
      const first: LineWalk = { height: start, dir: Math.random() < 0.5 ? 1 : -1 }
      const walk = isStation(start) ? first : nextStation(first, source.lo, source.hi, isStation)
      run.current = { source, walk, next: null, heights: new Int32Array(TRAIL), count: 0, t: 0, head: [0, 0, 0] }
      if (walk) {
        run.current.heights[0] = walk.height
        run.current.count = 1
        run.current.next = nextStation(walk, source.lo, source.hi, isStation)
      }
    }
    const r = run.current
    const pos = line.geometry.getAttribute('position') as BufferAttribute
    const seed = line.geometry.getAttribute('aSeed') as BufferAttribute
    for (let i = 0; i < r.count; i++) {
      const c = placeRef.current(r.heights[i]) ?? [0, 0, 0]
      pos.setXYZ(i, c[0], c[1], c[2])
      seed.setX(i, (r.heights[i] * 0.6180339887) % 1)
    }
    const n = r.next ? placeRef.current(r.next.height) : null
    r.head = n ?? r.head
    pos.needsUpdate = true
    seed.needsUpdate = true
  }, [line, anchor, anchorPlane, scaleExp, axes])

  useFrame((state, delta) => {
    const r = run.current
    ;(line.material as ShaderMaterial).uniforms.uTime.value = reduced ? 0 : state.clock.elapsedTime
    if (!r || !r.walk || !r.next || r.count === 0) return
    const pos = line.geometry.getAttribute('position') as BufferAttribute
    const seed = line.geometry.getAttribute('aSeed') as BufferAttribute
    r.t += delta / SEGMENT_S
    if (r.t >= 1) {
      // Arrived: the station joins the trail, and the head sets out for the next.
      r.t = 0
      if (r.count === TRAIL) {
        r.heights.copyWithin(0, 1)
        ;(pos.array as Float32Array).copyWithin(0, 3, TRAIL * 3)
        ;(seed.array as Float32Array).copyWithin(0, 1, TRAIL)
        r.count--
      }
      r.heights[r.count] = r.next.height
      pos.setXYZ(r.count, r.head[0], r.head[1], r.head[2])
      seed.setX(r.count, (r.next.height * 0.6180339887) % 1)
      r.count++
      r.walk = r.next
      const isStation = (h: number): boolean => placeRef.current(h) !== null
      r.next = nextStation(r.walk, r.source.lo, r.source.hi, isStation)
      const n = r.next ? placeRef.current(r.next.height) : null
      if (n) { r.head[0] = n[0]; r.head[1] = n[1]; r.head[2] = n[2] }
    }
    // The head, part way from the last station to the next.
    const last = r.count - 1
    const ax = pos.getX(last), ay = pos.getY(last), az = pos.getZ(last)
    pos.setXYZ(r.count, ax + (r.head[0] - ax) * r.t, ay + (r.head[1] - ay) * r.t, az + (r.head[2] - az) * r.t)
    seed.setX(r.count, seed.getX(last))
    pos.needsUpdate = true
    seed.needsUpdate = true
    line.geometry.setDrawRange(0, r.count + 1)
  })

  return <primitive object={line} />
}
