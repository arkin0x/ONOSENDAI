/**
 * StopBurst.tsx - the rainbow lines living inside the blocks.
 *
 * Setting a stop as the destination emits a one-shot radial burst of rainbow
 * streaks from its cube, fading in about a second and a half. Your station
 * (the stop nearest your avatar, the one boarding sets you down at) instead
 * pulses the same burst continuously while you are viewing it: that block is
 * your entry to the line, so the lines never quite leave it. The full
 * surrounding warp (HyperspaceCone) stays reserved for actually being in
 * transit, so the three read together as: the lines live inside the blocks,
 * the ones at your door keep spilling out, and boarding puts you among them.
 *
 * One LineSegments draw call per burst (at most two: the station pulse and a
 * destination shot); positions come from the vertex shader, so a burst
 * allocates nothing per frame.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, ShaderMaterial } from 'three'
import { xyzToCoord } from 'cyberspace-core'
import { pointCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { getStopByHeight, getStopIndex, useHyperspace } from '../store/useHyperspace'
import { nearestStops } from '../lib/hyperspace/station'
import { stopPlane, stopPosition } from '../hud/HyperspacePanel'

const STREAKS = 220
/** Seconds from emission to gone (one pulse period when looping). */
const LIFE = 1.6
/** How far the streaks reach, in render cells. */
const REACH = 6

const vertexShader = /* glsl */ `
  attribute vec3 aDir;
  attribute float aSeed;
  attribute float aEnd;
  uniform float uAge;
  varying float vSeed;
  varying float vFade;

  void main() {
    float t = clamp(uAge / ${LIFE.toFixed(2)}, 0.0, 1.0);
    // Ease out: fast leaving the block, slowing as it dies.
    float travel = 1.0 - (1.0 - t) * (1.0 - t);
    float reach = ${REACH.toFixed(1)} * (0.4 + aSeed * 0.6);
    float head = 0.15 + travel * reach;
    float len = (0.5 + aSeed * 1.2) * (1.0 - 0.6 * t);
    vec3 pos = aDir * (head - aEnd * len);
    vFade = (1.0 - t) * (1.0 - t);
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  varying float vSeed;
  varying float vFade;

  vec3 hue2rgb(float h) {
    vec3 p = abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return clamp(p - 1.0, 0.0, 1.0);
  }

  void main() {
    float a = vFade * 0.75;
    if (a < 0.02) discard;
    gl_FragColor = vec4(hue2rgb(fract(vSeed * 9.31)) * 0.75, a);
  }
`

/** One emitting block: its own material (uAge is per-burst), shared shape. */
function BurstLines({
  centre,
  bornAt,
  loop,
  onDone,
}: {
  centre: [number, number, number]
  bornAt: number
  loop?: boolean
  onDone?: () => void
}): JSX.Element {
  const geometry = useMemo(() => {
    const dirs = new Float32Array(STREAKS * 2 * 3)
    const seeds = new Float32Array(STREAKS * 2)
    const ends = new Float32Array(STREAKS * 2)
    const positions = new Float32Array(STREAKS * 2 * 3)
    for (let i = 0; i < STREAKS; i++) {
      // Golden-angle sphere spread: deterministic, no clumping at the poles.
      const z = 1 - (2 * (i + 0.5)) / STREAKS
      const r = Math.sqrt(Math.max(0, 1 - z * z))
      const phi = i * 2.399963229728653
      const dir = [r * Math.cos(phi), z, r * Math.sin(phi)]
      const seed = (i * 0.6180339887) % 1
      for (const end of [0, 1]) {
        const v = i * 2 + end
        dirs[v * 3] = dir[0]
        dirs[v * 3 + 1] = dir[1]
        dirs[v * 3 + 2] = dir[2]
        seeds[v] = seed
        ends[v] = end
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geo.setAttribute('aDir', new Float32BufferAttribute(dirs, 3))
    geo.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1))
    geo.setAttribute('aEnd', new Float32BufferAttribute(ends, 1))
    return geo
  }, [])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uAge: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  )
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  const done = useRef(false)
  useEffect(() => { done.current = false }, [bornAt])
  useFrame(() => {
    const age = (performance.now() - bornAt) / 1000
    // Looping restarts the emission each period: the station's beacon.
    material.uniforms.uAge.value = loop ? age % LIFE : age
    if (!loop && age > LIFE && !done.current) {
      done.current = true
      onDone?.()
    }
  })

  return (
    <group position={centre}>
      <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
    </group>
  )
}

interface Shot {
  height: number
  bornAt: number
}

export function StopBurst({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const position = useCyberspace((s) => s.position)
  const plane = useCyberspace((s) => s.plane)
  const inTransit = useCyberspace((s) => s.transit) !== null
  const destination = useHyperspace((s) => s.destination)
  const viewedStop = useHyperspace((s) => s.viewedStop)
  const indexVersion = useHyperspace((s) => s.indexVersion)

  // The one-shot: exactly when a block is SET as the destination, never on a
  // scrub (browsing is looking, not choosing). The full warp owns transit,
  // so shots stand down once boarded.
  const [shot, setShot] = useState<Shot | null>(null)
  useEffect(() => {
    if (destination !== null && !inTransit) setShot({ height: destination, bornAt: performance.now() })
  }, [destination, inTransit])

  // The station: the stop nearest the avatar's committed position, i.e. the
  // block boarding would set you down at. While the owned view is on it, it
  // pulses persistently: that block is your entry point.
  const station = useMemo(() => {
    void indexVersion
    const index = getStopIndex()
    if (index.permCount === 0) return null
    const here = xyzToCoord(position.x, position.y, position.z, plane)
    return nearestStops(index, here, 1)[0]?.stop.height ?? null
  }, [position, plane, indexVersion])
  const sustained = viewedStop !== null && viewedStop === station ? station : null

  const centreOf = (height: number | null): [number, number, number] | null => {
    if (height === null) return null
    const stop = getStopByHeight(height)
    if (!stop || stopPlane(stop) !== anchorPlane) return null
    return pointCentre(stopPosition(stop), alignedOrigin(anchor, scaleExp), scaleExp, axes)
  }
  const sustainedCentre = useMemo(
    () => centreOf(sustained),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sustained, anchor, anchorPlane, scaleExp, axes, indexVersion],
  )
  const shotCentre = useMemo(
    () => (shot !== null && shot.height !== sustained ? centreOf(shot.height) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shot, sustained, anchor, anchorPlane, scaleExp, axes, indexVersion],
  )

  if (inTransit) return null
  return (
    <>
      {sustainedCentre && <BurstLines centre={sustainedCentre} bornAt={0} loop />}
      {shot && shotCentre && (
        <BurstLines centre={shotCentre} bornAt={shot.bornAt} onDone={() => setShot(null)} />
      )}
    </>
  )
}
