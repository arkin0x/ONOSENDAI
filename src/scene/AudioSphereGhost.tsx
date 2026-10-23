/**
 * AudioSphereGhost.tsx: hidden audio's sphere on the placement ghost
 * (arkinox, 2026-10-23, step 3). Full volume inside it, fading to silence at
 * the walls of the region the deploy bar's green box shows; for a one-shot
 * it is the trigger zone. Three rings on the axes and one facing the camera,
 * the note's blue, following the ghost and resized every frame from the
 * stores: the FADE stepper, the height and the zoom (one scene unit is
 * 2^scaleExp gibsons, so the sphere stays the same size in gibsons). Never
 * past the region's nearest wall from where it lands (lib/audioItem
 * fadeRadius), which is where the deploy clamps it too. Explained in the
 * legend.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, type Group } from 'three'
import { fadeAt, fadeRadius, sourceLocal } from '../lib/audioItem'
import { deployPoint } from '../lib/space'
import { buildStepOf } from '../lib/buildCursor'
import { useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'

/** The rings' blue: the note's, lit, as the music note in the box. */
export const SPHERE_BLUE = '#9fd0ff'
const SEGMENTS = 96

/** A unit circle in the plane of two axes (0 x, 1 y, 2 z). */
function ring(a: 0 | 1 | 2, b: 0 | 1 | 2): BufferGeometry {
  const pts: number[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    const t = (i / SEGMENTS) * Math.PI * 2
    const p = [0, 0, 0]
    p[a] = Math.cos(t)
    p[b] = Math.sin(t)
    pts.push(...p)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pts, 3))
  return g
}

/** The sphere's radius in gibsons where the pending audio would land, or 0 when nothing is placed or there is no room. */
export function pendingSphereRadius(): number {
  const p = useShards.getState().pending
  if (p?.type !== 'audio') return 0
  const height = useShards.getState().deployHeight
  const at = deployPoint(useCyberspace.getState().cursor, buildStepOf(useCyberspace.getState()), height)
  // An explicit sphere as the deploy will write it (whole gibsons, clamped
  // to the room: fadeAt); AUTO as every reader reads an item without one.
  return p.audio.fade === undefined ? fadeRadius(undefined, sourceLocal(at, height), height) : fadeAt(p.audio.fade, at, height) ?? 0
}

export function AudioSphereGhost({ landingAt }: { landingAt: () => [number, number, number] }): JSX.Element {
  const group = useRef<Group>(null)
  const facing = useRef<Group>(null)
  const rings = useMemo(() => ({ xy: ring(0, 1), xz: ring(0, 2), yz: ring(1, 2) }), [])
  useEffect(() => () => { rings.xy.dispose(); rings.xz.dispose(); rings.yz.dispose() }, [rings])

  useFrame(({ camera }) => {
    const g = group.current
    if (!g) return
    const at = landingAt()
    g.position.set(at[0], at[1], at[2])
    const r = pendingSphereRadius() / 2 ** useCyberspace.getState().scaleExp
    g.visible = r > 0
    g.scale.setScalar(Math.max(1e-6, r))
    // The silhouette ring turns to face the camera, so the sphere reads as a sphere at any angle.
    facing.current?.quaternion.copy(camera.quaternion)
  })

  const material = <lineBasicMaterial color={SPHERE_BLUE} toneMapped={false} transparent opacity={0.45} depthWrite={false} />
  return (
    <group ref={group}>
      <lineLoop geometry={rings.xy} frustumCulled={false}>{material}</lineLoop>
      <lineLoop geometry={rings.xz} frustumCulled={false}>{material}</lineLoop>
      <lineLoop geometry={rings.yz} frustumCulled={false}>{material}</lineLoop>
      <group ref={facing}>
        <lineLoop geometry={rings.xy} frustumCulled={false}>
          <lineBasicMaterial color={SPHERE_BLUE} toneMapped={false} transparent opacity={0.8} depthWrite={false} />
        </lineLoop>
      </group>
    </group>
  )
}
