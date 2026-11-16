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
 * The picture has the screen's own shape (upright on a phone) and WALK's
 * field of view and near plane (scene/camera FOV, CAMERA_NEAR), so it shows
 * what WALK will show. An avatar small enough to be drawn as the icosahedron
 * looks from the icosahedron's eye (MARKER_EYE), and draws nothing of its own
 * from inside, as in WALK.
 *
 * Cheap: its own small canvas that draws only when the eye or the shape
 * changes (frameloop "demand"), and none at all while folded. Tap the picture
 * to make it bigger; the fold button puts it away to free the view. The bench
 * frames the shard clear of it (Workshop useBenchInsets reads its box).
 */

import { Canvas, useThree } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Eye } from 'lucide-react'
import { EdgesGeometry, IcosahedronGeometry, type PerspectiveCamera } from 'three'
import type { ShardModel } from 'sno-core/shards'
import { avatarDraw, avatarScale } from '../lib/avatar'
import { walkEyeLocal } from '../lib/avatarEye'
import { keepPrograms } from '../lib/keepPrograms'
import { BG } from '../lib/palette'
import { CAMERA_NEAR, FOV } from '../scene/camera'
import { ShardLights } from '../scene/shardLight'
import { ShardMesh } from '../scene/ShardMesh'
import { useWorkshop } from '../store/useWorkshop'

/** The picture's width, CSS pixels, small and tapped bigger; its height follows the screen's shape. */
export const PREVIEW_WIDTH = { small: 90, big: 180 }
/** Never taller than this share of the screen, so a tall phone keeps its bench. */
const MAX_HEIGHT_SHARE = { small: 0.25, big: 0.5 }

/** The picture's size for a screen `w` by `h`: the screen's own shape, `big` or small. Pure. */
export function previewSize(w: number, h: number, big: boolean): { width: number; height: number } {
  const k = big ? 'big' : 'small'
  const aspect = w > 0 && h > 0 ? h / w : 812 / 375
  const height = Math.min(Math.round(PREVIEW_WIDTH[k] * aspect), Math.round(h * MAX_HEIGHT_SHARE[k]))
  return { width: Math.round(height / aspect), height }
}

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
      <lineSegments geometry={MARKER} position={[-0.8, 0, -2.5]}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.85} toneMapped={false} />
      </lineSegments>
    </group>
  )
}

function PreviewScene({ shard }: { shard: ShardModel }): JSX.Element {
  // walkEyeLocal at zoom 2^0: the eye at true scale within the size limit, or
  // the icosahedron's eye (MARKER_EYE) when the shape is drawn as the marker.
  const e = walkEyeLocal(shard, 0, 1)
  const eye = useMemo<[number, number, number]>(() => [e[0], e[1], e[2]], [e[0], e[1], e[2]]) // eslint-disable-line react-hooks/exhaustive-deps
  const marker = shard.vertices.length === 0 || avatarDraw(shard, 0) === 'marker'
  const k = avatarScale(shard)
  return (
    <>
      <EyeCamera eye={eye} />
      <ShardLights />
      <SampleFloor />
      {/* The icosahedron draws nothing from inside (AvatarShape firstPerson); a shape draws unlit, backs culled, opaque, still (DECK-0003 §3.3). Not lit: lit draws the backs too, darker. */}
      {!marker && (
        <group scale={[k, k, k]}>
          <ShardMesh shard={shard} cull still ignoreOpacity />
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
  const size = previewSize(typeof window !== 'undefined' ? window.innerWidth : 375, typeof window !== 'undefined' ? window.innerHeight : 812, big)
  return (
    <div className={`ws__eyeview${folded ? ' is-folded' : ''}${big ? ' is-big' : ''}`} role="group" aria-label="What you see">
      {!folded && (
        <div className="ws__eyeview-pic" style={{ width: size.width, height: size.height }}>
          <Canvas
            dpr={[1, 2]}
            frameloop="demand"
            gl={{ antialias: true }}
            camera={{ fov: FOV, near: CAMERA_NEAR, far: 200 }}
            onCreated={({ gl, scene }) => keepPrograms(gl, scene)}
            style={{ width: size.width, height: size.height, background: BG, pointerEvents: 'none' }}
          >
            <PreviewScene shard={shard} />
          </Canvas>
          {/* Beside the canvas, over it: the tap that makes it bigger or smaller. */}
          <button className="ws__eyeview-zoom" onClick={() => setBig((b) => !b)} title={big ? 'Smaller' : 'Bigger'} aria-label={big ? 'Make the picture smaller' : 'Make the picture bigger'} />
        </div>
      )}
      {/* Its name over the picture's top edge, and the fold: folded, the name alone, to unfold it. */}
      <button className="ws__eyeview-head" onClick={() => setFolded((f) => !f)} aria-expanded={!folded} title={folded ? 'Show what you see from the eye' : 'Fold it away to free the view'}>
        {folded && <Eye size={13} strokeWidth={2.25} aria-hidden />}<span>WHAT YOU SEE</span>
        {folded ? <ChevronDown size={14} strokeWidth={2.25} aria-hidden /> : <ChevronUp size={14} strokeWidth={2.25} aria-hidden />}
      </button>
    </div>
  )
}
