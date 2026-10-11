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
 */

import { useEffect, useRef } from 'react'
import type { Group, Quaternion } from 'three'
import { drawnAvatars } from '../lib/targets'
import { usePersonCard } from '../store/usePersonCard'
import { AvatarShape } from './AvatarShape'
import { TapTarget } from './TapTarget'
import { WorldLabel } from './WorldLabel'

interface Props {
  pubkey: string
  color: string
  center: [number, number, number]
  turn: Quaternion
  label: string
  labelOpacity: number
}

export function OtherAvatar({ pubkey, color, center, turn, label, labelOpacity }: Props): JSX.Element {
  const drawn = useRef<Group>(null)
  useEffect(() => {
    const g = drawn.current
    if (!g) return
    drawnAvatars[pubkey] = g
    return () => { if (drawnAvatars[pubkey] === g) delete drawnAvatars[pubkey] }
  }, [pubkey])
  return (
    <group position={center}>
      <group ref={drawn} quaternion={turn}>
        <AvatarShape pubkey={pubkey} color={color} />
      </group>
      <TapTarget measure={drawn} onTap={() => usePersonCard.getState().open(pubkey)} />
      <WorldLabel text={label} color={color} at={[0, 0.9, 0]} align="center" px={11} opacity={labelOpacity} />
    </group>
  )
}
