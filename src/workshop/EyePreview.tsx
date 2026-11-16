/**
 * EyePreview.tsx - WHAT YOU SEE, under the view ball in SET EYE (avatar eye,
 * UI A "the eye on the bench"; arkinox, 2026-11-16): a small live picture
 * from the eye, looking forward over a sample floor at the height you will
 * stand, so "what will I see" is answered without leaving the workshop.
 *
 * The walker's point is in the floor's plane while you walk along a floor
 * (DECK-0003 §1.12; study §1.2), so the floor here is the plane of the
 * avatar's own 0, 0, 0. The camera sits where WALK puts it (lib/avatarEye
 * walkEyeLocal at zoom 2^0: the eye at true scale, kept inside the avatar
 * size limit) and looks along the avatar's nose, level, as WALK does when
 * you first step in. The avatar is drawn as WALK draws it from inside, its
 * backs culled. Ahead: a doorway two gibsons tall and the default avatar, one
 * gibson across, standing on its own point, for scale.
 *
 * Cheap: its own small canvas that draws only when the eye or the shape
 * changes (frameloop "demand"), and none at all while folded. Tap the picture
 * to make it bigger; the fold button puts it away to free the view.
 */

import { Canvas, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Eye } from 'lucide-react'
import { EdgesGeometry, IcosahedronGeometry, type PerspectiveCamera } from 'three'
import type { ShardModel } from 'sno-core/shards'
import { avatarScale } from '../lib/avatar'
import { walkEyeLocal } from '../lib/avatarEye'
import { keepPrograms } from '../lib/keepPrograms'
import { BG } from '../lib/palette'
import { FOV } from '../scene/camera'
import { ShardLights } from '../scene/shardLight'
import { ShardMesh } from '../scene/ShardMesh'
import { useWorkshop } from '../store/useWorkshop'

/** The picture's size, CSS pixels, small and tapped bigger. */
export const PREVIEW_SMALL = { width: 150, height: 112 }
export const PREVIEW_BIG = { width: 300, height: 224 }

/** The camera at the eye, looking level along the nose (render -Z). */
function EyeCamera({ eye }: { eye: [number, number, number] }): null {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const invalidate = useThree((s) => s.invalidate)
  useLayoutEffect(() => {
    camera.position.set(eye[0], eye[1], eye[2])
    camera.lookAt(eye[0], eye[1], eye[2] - 1)
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, invalidate, eye])
  return null
}

const MARKER = new EdgesGeometry(new IcosahedronGeometry(0.5, 1))

/** The sample floor: a grid of gibsons in the walker's plane, a doorway ahead, a default avatar beside it. */
function SampleFloor(): JSX.Element {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, -10]}>
        <planeGeometry args={[40, 40]} />
        <meshBasicMaterial color="#0b2a24" />
      </mesh>
      <gridHelper args={[40, 40, '#1e7f6c', '#15544a']} position={[0, 0, -10]} />
      {/* The doorway: two posts and a lintel, two gibsons tall, four ahead. */}
      <mesh position={[-1.5, 1, -4]}><boxGeometry args={[1, 2, 1]} /><meshLambertMaterial color="#3f8f5a" /></mesh>
      <mesh position={[1.5, 1, -4]}><boxGeometry args={[1, 2, 1]} /><meshLambertMaterial color="#3f8f5a" /></mesh>
      <mesh position={[0, 2.25, -4]}><boxGeometry args={[4, 0.5, 1]} /><meshLambertMaterial color="#357a4c" /></mesh>
      {/* Someone wearing the default avatar, standing on their own point. */}
      <lineSegments geometry={MARKER} position={[-2.5, 0, -2.5]}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.85} toneMapped={false} />
      </lineSegments>
    </group>
  )
}

function PreviewScene({ shard }: { shard: ShardModel }): JSX.Element {
  const e = walkEyeLocal(shard, 0, 1)
  const eye = useMemo<[number, number, number]>(() => [e[0], e[1], e[2]], [e[0], e[1], e[2]]) // eslint-disable-line react-hooks/exhaustive-deps
  const k = avatarScale(shard)
  return (
    <>
      <EyeCamera eye={eye} />
      <ShardLights />
      <SampleFloor />
      {shard.vertices.length > 0 && (
        <group scale={[k, k, k]}>
          {/* As WALK draws you from inside: backs culled, opaque, still (DECK-0003 §3.3). */}
          <ShardMesh shard={shard} lit cull still ignoreOpacity />
        </group>
      )}
    </>
  )
}

export function EyePreview(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const [folded, setFolded] = useState(false)
  const [big, setBig] = useState(false)
  if (!shard) return null
  const size = big ? PREVIEW_BIG : PREVIEW_SMALL
  return (
    <div className={`ws__eyeview${folded ? ' is-folded' : ''}${big ? ' is-big' : ''}`} role="group" aria-label="What you see">
      <button className="ws__eyeview-head" onClick={() => setFolded((f) => !f)} aria-expanded={!folded} title={folded ? 'Show what you see from the eye' : 'Fold it away to free the view'}>
        <Eye size={13} strokeWidth={2.25} aria-hidden /><span>WHAT YOU SEE</span>
        {folded ? <ChevronDown size={14} strokeWidth={2.25} aria-hidden /> : <ChevronUp size={14} strokeWidth={2.25} aria-hidden />}
      </button>
      {!folded && (
        <button className="ws__eyeview-pic" style={{ width: size.width, height: size.height }} onClick={() => setBig((b) => !b)} title={big ? 'Smaller' : 'Bigger'} aria-label={big ? 'Make the picture smaller' : 'Make the picture bigger'}>
          <Canvas
            dpr={[1, 2]}
            frameloop="demand"
            gl={{ antialias: true }}
            camera={{ fov: FOV, near: 0.02, far: 200 }}
            onCreated={({ gl, scene }) => keepPrograms(gl, scene)}
            style={{ width: size.width, height: size.height, background: BG, pointerEvents: 'none' }}
          >
            <PreviewScene shard={shard} />
          </Canvas>
        </button>
      )}
    </div>
  )
}
