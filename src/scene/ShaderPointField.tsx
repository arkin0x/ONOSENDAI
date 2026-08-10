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
import { PLANE_SIZE, type TerrainPlane } from '../hooks/useTerrainPlane'
import { UNKNOWN } from '../workers/terrain.worker'
import type { ViewWindow } from '../hooks/useViewWindow'

interface Props {
  plane: TerrainPlane
  win: ViewWindow
}

/**
 * Vertex shader: point size in pixels, from K.
 *
 * K = 0 has no size and disappears, as do cells outside the universe, which
 * arrive as 0. From K = 1 up the size runs between a pixel floor and a
 * fraction of a tile.
 */
const vertexShader = /* glsl */ `
  attribute float aK;
  uniform float uTime;
  uniform float uMinPx;
  uniform float uMaxTileFrac;
  uniform float uGamma;
  uniform float uZoom;
  uniform float uDpr;

  varying float vK;
  varying float vPx;

  void main() {
    vK = aK;

    // Sized in pixels, between a floor and a fraction of a tile. uZoom is the
    // orthographic camera's pixels per world unit, and the scene draws one
    // unit per cell, so uZoom is the tile width on screen.
    //
    // K = 0 keeps zero size and disappears, which is also how cells outside
    // the universe read, since they arrive as 0. Everything from K = 1 up gets
    // at least uMinPx: scaling straight from zero put the low end at well under
    // a pixel, so most of the field was invisible rather than merely small.
    float px = 0.0;

    if (aK >= 1.0) {
      float maxPx = max(uMaxTileFrac * uZoom, uMinPx);

      // Weighted toward the top of the range. K is Binomial(16, 0.5), so it
      // piles up around 8 and only about 1% of cells reach 13 or above. A
      // linear ramp spends most of its width on the values that are everywhere
      // and leaves the rare expensive terrain looking much like the rest.
      // Raising t to uGamma keeps 1..10 close to the floor and puts the growth
      // where the interesting cells are.
      float t = pow((aK - 1.0) / 15.0, uGamma);
      px = mix(uMinPx, maxPx, t);

      // Pulse for expensive terrain.
      float kFactor = aK / 16.0;
      if (kFactor > 0.7) {
        px *= 1.0 + 0.06 * sin(uTime * 2.5 + float(gl_VertexID) * 0.37);
      }
    }

    // gl_PointSize is in drawing-buffer pixels, but uZoom comes from the
    // renderer's CSS size, so on a high-DPI display the two disagree and every
    // dot lands at 1/dpr of its intended size against the tile.
    vPx = px * uDpr;
    gl_PointSize = vPx;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * Fragment shader: a solid disc, coloured by K. Stops match TERRAIN_STOPS.
 *
 * The disc is computed from gl_PointCoord rather than sampled from a gradient
 * texture. The texture faded linearly from the centre, so alpha was already
 * half at half the radius and the visible dot measured about 4px inside a 9px
 * sprite. Here the disc is solid to its rim with a fixed ~2px feathered edge,
 * so what you see is the size that was asked for.
 */
const fragmentShader = /* glsl */ `
  uniform float uTime;

  varying float vK;
  varying float vPx;

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
    // 0 at the centre, 1 at the sprite's rim.
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;

    // Feather a constant couple of pixels, whatever the dot's size.
    float edge = clamp(2.0 / max(vPx, 1.0), 0.04, 0.5);
    float alpha = 1.0 - smoothstep(1.0 - edge, 1.0, d);
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

  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      // Small and flat across the common K values, growing sharply at the top.
      uMinPx: { value: 2 },
      uMaxTileFrac: { value: 0.45 },
      uGamma: { value: 3 },
      uZoom: { value: 8 },
      uDpr: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
  }), [])

  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    const pts = pointsRef.current
    if (!pts) return
    const mat = pts.material as ShaderMaterial
    if (!mat.uniforms) return

    mat.uniforms.uTime.value = state.clock.elapsedTime

    const camera = state.camera as unknown as { zoom?: number }
    if (camera.zoom !== undefined) mat.uniforms.uZoom.value = camera.zoom
    mat.uniforms.uDpr.value = state.gl.getPixelRatio()
  })

  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
  )
}
