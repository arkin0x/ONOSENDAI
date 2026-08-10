/**
 * ShaderPointField.tsx — GPU-accelerated Gibson point rendering via GL_POINTS.
 *
 * Instead of instanced sphere geometry (256 vertices per point), this uses a
 * single vertex per Gibson coordinate with a custom shader. The vertex shader
 * computes screen-space size from the K value and camera zoom; the fragment
 * shader renders each point as a circle with soft edges and K-mapped color.
 *
 * Performance: ~256x less geometry data vs InstancedMesh, all per-frame
 * transformations happen on GPU via uniforms, no CPU matrix math.
 */

import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef, useMemo } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector2,
} from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { createCircularTexture } from '../lib/circularTexture'
import type { TerrainField as TerrainFieldData } from '../hooks/useTerrainField'

interface Props {
  field: TerrainFieldData
  /** If provided, animate opacity from 0 to 1 (in) or from 1 to 0 (out). */
  fadeDirection?: 'in' | 'out'
  /** Duration of fade animation in seconds. */
  fadeDuration?: number
  /** Called when fade animation completes. */
  onFadeComplete?: () => void
}

/**
 * Vertex shader: positions each point and computes its screen-space size.
 *
 * Attributes:
 *   position — local grid coordinates (col, row, 0)
 *   aK — terrain K value [0, 16] for this point
 *
 * Uniforms:
 *   uTime — animation clock for pulsing high-K points
 *   uFocusPoint — screen-space focus (cursor) for distance attenuation
 *   uPointSize — base point diameter in world units
 *   uZoom — camera zoom factor (orthographic)
 */
const vertexShader = /* glsl */ `
  attribute float aK;
  uniform float uTime;
  uniform vec2 uFocusPoint;
  uniform float uPointSize;
  uniform float uZoom;

  varying float vK;

  void main() {
    vK = aK;

    // K factor: 0 at K=0 (invisible), 1 at K=16 (largest).
    float kFactor = aK / 16.0;

    // Base radius scales linearly with K.
    float radius = uPointSize * kFactor;

    // Distance attenuation: points farther from focus shrink slightly.
    float dist = length(position.xy - uFocusPoint);
    radius *= 1.0 / (1.0 + 0.04 * dist);

    // Subtle pulse for expensive terrain (K > 11).
    if (kFactor > 0.7) {
      radius *= 1.0 + 0.06 * sin(uTime * 2.5 + float(gl_VertexID) * 0.37);
    }

    // Orthographic: gl_PointSize is in pixels, scale by camera zoom.
    gl_PointSize = radius * 2.0 * uZoom;

    // Standard projection (orthographic ignores z for size, which is correct).
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`

/**
 * Fragment shader: renders each GL_POINTS sprite as a soft-edged circle.
 *
 * Uses gl_PointCoord to sample a precomputed circular texture, then applies
 * the K-to-color ramp. The texture provides smooth falloff from center to edge.
 */
const fragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTime;

  varying float vK;

  /**
   * Terrain color ramp matching palette.ts TERRAIN_STOPS.
   * K is Binomial(16, 0.5), so stops are concentrated in the 5..11 band.
   */
  vec3 terrainColor(float k) {
    vec3 c0  = vec3(0.024, 0.067, 0.110);  // K=0  #06111c
    vec3 c4  = vec3(0.043, 0.208, 0.314);  // K=4  #0b3550
    vec3 c6  = vec3(0.055, 0.373, 0.478);  // K=6  #0e5f7a
    vec3 c8  = vec3(0.110, 0.561, 0.478);  // K=8  #1c8f7a
    vec3 c10 = vec3(0.561, 0.749, 0.247);  // K=10 #8fbf3f
    vec3 c12 = vec3(0.910, 0.639, 0.239);  // K=12 #e8a33d
    vec3 c14 = vec3(0.949, 0.396, 0.235);  // K=14 #f2653c
    vec3 c16 = vec3(1.000, 0.180, 0.420);  // K=16 #ff2e6b

    if (k < 4.0)  return mix(c0,  c4,  k / 4.0);
    if (k < 6.0)  return mix(c4,  c6,  (k - 4.0)  / 2.0);
    if (k < 8.0)  return mix(c6,  c8,  (k - 6.0)  / 2.0);
    if (k < 10.0) return mix(c8,  c10, (k - 8.0)  / 2.0);
    if (k < 12.0) return mix(c10, c12, (k - 10.0) / 2.0);
    if (k < 14.0) return mix(c12, c14, (k - 12.0) / 2.0);
    return mix(c14, c16, (k - 14.0) / 2.0);
  }

  void main() {
    // Sample the circular texture using gl_PointCoord.
    // The texture is a radial gradient from center (1.0) to edge (0.0).
    float alpha = texture2D(uTexture, gl_PointCoord).a;

    // Discard fully transparent fragments (outside the circle).
    if (alpha < 0.01) discard;

    // Color from K value.
    vec3 color = terrainColor(vK);

    // Subtle glow for expensive terrain (K > 11).
    float kFactor = vK / 16.0;
    if (kFactor > 0.7) {
      // Pulsing glow based on time and distance from center.
      float dist = length(gl_PointCoord - 0.5);
      float pulse = 0.15 * (1.0 - dist * 2.0) * (0.5 + 0.5 * sin(uTime * 3.0));
      color += vec3(pulse);
    }

    gl_FragColor = vec4(color, alpha);
  }
`

export function ShaderPointField({ field, fadeDirection, fadeDuration = 0.5, onFadeComplete }: Props): JSX.Element {
  const pointsRef = useRef<Points>(null)
  const size = GRID_RADIUS * 2 + 1
  const count = size * size

  // Fade animation state — refs survive re-renders.
  const fadeProgress = useRef(1)
  const fadeComplete = useRef(true)
  const prevFadeDir = useRef(fadeDirection)

  // Reset fade state when direction changes (refs don't re-initialize on re-render).
  if (fadeDirection !== prevFadeDir.current) {
    prevFadeDir.current = fadeDirection
    if (fadeDirection === 'in') {
      fadeProgress.current = 0
      fadeComplete.current = false
    } else if (fadeDirection === 'out') {
      fadeProgress.current = 1
      fadeComplete.current = false
    } else {
      fadeProgress.current = 1
      fadeComplete.current = true
    }
  }

  // Build geometry once. Positions are a static grid; K values update via effect.
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const kValues = new Float32Array(count)

    let i = 0
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        positions[i * 3]     = col - GRID_RADIUS
        positions[i * 3 + 1] = row - GRID_RADIUS
        positions[i * 3 + 2] = 0
        kValues[i] = 8  // Default until worker responds
        i++
      }
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geo.setAttribute('aK', new Float32BufferAttribute(kValues, 1))
    return geo
  // size/count are constants, so this runs exactly once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update K values when the terrain field changes.
  useLayoutEffect(() => {
    const kAttr = geometry.getAttribute('aK') as Float32BufferAttribute
    if (!field.values) return

    const arr = kAttr.array as Float32Array
    for (let i = 0; i < count; i++) {
      const k = field.values[i]
      // K=255 means out-of-bounds: render as invisible (K=0).
      arr[i] = k === 255 ? 0 : k
    }
    kAttr.needsUpdate = true
  }, [field, geometry, count])

  // Shader material — created once, uniforms updated per-frame.
  const circularTexture = useMemo(() => createCircularTexture(64), [])

  const material = useMemo(() => {
    return new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTexture:   { value: circularTexture },
        uTime:      { value: 0 },
        uFocusPoint:{ value: new Vector2(0, 0) },
        uPointSize: { value: 0.4 },   // World units (matches old sphere radius at K=16)
        uFade:      { value: 1 },
        uZoom:      { value: 8 },     // Matches Canvas camera zoom
      },
      transparent: true,
      depthWrite: false,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circularTexture])

  // Per-frame: update time, focus point, and fade uniform.
  useFrame((state, delta) => {
    const pts = pointsRef.current
    if (!pts) return
    const mat = pts.material as ShaderMaterial
    if (!mat.uniforms) return

    // Clock for pulsing animation.
    mat.uniforms.uTime.value = state.clock.elapsedTime

    // Focus point tracks the cursor in local grid space.
    const cursorOffset = useCyberspace.getState().cursorOffset()
    mat.uniforms.uFocusPoint.value.set(cursorOffset[0], cursorOffset[1])

    // Camera zoom may change via user interaction.
    const camera = state.camera as any
    if (camera.zoom !== undefined) {
      mat.uniforms.uZoom.value = camera.zoom
    }

    // Fade animation.
    if (!fadeComplete.current) {
      const speed = 1 / fadeDuration
      if (fadeDirection === 'in') {
        fadeProgress.current = Math.min(1, fadeProgress.current + delta * speed)
        if (fadeProgress.current >= 1) {
          fadeComplete.current = true
          onFadeComplete?.()
        }
      } else if (fadeDirection === 'out') {
        fadeProgress.current = Math.max(0, fadeProgress.current - delta * speed)
        if (fadeProgress.current <= 0) {
          fadeComplete.current = true
          onFadeComplete?.()
        }
      }
      mat.uniforms.uFade.value = fadeProgress.current
    }
  })

  // Click handling: convert screen point to grid coordinates.
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (fadeDirection === 'out') return
    event.stopPropagation()

    const pts = pointsRef.current
    if (!pts) return
    const localPoint = event.point.clone()
    pts.worldToLocal(localPoint)

    const col = Math.round(localPoint.x + GRID_RADIUS)
    const row = Math.round(localPoint.y + GRID_RADIUS)
    if (row < 0 || row >= size || col < 0 || col >= size) return
    useCyberspace.getState().setCursorAtCell(row, col)
  }

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      onClick={handleClick}
    />
  )
}
