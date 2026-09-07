/**
 * Avatar.tsx — you.
 *
 * A red wireframe icosahedron marks your position in cyberspace. Same shape as
 * Onosendai v1.
 *
 * It sits at the origin, which is its own aligned cell, so the gibson point for
 * that cell falls at the exact centre of the mesh. It previously carried a 0.1
 * lift on the out axis, which floated it above a flat plane and, once the scene
 * became a volume, simply pushed it off its own gibson.
 *
 * The one exception to sitting at the origin is a commit, where it is drawn
 * trailing behind its committed cell and catches up over a few hundred
 * milliseconds. See travel.ts for why the animation lives here rather than in
 * the coordinate.
 */

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import { travelOffset } from '../lib/travel'
import { useCyberspace } from '../store/useCyberspace'
import { AvatarShape } from './AvatarShape'

export function Avatar(): JSX.Element | null {
  const group = useRef<Group>(null)
  // Looking at a shard means the origin is that shard, not you: drawing your
  // marker there would say you are standing on it. Spectating keeps the marker,
  // where it stands in for the avatar being watched.
  const focus = useCyberspace((s) => s.focus)
  // Whose shape: yours, or the spectated avatar's, whose marker this is then.
  const pubkey = useCyberspace((s) => s.focusPubkey())

  useFrame(() => {
    if (group.current) group.current.position.copy(travelOffset)
  })

  if (focus) return null

  return (
    <group ref={group} position={[0, 0, 0]}>
      {/* No depth test, drawn after the opaque pass: you must always be able
          to find yourself. The selected block's solid cube is exactly one
          cell, the icosahedron inscribes it exactly, and standing on your
          own destination erased you; now the red edges composite on top of
          whatever shares your gibson. */}
      <AvatarShape pubkey={pubkey} color="#ff2323" renderOrder={10} depthTest={false} />
    </group>
  )
}
