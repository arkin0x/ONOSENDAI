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
 *
 * From CONTINUOUS_SCALE_MIN up the origin is no longer where you stand: the
 * scene places everything at its true position there, you included, so the
 * avatar stands at its own sub-cell offset inside the origin's cell
 * (anchorCentre), which is [0, 0, 0] at every finer zoom (arkinox,
 * 2026-10-01).
 *
 * BUILD mode is the other exception (arkinox, 2026-10-08). The scene there
 * stands on the build cursor, not on an avatar, and the avatar of the chain
 * on show, yours or the one being spectated, is drawn where it stands at the
 * action the CHAIN chip last aimed at (the head when none), at its true
 * place relative to the build cursor's field, so you can build near it.
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, type Quaternion } from 'three'
import { avatarTurn, facingPair } from '../lib/facing'
import { anchorCentre, GRID_RADIUS, placeCentre, type Position } from '../lib/space'
import { travelOffset } from '../lib/travel'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { AvatarShape } from './AvatarShape'

/** How far from the build cursor's field the avatar is still drawn in BUILD mode, as PresenceAvatars culls. */
const REACH = GRID_RADIUS * 8

export function Avatar(): JSX.Element | null {
  const group = useRef<Group>(null)
  // Looking at a shard means the origin is that shard, not you: drawing your
  // marker there would say you are standing on it. Spectating keeps the marker,
  // where it stands in for the avatar being watched.
  const focus = useCyberspace((s) => s.focus)
  // BUILD mode: the scene rides the build cursor, and the avatar stands at
  // the aimed action of the chain on show, or its head.
  const building = useBuilder((s) => s.active)
  const scrub = useBuilder((s) => s.scrub)
  const placed = building && focus?.drive === true
  const shownPosition = useCyberspace((s): Position | null => {
    if (!placed) return null
    const chain = s.focusChain()
    if (s.spectate) return chain[scrub ?? chain.length - 1]?.position ?? null
    return scrub === null ? s.position : (chain[scrub]?.position ?? s.position)
  })
  const shownPlane = useCyberspace((s): number | null => {
    if (!placed) return null
    const chain = s.focusChain()
    if (s.spectate) return chain[scrub ?? chain.length - 1]?.plane ?? null
    return scrub === null ? s.headPlane : (chain[scrub]?.plane ?? s.headPlane)
  })
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  // The facing pair's index: the explored action, or in BUILD mode the aimed one.
  const facingIndex = placed ? scrub : null
  // Whose shape: yours, or the spectated avatar's, whose marker this is then.
  const pubkey = useCyberspace((s) => s.focusPubkey())
  // The last move on the chain drawn, as a key so a re-render costs nothing
  // until the chain grows; the avatar turns to face the way it went.
  const view = useCyberspace((s) => s.view)
  // Time decides the angle: the move that brought the avatar to the link on
  // show, which while scrubbing the chain is the link before the explored one
  // and this one, not the head's last move (lib/facing.ts facingPair).
  const moveKey = useCyberspace((s) => {
    const pair = facingPair(s.focusChain(), placed ? facingIndex : s.exploreIndex)
    if (!pair) return null
    const a = pair[0].position, b = pair[1].position
    return `${a.x},${a.y},${a.z}>${b.x},${b.y},${b.z}`
  })
  // The turn its group carries: the facing in world terms with the view frame
  // composed on, so a compass turn turns the avatar with the world, upside
  // down included (lib/facing.ts avatarTurn). With no move yet it still turns
  // with the view, lying on cyberspace axes as built.
  const facing = useMemo(() => {
    const s = useCyberspace.getState()
    const pair = moveKey ? facingPair(s.focusChain(), placed ? facingIndex : s.exploreIndex) : null
    return avatarTurn(s.axes(), pair ? [pair[0].position, pair[1].position] : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveKey, view])
  // The view the group was last snapped to. A view turn snaps, as the rest of
  // the world does; only a new heading within one view eases in.
  const turnedFor = useRef<Quaternion | null>(null)
  // Where you stand in the render frame: the origin below the continuous
  // range, your true position inside its cell in it.
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const at = useMemo(() => {
    const axes = useCyberspace.getState().axes()
    return shownPosition === null
      ? anchorCentre(anchor, scaleExp, axes)
      : placeCentre(shownPosition, alignedOrigin(anchor, scaleExp), scaleExp, axes)
  }, [anchor, scaleExp, view, shownPosition])

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    g.position.set(at[0] + travelOffset.x, at[1] + travelOffset.y, at[2] + travelOffset.z)
    if (turnedFor.current !== view) {
      g.quaternion.copy(facing)
      turnedFor.current = view
      return
    }
    // Eases into the new heading over the same beat the travel animation takes.
    g.quaternion.slerp(facing, 1 - Math.exp(-dt / 0.15))
  })

  if (focus && !placed) return null
  // In BUILD mode: not in another plane than the one you build in, and not
  // beyond the field, where it would be a speck a universe away.
  if (placed && (shownPosition === null || shownPlane !== anchorPlane || Math.hypot(...at) > REACH)) return null

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
