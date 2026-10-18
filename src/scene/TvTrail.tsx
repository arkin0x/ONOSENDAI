/**
 * TvTrail.tsx: the line behind an avatar on Cyberspace TV, where the tape has
 * shown it go, while the Chain trail switch is on (arkinox, 2026-10-18: "can
 * we also show the trail lines (if turned on) in tv mode, but make sure they
 * appear gracefully as they do during normal onosendai usage").
 *
 * It is the trail's red (PathTrail TRAIL_INK), through the places on the
 * avatar's path (useTv TvAvatar.path). The newest point is not the place the
 * last move went to but the avatar as drawn, gliding there (OtherAvatar), the
 * way your own trail's newest point rides your avatar: the line grows behind
 * it as it travels, and never reaches a place before it does.
 */

import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, Vector3 } from 'three'
import type { Position } from '../lib/space'
import { drawnAvatars } from '../lib/targets'
import { TRAIL_INK } from './PathTrail'

/** After the avatars' glide (priority 0), before the composer draws (1). */
const TRAIL_PRIORITY = 0.9
/** Every trail's material, shared: a line is rebuilt on every step, its material need not be (review of #381). */
const TRAIL_MATERIAL = new LineBasicMaterial({ color: TRAIL_INK.own, toneMapped: false })

export function TvTrail({ pubkey, path, place }: { pubkey: string; path: Position[]; place: (p: Position) => [number, number, number] }): JSX.Element {
  const line = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(path.flatMap((p) => place(p)), 3))
    const l = new Line(geometry, TRAIL_MATERIAL)
    l.frustumCulled = false
    return l
  }, [path, place])
  useEffect(() => () => line.geometry.dispose(), [line])

  const at = useMemo(() => new Vector3(), [])
  useFrame(() => {
    const g = drawnAvatars[pubkey]
    const attr = line.geometry.attributes.position
    if (!g || !line.parent) return
    line.parent.worldToLocal(g.getWorldPosition(at))
    const arr = attr.array as Float32Array
    const n = arr.length
    // As float32, as the array stores them, so an avatar standing still costs no upload.
    const x = Math.fround(at.x), y = Math.fround(at.y), z = Math.fround(at.z)
    if (arr[n - 3] === x && arr[n - 2] === y && arr[n - 1] === z) return
    arr[n - 3] = x
    arr[n - 2] = y
    arr[n - 1] = z
    attr.needsUpdate = true
  }, TRAIL_PRIORITY)

  return <primitive object={line} />
}
