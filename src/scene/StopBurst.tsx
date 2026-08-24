/**
 * StopBurst.tsx - the rainbow lines living inside the blocks.
 *
 * Selecting a stop in the hyperspace UI (scrubbing to it, or setting it as
 * the destination) before boarding emits a short radial burst of rainbow
 * streaks from the block's cube, fading in about a second and a half. The
 * full surrounding warp (HyperspaceCone) is reserved for actually being in
 * transit, so the two together read as: the lines are inside the blocks, and
 * entering hyperspace puts you among them.
 *
 * One LineSegments draw call; positions come from the vertex shader, so a
 * burst allocates nothing per frame.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, ShaderMaterial } from 'three'
import { cellCentre, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { getStopByHeight, useHyperspace } from '../store/useHyperspace'
import { stopPlane, stopPosition } from '../hud/HyperspacePanel'

const STREAKS = 220
/** Seconds from emission to gone. */
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

interface Burst {
  height: number
  bornAt: number
}

export function StopBurst({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const inTransit = useCyberspace((s) => s.transit) !== null
  const scrubHeight = useHyperspace((s) => s.scrubHeight)
  const destination = useHyperspace((s) => s.destination)

  const [burst, setBurst] = useState<Burst | null>(null)

  // A new selection is a new emission; the full warp owns transit, so bursts
  // stand down once boarded.
  useEffect(() => {
    if (scrubHeight !== null && !inTransit) setBurst({ height: scrubHeight, bornAt: performance.now() })
  }, [scrubHeight, inTransit])
  useEffect(() => {
    if (destination !== null && !inTransit) setBurst({ height: destination, bornAt: performance.now() })
  }, [destination, inTransit])

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
  useFrame(() => {
    if (!burst) return
    const age = (performance.now() - burst.bornAt) / 1000
    material.uniforms.uAge.value = age
    if (age > LIFE && !done.current) {
      done.current = true
      setBurst(null)
    }
  })
  useEffect(() => { done.current = false }, [burst])

  const centre = useMemo(() => {
    if (!burst) return null
    const stop = getStopByHeight(burst.height)
    if (!stop || stopPlane(stop) !== anchorPlane) return null
    return cellCentre(stopPosition(stop), alignedOrigin(anchor, scaleExp), scaleExp, axes)
  }, [burst, anchor, anchorPlane, scaleExp, axes])

  if (!burst || !centre || inTransit) return null
  return (
    <group position={centre}>
      <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
    </group>
  )
}
