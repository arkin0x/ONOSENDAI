/**
 * OtherAvatar.tsx: someone else's avatar in the field, a target's or a
 * passer-by's, drawn the one way both lists draw it.
 *
 * Two things were added here (arkinox, 2026-10-11, looking at his agent's new
 * avatar next to him). A tap on the avatar opens their profile card
 * (PersonModal) with a spinning preview of the shard and COPY TO WORKSHOP:
 * the tap lands on a TapTarget measured from what is drawn, the same target
 * world shards use, so it takes its turn among the scene's other taps by
 * distance and stops the tap from also toggling the controls. And the group
 * that holds the shape is registered by pubkey (lib/targets drawnAvatars) so
 * the projector can put the HUD's name and picture under the avatar's real
 * bounds instead of its cell's corner.
 *
 * And it glides when they move (arkinox, 2026-10-12: "if I'm not spectating
 * XOR, there is no LERP when he moves, which makes his movement actions hard
 * to follow"). It used to be drawn wherever the feed last put it, so a move
 * was a teleport. Now a change of their true position starts the same glide
 * your own avatar takes (lib/avatarLerp.ts AvatarLerp, AVATAR_LERP_MS): the
 * group is drawn at its new place plus an offset that starts at the old place
 * and decays to zero. Only their own move glides; your hop moves everybody's
 * render coordinates, and since the offset is relative, that shift is applied
 * whole as the rest of the world's is.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Quaternion } from 'three'
import { AvatarLerp, type Vec3 } from '../lib/avatarLerp'
import type { Position } from '../lib/space'
import { drawnAvatars } from '../lib/targets'
import { usePersonCard } from '../store/usePersonCard'
import { AvatarShape } from './AvatarShape'
import { TapTarget } from './TapTarget'
import { WorldLabel } from './WorldLabel'

interface Props {
  pubkey: string
  color: string
  center: [number, number, number]
  /** Their true position: a change of it is a move, and glides. */
  position: Position
  /** Where a position is drawn in the current render frame (lib/space placeCentre). */
  place: (p: Position) => Vec3
  turn: Quaternion
  label: string
  labelOpacity: number
  /** Whether a tap opens their card; false on Cyberspace TV, where nothing on screen takes a tap. */
  tappable?: boolean
  /** The shape's size, read each frame, 0 to 1: Cyberspace TV grows a spawning avatar from a point. */
  size?: () => number
  /** Its own shape at any zoom, never the marker (Cyberspace TV). */
  keepShape?: boolean
  /** The name label's size, CSS px before labelShrink: larger on Cyberspace TV, read from across a room. */
  labelPx?: number
}

export function OtherAvatar({ pubkey, color, center, position, place, turn, label, labelOpacity, tappable = true, size, keepShape = false, labelPx = 11 }: Props): JSX.Element {
  const drawn = useRef<Group>(null)
  const placed = useRef<Group>(null)
  const lerp = useRef(new AvatarLerp())
  const out = useRef<Vec3>([0, 0, 0])
  const last = useRef<Position>(position)
  const moveKey = `${position.x},${position.y},${position.z}`
  // A layout effect, so the glide is registered before a frame can draw the
  // avatar at its new place with no offset: that frame was the avatar
  // flashing at its destination before travelling there.
  useLayoutEffect(() => {
    const old = last.current
    last.current = position
    if (old.x === position.x && old.y === position.y && old.z === position.z) return
    const was = place(old)
    lerp.current.move([was[0] - center[0], was[1] - center[1], was[2] - center[2]], performance.now())
    // place and center are read at the moment of the move on purpose, as
    // Travel reads its frame: a zoom mid-glide must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveKey])
  const apply = (): void => {
    const g = placed.current
    if (!g) return
    const o = lerp.current.offset(performance.now(), out.current)
    g.position.set(center[0] + o[0], center[1] + o[1], center[2] + o[2])
    if (size && drawn.current) drawn.current.scale.setScalar(Math.max(1e-4, size()))
  }
  // On every commit as well as every frame, so the group is never left at
  // the origin or at a stale center between a render and the next frame.
  useLayoutEffect(apply)
  useFrame(apply)
  useEffect(() => {
    const g = drawn.current
    if (!g) return
    drawnAvatars[pubkey] = g
    return () => { if (drawnAvatars[pubkey] === g) delete drawnAvatars[pubkey] }
  }, [pubkey])
  return (
    <group ref={placed}>
      <group ref={drawn} quaternion={turn}>
        <AvatarShape pubkey={pubkey} color={color} keepShape={keepShape} />
      </group>
      {tappable && <TapTarget measure={drawn} onTap={() => usePersonCard.getState().open(pubkey)} />}
      <WorldLabel text={label} color={color} at={[0, 0.9, 0]} align="center" px={labelPx} opacity={labelOpacity} />
    </group>
  )
}
