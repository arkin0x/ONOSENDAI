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
 * Sized like a shard: a fixed physical size in gibsons, so it shrinks as you
 * zoom out and gracefully vanishes into a speck, instead of billboarding at
 * full size over views that are nowhere near it.
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
import { WorldLabel } from './WorldLabel'

const MODEL = '/spawn.glb'

/** v1 drew it at three times model scale, and the model's rings are radius 1.
 * At the finest zoom one cell is one gibson, so this is also its physical
 * size: a mark about six gibsons wide, scaled down 2^scaleExp like a shard. */
const SCALE = 3

/** Below this render scale the mesh is a subpixel speck: skip the draw. */
const MIN_SCALE = 0.02

/** The label holds a constant pixel height, so it outlives the mesh's shrink;
 * drop it once the mark no longer reads as a thing worth naming. */
const LABEL_MIN_SCALE = 0.75

/** The warm red of the marker's radiating bars, so the label reads as part of it. */
const LABEL_COLOR = '#ff7a90'

/** Below the marker's lowest bar, in cells, clear of the mesh at any zoom. */
const LABEL_DROP = 4.5

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
  const position = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const gltf = useGLTF(MODEL) as unknown as {
    nodes: Record<string, Mesh>
    materials: Record<string, Material>
  }

  const at = useMemo(() => {
    const spawn = spawnPosition(pubkey)
    // Physical scaling, the shard rule: 2^(0 - scaleExp) render cells per
    // model unit. Zooming out shrinks the mark smoothly to nothing, which
    // retires the old hard 2^5-gibson cutoff AND the whole-cube ride zoom
    // problem (where a cell-sized mark dwarfed the scene) in one move.
    const scale = SCALE / Number(1n << BigInt(scaleExp))
    if (scale < MIN_SCALE) return null
    const origin = alignedOrigin(position, scaleExp)
    const centre = cellCentre(spawn, origin, scaleExp, axes)
    return Math.hypot(...centre) > REACH ? null : { centre, scale }
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
    <>
      <group name="spawn-marker" position={at.centre} scale={at.scale} dispose={null}>
        {PARTS.map(([node, material]) => {
          const mesh = gltf.nodes[node]
          if (!mesh) return null
          return <mesh key={node} geometry={mesh.geometry} material={materials[material]} frustumCulled={false} />
        })}
      </group>
      {/* A sibling, not a child: the marker group is scaled, and the label
          holds its own constant pixel height, so it must sit outside that
          scale. Dropped below the mesh, by a gap that shrinks with it. */}
      {at.scale >= LABEL_MIN_SCALE && (
        <WorldLabel text="SPAWN POINT" color={LABEL_COLOR} at={at.centre} offset={[0, -LABEL_DROP * (at.scale / SCALE), 0]} align="center" px={11} opacity={0.85} />
      )}
    </>
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
