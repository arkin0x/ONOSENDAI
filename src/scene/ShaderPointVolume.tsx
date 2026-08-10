/**
 * ShaderPointVolume.tsx — GPU-accelerated 3D Gibson point rendering.
 *
 * Renders all loaded terrain chunks as a single GL_POINTS draw call.
 * The vertex shader applies box culling via uniforms (uBoxMin/uBoxMax),
 * allowing the visible volume to animate from a thin slab (normal view)
 * to a full cube (during rotation transitions).
 *
 * The box dimensions are controlled by the parent component, typically
 * based on rotation state and camera frustum.
 */

import { useFrame } from '@react-three/fiber'
import { useRef, useMemo, useEffect } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { stepFor } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { createCircularTexture } from '../lib/circularTexture'
import type { ChunkMap, } from '../hooks/useTerrainChunks'
import { CHUNK_SIZE } from '../hooks/useTerrainChunks'

interface Props {
  chunks: ChunkMap
  /** Minimum corner of the visible box in local grid space. */
  boxMin: [number, number, number]
  /** Maximum corner of the visible box in local grid space. */
  boxMax: [number, number, number]
  /** Fade animation direction and duration. */
  fadeDirection?: 'in' | 'out'
  fadeDuration?: number
  onFadeComplete?: () => void
}

/**
 * Vertex shader: positions each point and applies box culling.
 *
 * Attributes:
 *   position — world grid coordinates (x, y, z)
 *   aK — terrain K value [0, 16]
 *
 * Uniforms:
 *   uBoxMin/uBoxMax — visible volume bounds (culls points outside)
 *   uTime — animation clock
 *   uFocusPoint — cursor/position for distance attenuation
 *   uPointSize — base point diameter in world units
 *   uZoom — camera zoom factor
 */
const vertexShader = /* glsl */ `
  attribute float aK;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform float uTime;
  uniform vec2 uFocusPoint;
  uniform float uPointSize;
  uniform float uZoom;

  varying float vK;

  void main() {
    // Box culling: discard points outside the visible volume.
    if (position.x < uBoxMin.x || position.x > uBoxMax.x ||
        position.y < uBoxMin.y || position.y > uBoxMax.y ||
        position.z < uBoxMin.z || position.z > uBoxMax.z) {
      gl_Position = vec4(0, 0, -2, 1);
      gl_PointSize = 0.0;
      return;
    }

    vK = aK;

    float kFactor = aK / 16.0;
    float radius = uPointSize * (0.5 + 0.5 * kFactor);  // Increased base size

    // Distance attenuation from focus point (2D screen projection).
    float dist = length(position.xy - uFocusPoint);
    radius *= 1.0 / (1.0 + 0.02 * dist);  // Reduced attenuation

    // Pulse for expensive terrain.
    if (kFactor > 0.7) {
      radius *= 1.0 + 0.06 * sin(uTime * 2.5 + float(gl_VertexID) * 0.37);
    }

    gl_PointSize = radius * 2.0 * uZoom;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`

/**
 * Fragment shader: renders each point as a soft-edged circle with K-mapped color.
 */
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

/**
 * Cell index range within one chunk axis that falls inside the box.
 *
 * A cell's local coordinate is `(base + d) * step`, so in cell units the box
 * admits `d` where `minCell <= base + d <= maxCell`. Returns null when the
 * chunk does not reach the box on this axis.
 */
function axisRange(base: number, minCell: number, maxCell: number): [number, number] | null {
  const lo = Math.max(0, Math.ceil(minCell - base))
  const hi = Math.min(CHUNK_SIZE - 1, Math.floor(maxCell - base))
  return lo > hi ? null : [lo, hi]
}

/**
 * Flatten the chunk cells that fall inside the box into a single geometry.
 *
 * Only in-box cells are emitted. The shader also culls against the box, but
 * that happens after every vertex has been allocated and uploaded, so it saves
 * nothing on its own: with the default 5³ chunk load and a ±GRID_RADIUS box,
 * roughly 0.8% of the loaded cells are ever visible. Filtering here is what
 * keeps the buffer (and the GPU upload) proportional to what is on screen.
 */
function buildGeometryFromChunks(
  chunks: ChunkMap,
  scaleExp: number,
  focusChunkX: number,
  focusChunkY: number,
  focusChunkZ: number,
  boxMin: [number, number, number],
  boxMax: [number, number, number],
): BufferGeometry {
  const chunkList = Object.values(chunks)
  const step = Number(stepFor(scaleExp))
  const halfSize = Math.floor(CHUNK_SIZE / 2)

  // Box bounds in cell units, matching the geometry's own units.
  const minCell = [boxMin[0] / step, boxMin[1] / step, boxMin[2] / step]
  const maxCell = [boxMax[0] / step, boxMax[1] / step, boxMax[2] / step]

  // Per-chunk in-box ranges, computed once so we can size the buffers exactly
  // and then iterate only the cells we keep.
  const visible: Array<{
    chunk: ChunkMap[string]
    baseX: number; baseY: number; baseZ: number
    rx: [number, number]; ry: [number, number]; rz: [number, number]
  }> = []
  let totalCells = 0

  for (const chunk of chunkList) {
    const baseX = (chunk.chunkX - focusChunkX) * CHUNK_SIZE - halfSize
    const baseY = (chunk.chunkY - focusChunkY) * CHUNK_SIZE - halfSize
    const baseZ = (chunk.chunkZ - focusChunkZ) * CHUNK_SIZE - halfSize

    const rx = axisRange(baseX, minCell[0], maxCell[0])
    const ry = axisRange(baseY, minCell[1], maxCell[1])
    const rz = axisRange(baseZ, minCell[2], maxCell[2])
    if (!rx || !ry || !rz) continue

    totalCells += (rx[1] - rx[0] + 1) * (ry[1] - ry[0] + 1) * (rz[1] - rz[0] + 1)
    visible.push({ chunk, baseX, baseY, baseZ, rx, ry, rz })
  }

  const positions = new Float32Array(totalCells * 3)
  const kValues = new Float32Array(totalCells)

  let vertexIdx = 0
  for (const { chunk, baseX, baseY, baseZ, rx, ry, rz } of visible) {
    for (let dz = rz[0]; dz <= rz[1]; dz++) {
      for (let dy = ry[0]; dy <= ry[1]; dy++) {
        const rowIdx = dz * CHUNK_SIZE * CHUNK_SIZE + dy * CHUNK_SIZE
        for (let dx = rx[0]; dx <= rx[1]; dx++) {
          const k = chunk.values[rowIdx + dx]

          positions[vertexIdx * 3]     = (baseX + dx) * step
          positions[vertexIdx * 3 + 1] = (baseY + dy) * step
          positions[vertexIdx * 3 + 2] = (baseZ + dz) * step
          kValues[vertexIdx] = k === 255 ? 0 : k

          vertexIdx++
        }
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aK', new Float32BufferAttribute(kValues, 1))

  return geometry
}

export function ShaderPointVolume({
  chunks,
  boxMin,
  boxMax,
  fadeDirection,
  fadeDuration = 0.5,
  onFadeComplete,
}: Props): JSX.Element {
  const pointsRef = useRef<Points>(null)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const position = useCyberspace((s) => s.position)

  // Always anchor geometry to avatar position, not cursor.
  // Must match useTerrainChunks logic for consistent geometry.
  const focus = position

  // Compute focus chunk coordinates (for geometry centering).
  const chunkStep = BigInt(CHUNK_SIZE) * stepFor(scaleExp)
  const focusChunkX = Math.floor(Number(focus.x / chunkStep))
  const focusChunkY = Math.floor(Number(focus.y / chunkStep))
  const focusChunkZ = Math.floor(Number(focus.z / chunkStep))

  // Fade animation state.
  const fadeProgress = useRef(1)
  const fadeComplete = useRef(true)
  const prevFadeDir = useRef(fadeDirection)

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

  // Build geometry from chunks. Rebuilds when chunks or the box change.
  // Depend on the box's numbers, not the array identity: the parent rebuilds
  // those arrays every render, which would rebuild the buffer every frame.
  const [bx0, by0, bz0] = boxMin
  const [bx1, by1, bz1] = boxMax
  const geometry = useMemo(() => {
    return buildGeometryFromChunks(
      chunks, scaleExp, focusChunkX, focusChunkY, focusChunkZ,
      [bx0, by0, bz0], [bx1, by1, bz1],
    )
  }, [chunks, scaleExp, focusChunkX, focusChunkY, focusChunkZ, bx0, by0, bz0, bx1, by1, bz1])

  // Three.js buffers live on the GPU and are not garbage collected. Dropping
  // the reference leaks them, so release each geometry when it is replaced.
  useEffect(() => () => geometry.dispose(), [geometry])

  // Circular texture for smooth point edges.
  const circularTexture = useMemo(() => createCircularTexture(64), [])
  useEffect(() => () => circularTexture.dispose(), [circularTexture])

  // Shader material.
  const material = useMemo(() => {
    return new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTexture:    { value: circularTexture },
        uBoxMin:     { value: new Vector3(...boxMin) },
        uBoxMax:     { value: new Vector3(...boxMax) },
        uTime:       { value: 0 },
        uFocusPoint: { value: new Vector2(0, 0) },
        uPointSize:  { value: 0.4 },
        uZoom:       { value: 8 },
      },
      transparent: true,
      depthWrite: false,
    })
    // Box uniforms are refreshed every frame in useFrame, so they must not be
    // dependencies here or the material is rebuilt (and leaked) every render.
  }, [circularTexture])

  useEffect(() => () => material.dispose(), [material])

  // Update box uniforms and animate fade.
  useFrame((state, delta) => {
    const pts = pointsRef.current
    if (!pts) return
    const mat = pts.material as ShaderMaterial
    if (!mat.uniforms) return

    mat.uniforms.uTime.value = state.clock.elapsedTime

    // Focus point is (0,0) since geometry is centered on avatar position.
    mat.uniforms.uFocusPoint.value.set(0, 0)

    const camera = state.camera as any
    if (camera.zoom !== undefined) {
      mat.uniforms.uZoom.value = camera.zoom
    }

    // Update box bounds.
    mat.uniforms.uBoxMin.value.set(...boxMin)
    mat.uniforms.uBoxMax.value.set(...boxMax)

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
    }
  })

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
    />
  )
}
