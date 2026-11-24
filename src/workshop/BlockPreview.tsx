/**
 * BlockPreview.tsx: IMPORT A BUILD's picture of the build, turning slowly
 * (store/useBlockImport, design 4.7 step 2).
 *
 * The triangles come from the worker as they will be written (lib/blocks/
 * blockBuild.ts previewOf): our colours, glass, ice and water see-through as
 * their pieces will be. Each face is shaded by which way it looks, top
 * brightest, so the shape reads without a light in the scene. The camera is
 * fitted to the build's size; a build of any size fills the frame.
 */

import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { PreviewLayer } from '../lib/blocks/blockBuild'
import { LAYER_OPACITY } from '../lib/blocks/colourTable'

/** How bright a face is by the way it looks: up, down, east-west, north-south. */
const SHADE = { up: 1, down: 0.45, x: 0.78, z: 0.62 }

/** A layer's triangles as a geometry, each face's colour shaded by its normal. */
function geometryOf(layer: PreviewLayer): THREE.BufferGeometry {
  const { positions, colors } = layer
  const shaded = new Float32Array(colors.length)
  for (let t = 0; t < positions.length; t += 9) {
    const ax = positions[t + 3] - positions[t], ay = positions[t + 4] - positions[t + 1], az = positions[t + 5] - positions[t + 2]
    const bx = positions[t + 6] - positions[t], by = positions[t + 7] - positions[t + 1], bz = positions[t + 8] - positions[t + 2]
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx
    const k = Math.abs(ny) >= Math.abs(nx) && Math.abs(ny) >= Math.abs(nz) ? (ny > 0 ? SHADE.up : SHADE.down) : Math.abs(nx) >= Math.abs(nz) ? SHADE.x : SHADE.z
    for (let i = t; i < t + 9; i++) shaded[i] = colors[i] * k
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.BufferAttribute(shaded, 3))
  return g
}

function Build({ layers, size }: { layers: PreviewLayer[]; size: [number, number, number] }): JSX.Element {
  const group = useRef<THREE.Group>(null)
  const parts = useMemo(() => layers.map((l) => ({ layer: l.layer, geometry: geometryOf(l) })), [layers])
  useEffect(() => () => { for (const p of parts) p.geometry.dispose() }, [parts])
  useFrame((_, dt) => { if (group.current) group.current.rotation.y += dt * 0.25 })
  const fit = Math.max(size[0], size[1], size[2], 1)
  return (
    <group ref={group} scale={1 / fit}>
      {/* About the middle of the build, so it turns in place. */}
      <group position={[0, -size[1] / 2, 0]}>
        {parts.map((p) => {
          const opacity = LAYER_OPACITY[p.layer]
          return (
            <mesh key={p.layer} geometry={p.geometry} renderOrder={opacity === undefined ? 0 : 1}>
              <meshBasicMaterial vertexColors side={THREE.DoubleSide} forceSinglePass transparent={opacity !== undefined} opacity={opacity === undefined ? 1 : opacity / 100} depthWrite={opacity === undefined} />
            </mesh>
          )
        })}
      </group>
    </group>
  )
}

export function BlockPreview({ layers, size }: { layers: PreviewLayer[] | null; size: [number, number, number] | null }): JSX.Element {
  return (
    <div className="blockimport__view" aria-label="The build, turning">
      <span className="blockimport__corner blockimport__corner--tl" aria-hidden />
      <span className="blockimport__corner blockimport__corner--br" aria-hidden />
      {layers && size && (
        <Canvas dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [1.4, 1.0, 1.4], fov: 40, near: 0.01, far: 20 }} onCreated={({ camera }) => camera.lookAt(0, 0, 0)}>
          <Build layers={layers} size={size} />
        </Canvas>
      )}
    </div>
  )
}
