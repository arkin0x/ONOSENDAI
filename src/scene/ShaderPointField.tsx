/**
 * ShaderPointField.tsx — the terrain K field as GL_POINTS.
 *
 * One vertex per visible cell, sized and coloured by K in the shaders. The
 * field is the avatar's plane, so this is at most PLANE_SIZE^2 points, and the
 * CPU emits only cells it actually has, which means no culling work on the GPU.
 *
 * Positions are in cell units on the screen axes, the same frame BoundaryGrid,
 * Cursor and Avatar draw in, offset by the view window so the field stays put
 * while the camera pans to the cursor.
 */

import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
} from 'three'
import { createCircularTexture } from '../lib/circularTexture'
import { PLANE_SIZE, type TerrainPlane } from '../hooks/useTerrainPlane'
import { UNKNOWN } from '../workers/terrain.worker'
import type { ViewWindow } from '../hooks/useViewWindow'

interface Props {
  plane: TerrainPlane
  win: ViewWindow
}

/**
 * Vertex shader: size from K, in cell units scaled by the camera zoom.
 *
 * Radius is proportional to K, matching the tile renderer this replaces, so
 * K = 0 has no radius and disappears. Cells outside the universe never reach
 * here at all, since the CPU skips them.
 */
const vertexShader = /* glsl */ `
  attribute float aK;
  uniform float uTime;
  uniform float uPointSize;
  uniform float uZoom;

  varying float vK;

  void main() {
    vK = aK;

    float kFactor = aK / 16.0;
    float radius = uPointSize * kFactor;

    // Pulse for expensive terrain.
    if (kFactor > 0.7) {
      radius *= 1.0 + 0.06 * sin(uTime * 2.5 + float(gl_VertexID) * 0.37);
    }

    gl_PointSize = radius * 2.0 * uZoom;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Fragment shader: a soft circle, coloured by K. Stops match TERRAIN_STOPS. */
const fragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTime;

  varying float vK;

  vec3 terrainColor(float k) {
    vec3 c0  = vec3(0.024, 0.067, 0.110);
    vec3 c4  = vec3(0.043, 0.208, 0.314);
    vec3 c6  = vec3(0.055, 0.373, 0.478);
    vec3 c8  = vec3(0.110, 0.561, 0.478);
    vec3 c10 = vec3(0.561, 0.749, 0.247);
    vec3 c12 = vec3(0.910, 0.639, 0.239);
    vec3 c14 = vec3(0.949, 0.396, 0.235);
    vec3 c16 = vec3(1.000, 0.180, 0.420);

    if (k < 4.0)  return mix(c0,  c4,  k / 4.0);
    if (k < 6.0)  return mix(c4,  c6,  (k - 4.0)  / 2.0);
    if (k < 8.0)  return mix(c6,  c8,  (k - 6.0)  / 2.0);
    if (k < 10.0) return mix(c8,  c10, (k - 8.0)  / 2.0);
    if (k < 12.0) return mix(c10, c12, (k - 10.0) / 2.0);
    if (k < 14.0) return mix(c12, c14, (k - 12.0) / 2.0);
    return mix(c14, c16, (k - 14.0) / 2.0);
  }

  void main() {
    float alpha = texture2D(uTexture, gl_PointCoord).a;
    if (alpha < 0.01) discard;

    vec3 color = terrainColor(vK);

    float kFactor = vK / 16.0;
    if (kFactor > 0.7) {
      float dist = length(gl_PointCoord - 0.5);
      float pulse = 0.15 * (1.0 - dist * 2.0) * (0.5 + 0.5 * sin(uTime * 3.0));
      color += vec3(pulse);
    }

    gl_FragColor = vec4(color, alpha);
  }
`

function buildGeometry(plane: TerrainPlane, win: ViewWindow): BufferGeometry {
  const R = plane.radius
  const N = PLANE_SIZE
  const { values } = plane

  let count = 0
  for (let i = 0; i < values.length; i++) if (values[i] !== UNKNOWN) count++

  const positions = new Float32Array(count * 3)
  const kValues = new Float32Array(count)

  let v = 0
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const k = values[row * N + col]
      if (k === UNKNOWN) continue

      positions[v * 3] = win.right + (col - R)
      positions[v * 3 + 1] = win.up + (row - R)
      positions[v * 3 + 2] = 0
      kValues[v] = k
      v++
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aK', new Float32BufferAttribute(kValues, 1))

  // Lets the browser verifier read what actually reached the GPU.
  if (import.meta.env.DEV) {
    ;(window as unknown as { __terrainPoints?: number }).__terrainPoints = count
  }

  return geometry
}

export function ShaderPointField({ plane, win }: Props): JSX.Element {
  const pointsRef = useRef<Points>(null)

  const geometry = useMemo(() => buildGeometry(plane, win), [plane, win.right, win.up])

  // GPU buffers are not garbage collected; release each one when replaced.
  useEffect(() => () => geometry.dispose(), [geometry])

  const circularTexture = useMemo(() => createCircularTexture(64), [])
  useEffect(() => () => circularTexture.dispose(), [circularTexture])

  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTexture: { value: circularTexture },
      uTime: { value: 0 },
      uPointSize: { value: 0.4 },
      uZoom: { value: 8 },
    },
    transparent: true,
    depthWrite: false,
  }), [circularTexture])

  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    const pts = pointsRef.current
    if (!pts) return
    const mat = pts.material as ShaderMaterial
    if (!mat.uniforms) return

    mat.uniforms.uTime.value = state.clock.elapsedTime

    const camera = state.camera as unknown as { zoom?: number }
    if (camera.zoom !== undefined) mat.uniforms.uZoom.value = camera.zoom
  })

  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
  )
}
