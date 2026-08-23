/**
 * SpawnMarker.tsx — the mark at the point where an avatar came into being.
 *
 * v1's spawn model, unchanged: three hexagonal rings front, middle and back,
 * a hollow cube at the centre, three red bars radiating up and out and three
 * purple ones between them, all open shells so that under bloom they read as
 * drawn light rather than as surfaces. It is loaded from the same spawn.glb v1
 * shipped, because the shape is the point: it is what a spawn looks like, here
 * and in every client that inherited it.
 *
 * It sits at the pubkey coordinate (spec §3.1), which is where a chain begins
 * and where a respawn returns to, so it is the one landmark every avatar owns.
 * Sized in cells, like the avatar and the cursor, so it marks the spawn CELL at
 * whatever scale you are looking at rather than shrinking to a gibson and
 * vanishing two zoom steps out.
 *
 * Takes a pubkey rather than reading the identity, so the same mark can stand
 * at anyone's spawn once other avatars are drawn.
 */

import { Suspense, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import type { Material, Mesh, MeshStandardMaterial } from 'three'
import { GRID_RADIUS, cellCentre, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

const MODEL = '/spawn.glb'

/** v1 drew it at three times model scale, and the model's rings are radius 1. */
const SCALE = 3

/** Beyond this it would be drawn somewhere nobody can see. Same cull as Earth. */
const REACH = GRID_RADIUS * 8

/** The ten shells, each with the material v1 gave it. */
const PARTS: Array<[node: string, material: string]> = [
  ['BoundaryHexBack', 'Hex'],
  ['BoundaryHexFront', 'Hex'],
  ['BoundaryHexMiddleWarning', 'HexYellow'],
  ['Cube', 'Cube'],
  ['LargeTriadLeft', 'LargeTriad'],
  ['LargeTriadRight', 'LargeTriad'],
  ['LargeTriadTop', 'LargeTriad'],
  ['SmallTriadLeft', 'SmallTriad'],
  ['SmallTriadRight', 'SmallTriad'],
  ['SmallTriadBottom', 'SmallTriad'],
]

/** Where a pubkey spawns: its own bits, read as a coordinate. */
export function spawnPosition(pubkey: string): Position {
  const { x, y, z } = coordToXyz(hexToCoord(pubkey))
  return { x, y, z }
}

interface Props {
  pubkey: string
  axes: ViewAxes
}

function Model({ pubkey, axes }: Props): JSX.Element | null {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const gltf = useGLTF(MODEL) as unknown as {
    nodes: Record<string, Mesh>
    materials: Record<string, Material>
  }

  const at = useMemo(() => {
    const origin = alignedOrigin(position, scaleExp)
    const centre = cellCentre(spawnPosition(pubkey), origin, scaleExp, axes)
    return Math.hypot(...centre) > REACH ? null : centre
  }, [pubkey, position, scaleExp, axes])

  // The GLB's materials are black with an emissive colour, which is what lets
  // them glow under bloom. The scene's tone mapping would dull that, so it is
  // switched off here the way every other lit line in the scene switches it off.
  const materials = useMemo(() => {
    const out: Record<string, Material> = {}
    for (const [, name] of PARTS) {
      const m = gltf.materials[name] as MeshStandardMaterial | undefined
      if (!m || out[name]) continue
      const copy = m.clone()
      copy.toneMapped = false
      copy.emissiveIntensity = 1.6
      out[name] = copy
    }
    return out
  }, [gltf])

  if (!at) return null

  return (
    <group name="spawn-marker" position={at} scale={SCALE} dispose={null}>
      {PARTS.map(([node, material]) => {
        const mesh = gltf.nodes[node]
        if (!mesh) return null
        return <mesh key={node} geometry={mesh.geometry} material={materials[material]} frustumCulled={false} />
      })}
    </group>
  )
}

export function SpawnMarker(props: Props): JSX.Element {
  // Its own boundary: a model still downloading must not hold back the scene.
  return (
    <Suspense fallback={null}>
      <Model {...props} />
    </Suspense>
  )
}

useGLTF.preload(MODEL)
