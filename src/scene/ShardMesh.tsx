/**
 * ShardMesh.tsx — one shard, drawn in its mode.
 *
 * Shared by the workshop bench and the world, so what you build is exactly
 * what gets placed. Three modes off one vertex list:
 *
 * - solid: the triangles, vertex colours blended across each face, unlit and
 *   double-sided so it reads as drawn light under bloom like everything else.
 * - points: every vertex is a light. Additive, depth-write off, so lights in
 *   front of lights add up instead of occluding.
 * - lines: a polyline through the vertices in order, the colours blending
 *   along each segment the way they do across a face.
 */

import { useMemo } from 'react'
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
} from 'three'
import { flatten, type ShardModel } from '../lib/shards'

interface Props {
  shard: ShardModel
  /** Render units per model unit. */
  scale?: number
  /** Dimmed, for a preview that is not yet real. */
  ghost?: boolean
}

export function ShardMesh({ shard, scale = 1, ghost = false }: Props): JSX.Element | null {
  const { positions, colors, index } = useMemo(() => flatten(shard), [shard.vertices, shard.faces])

  // Two geometries off one buffer pair: the mesh needs the index, the points
  // and the line must not have it (an indexed Line draws the index order).
  const plain = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(positions, 3))
    g.setAttribute('color', new Float32BufferAttribute(colors, 3))
    return g
  }, [positions, colors])

  const indexed = useMemo(() => {
    const g = plain.clone()
    g.setIndex(index)
    g.computeVertexNormals()
    return g
  }, [plain, index])

  const line = useMemo(() => {
    const l = new Line(plain, new LineBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: ghost ? 0.45 : 1 }))
    l.frustumCulled = false
    return l
  }, [plain, ghost])

  if (shard.vertices.length === 0) return null
  const opacity = ghost ? 0.45 : 1

  return (
    <group scale={scale}>
      {shard.mode === 'solid' && index.length > 0 && (
        <mesh geometry={indexed} frustumCulled={false}>
          <meshBasicMaterial vertexColors side={DoubleSide} toneMapped={false} transparent opacity={opacity} />
        </mesh>
      )}
      {shard.mode === 'lines' && shard.vertices.length > 1 && <primitive object={line} />}
      {(shard.mode === 'points' || shard.mode === 'solid' || shard.mode === 'lines') && (
        <points geometry={plain} frustumCulled={false}>
          <pointsMaterial
            vertexColors
            size={shard.mode === 'points' ? 0.6 : 0.16}
            sizeAttenuation
            transparent
            opacity={shard.mode === 'points' ? opacity : opacity * 0.9}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </points>
      )}
    </group>
  )
}
