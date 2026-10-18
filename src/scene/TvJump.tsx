/**
 * TvJump.tsx: a hyperjump's ride on Cyberspace TV, after the tunnel: the two
 * blocks it rode between, and the line from one to the other with the rider
 * going along it (arkinox, 2026-10-18: "zoom out and show the line slowly
 * traveling between point a and b, and we should see the blocks a and b as
 * well, but all the other blocks not involved can be hidden").
 *
 * A ride passes through every block between A and B (lib/hyperspace/ride);
 * the line here is the straight one from A to B, which is what was asked for
 * and what reads at a glance. Only the two blocks are drawn, yellow and
 * turning as StopCubes draws a destination, each held at a size on screen
 * (lib/markerSize). Everything else on the tape steps aside while it plays
 * (TvLayer). A burst leaves A as the rider sets off and meets it at B.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, EdgesGeometry, Group, IcosahedronGeometry,
  Line, LineBasicMaterial, ShaderMaterial, Vector3, type PerspectiveCamera,
} from 'three'
import { markerCentre, type ViewAxes } from '../lib/space'
import { JUMP_WARP_S } from '../lib/tv/director'
import { DEST_CUBE_PX, markerSide, projScaleOf } from '../lib/markerSize'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { shotElapsed, useTv, type TvJump as Jump } from '../store/useTv'
import { CUT_MS } from '../hud/TvSegments'
import { BURST_COLOR_GLSL, BurstLines } from './StopBurst'
import { WorldLabel } from './WorldLabel'
import { AVATAR_RED } from './tvPainter'

/** How long the rider takes from A to B, seconds: slow enough to watch it go. */
export const TRAVEL_S = 4.2
/** When it sets off after the line comes up: once the cut's static has cleared. */
const TRAVEL_DELAY_S = CUT_MS / 1000 + 0.3
/** Points along the line, so its colours run along it rather than between two ends. */
const STEPS = 64
/** v1's HYPERJUMP yellow, as StopCubes draws a destination. */
const BLOCK_COLOR = '#ffff00'
/** The rider's size on screen, CSS px. */
const RIDER_PX = 14
/** How fast the blocks and the rider turn, radians a second. */
const SPIN = 0.7
/** How fast the colours run along the line, in hue turns a second (TourLine's pace). */
const CYCLE = 1.6

/** How far along the line the rider is at `elapsed` seconds into the shot, 0 to 1: eased in and out. */
export function rideAlong(elapsed: number): number {
  const t = Math.min(1, Math.max(0, (elapsed - JUMP_WARP_S - TRAVEL_DELAY_S) / TRAVEL_S))
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}

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
    gl_FragColor = vec4(burstColor(vSeed + uTime * ${CYCLE.toFixed(2)}), 0.9);
  }
`

/** The ride's line and blocks, while TV is on it. */
export function TvJump({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const jump = useTv((s) => s.jump)
  return jump?.phase === 'line' ? <Ride jump={jump} axes={axes} /> : null
}

function Ride({ jump, axes }: { jump: Jump; axes: ViewAxes }): JSX.Element {
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const [a, b] = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    return [markerCentre(jump.from.position, origin, scaleExp, axes), markerCentre(jump.to.position, origin, scaleExp, axes)]
  }, [jump, anchor, scaleExp, axes])
  // Some early rides went to the block they left from: one block, then.
  const one = jump.from.height === jump.to.height
  const gibson = 2 ** -scaleExp

  const line = useMemo(() => {
    const geometry = new BufferGeometry()
    const position = new BufferAttribute(new Float32Array((STEPS + 1) * 3), 3)
    position.setUsage(DynamicDrawUsage)
    const seed = new Float32Array(STEPS + 1)
    for (let i = 0; i <= STEPS; i++) seed[i] = (i / STEPS) * 1.5
    geometry.setAttribute('position', position)
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1))
    geometry.setDrawRange(0, 0)
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader,
      fragmentShader,
      transparent: true,
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
  const rider = useMemo(() => ({
    geometry: new EdgesGeometry(new IcosahedronGeometry(0.5, 1)),
    material: new LineBasicMaterial({ color: AVATAR_RED, toneMapped: false }),
  }), [])
  useEffect(() => () => {
    line.geometry.dispose()
    ;(line.material as ShaderMaterial).dispose()
    rider.geometry.dispose()
    rider.material.dispose()
  }, [line, rider])

  const blocks = useRef<Group>(null)
  const head = useRef<Group>(null)
  const eye = useMemo(() => new Vector3(), [])
  const scratch = useMemo(() => new Vector3(), [])
  const [departed, setDeparted] = useState<number | null>(null)
  const [arrived, setArrived] = useState<number | null>(null)

  useFrame((state, dt) => {
    const t = rideAlong(shotElapsed())
    const hx = a[0] + (b[0] - a[0]) * t
    const hy = a[1] + (b[1] - a[1]) * t
    const hz = a[2] + (b[2] - a[2]) * t
    // The line grows behind the rider, from A to where it is.
    const pos = line.geometry.getAttribute('position') as BufferAttribute
    for (let i = 0; i <= STEPS; i++) {
      const k = i / STEPS
      pos.setXYZ(i, a[0] + (hx - a[0]) * k, a[1] + (hy - a[1]) * k, a[2] + (hz - a[2]) * k)
    }
    pos.needsUpdate = true
    line.geometry.setDrawRange(0, t > 0 ? STEPS + 1 : 0)
    ;(line.material as ShaderMaterial).uniforms.uTime.value = state.clock.elapsedTime

    state.camera.getWorldPosition(eye)
    const projScale = projScaleOf(state.size.height, (state.camera as PerspectiveCamera).fov)
    const fit = (o: { getWorldPosition: (v: Vector3) => Vector3; scale: Vector3 }, px: number): void => {
      o.scale.setScalar(markerSide(gibson, px, eye.distanceTo(o.getWorldPosition(scratch)), projScale))
    }
    for (const cube of blocks.current?.children ?? []) {
      cube.rotation.x += dt * SPIN
      cube.rotation.y += dt * SPIN * 1.3
      fit(cube, DEST_CUBE_PX)
    }
    const h = head.current
    if (h) {
      h.position.set(hx, hy, hz)
      h.rotation.y += dt * SPIN * 2
      h.visible = t > 0 && t < 1
      fit(h, RIDER_PX)
    }
    if (t > 0 && departed === null) setDeparted(performance.now())
    if (t >= 1 && arrived === null) setArrived(performance.now())
  })

  return (
    <>
      <primitive object={line} />
      <group ref={blocks}>
        {(one ? [a] : [a, b]).map((c, i) => (
          <mesh key={i} position={c}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color={BLOCK_COLOR} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <group ref={head}>
        <lineSegments geometry={rider.geometry} material={rider.material} />
      </group>
      {(one ? [{ at: a, height: jump.from.height }] : [{ at: a, height: jump.from.height }, { at: b, height: jump.to.height }]).map((l) => (
        <WorldLabel key={l.height} text={`BLOCK ${l.height}`} color={BLOCK_COLOR} at={l.at} clear={{ trueSide: gibson, minPx: DEST_CUBE_PX }} align="center" px={12} opacity={0.95} />
      ))}
      {departed !== null && <BurstLines centre={a} bornAt={departed} />}
      {arrived !== null && <BurstLines centre={b} bornAt={arrived} />}
    </>
  )
}
