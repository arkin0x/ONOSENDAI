/**
 * HyperspaceCone.tsx - the hyperspace sky, now as warp streaks.
 *
 * DECK-0001: hyperspace is a one-dimensional transit line threaded through
 * cyberspace by proof of work. While the identity is riding it (transit is
 * set) the environment should feel different; browsing the line instead gets
 * per-block bursts (StopBurst), so the streaks read as living inside the
 * blocks and boarding puts you among them.
 *
 * The first version was a full-screen additive cone: every pixel of every
 * frame paid transparent overdraw and then fed the bloom pass, which is why
 * it dragged the whole browser. This version is a single LineSegments draw
 * call: a few hundred thin rainbow streaks around the periphery rushing past
 * the camera, positioned entirely in the vertex shader, so the fill cost is
 * a few thousand line pixels instead of the whole screen.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  ShaderMaterial,
} from 'three'
import { useCyberspace } from '../store/useCyberspace'

/** How many streaks; one draw call regardless. */
const STREAKS = 420
/** Depth of the field along the view axis, in render units. */
const RANGE = 2200
/** The streak ring: clear in the middle so the world stays legible. */
const R_MIN = 120
const R_MAX = 520

const vertexShader = /* glsl */ `
  attribute float aSeed;
  attribute float aAngle;
  attribute float aRadius;
  attribute float aLen;
  attribute float aEnd;
  uniform float uTime;
  varying float vSeed;
  varying float vFade;

  void main() {
    // The streak's head position cycles toward the camera; the tail trails
    // behind it by aLen. Everything lives in camera-pinned group space where
    // -Z is ahead.
    float speed = 260.0 + aSeed * 340.0;
    float zHead = -${RANGE.toFixed(1)} + mod(aSeed * ${RANGE.toFixed(1)} + uTime * speed, ${RANGE.toFixed(1)});
    float z = zHead - aEnd * aLen;
    vec3 pos = vec3(cos(aAngle) * aRadius, sin(aAngle) * aRadius, z);
    // Fade in at the far end, out just before the camera plane.
    float depth = -z / ${RANGE.toFixed(1)};
    vFade = smoothstep(0.0, 0.12, depth) * (1.0 - smoothstep(0.82, 1.0, depth));
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying float vSeed;
  varying float vFade;

  vec3 hue2rgb(float h) {
    vec3 p = abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return clamp(p - 1.0, 0.0, 1.0);
  }

  void main() {
    // Each streak keeps one hue, slowly drifting, so the field reads as a
    // moving rainbow without strobing. Kept dim: bloom amplifies everything.
    vec3 color = hue2rgb(fract(vSeed * 7.13 + uTime * 0.03));
    float a = vFade * 0.55;
    if (a < 0.02) discard;
    gl_FragColor = vec4(color * 0.7, a);
  }
`

export function HyperspaceCone(): JSX.Element | null {
  // The sky belongs to being IN hyperspace: it shows only while boarded and
  // not yet arrived. Browsing the line gets per-block bursts (StopBurst)
  // instead, so the streaks read as living inside the blocks and boarding
  // puts you among them.
  const active = useCyberspace((s) => s.transit) !== null

  const geometry = useMemo(() => {
    const seeds = new Float32Array(STREAKS * 2)
    const angles = new Float32Array(STREAKS * 2)
    const radii = new Float32Array(STREAKS * 2)
    const lens = new Float32Array(STREAKS * 2)
    const ends = new Float32Array(STREAKS * 2)
    const positions = new Float32Array(STREAKS * 2 * 3) // shader-computed; attribute must exist
    for (let i = 0; i < STREAKS; i++) {
      const seed = (i * 0.6180339887) % 1 // golden-ratio spread, deterministic
      const angle = seed * Math.PI * 2 * 13.7
      const radius = R_MIN + ((i * 0.7548776662) % 1) * (R_MAX - R_MIN)
      const len = 90 + ((i * 0.5698402911) % 1) * 260
      for (const end of [0, 1]) {
        const v = i * 2 + end
        seeds[v] = seed
        angles[v] = angle
        radii[v] = radius
        lens[v] = len
        ends[v] = end
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geo.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1))
    geo.setAttribute('aAngle', new Float32BufferAttribute(angles, 1))
    geo.setAttribute('aRadius', new Float32BufferAttribute(radii, 1))
    geo.setAttribute('aLen', new Float32BufferAttribute(lens, 1))
    geo.setAttribute('aEnd', new Float32BufferAttribute(ends, 1))
    return geo
  }, [])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  )

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  const group = useRef<Group>(null)
  useFrame((state) => {
    const g = group.current
    if (!g) return
    g.position.copy(state.camera.position)
    g.quaternion.copy(state.camera.quaternion)
    material.uniforms.uTime.value = state.clock.elapsedTime
  })

  if (!active) return null
  return (
    <group ref={group}>
      <lineSegments geometry={geometry} material={material} renderOrder={-10} frustumCulled={false} />
    </group>
  )
}
