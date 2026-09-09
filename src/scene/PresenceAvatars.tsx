/**
 * PresenceAvatars.tsx — the people here whom you have not targeted.
 *
 * Drawn exactly as a target is, in their own color with their name over
 * them, from the presence feed's idea of where they are: the same wireframe
 * or the shard they chose, culled to the field the way targets are. The
 * label is dimmer than a target's, which is the one thing that says "not
 * yet yours". Targeting one is in the sector chip, where the name is.
 */

import { useMemo } from 'react'
import { GRID_RADIUS, cellCentre, type ViewAxes } from '../lib/space'
import { targetColor } from '../lib/targets'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { usePresence } from '../store/usePresence'
import { useProfile } from '../hooks/useProfile'
import { AvatarShape } from './AvatarShape'
import { WorldLabel } from './WorldLabel'

const REACH = GRID_RADIUS * 8
const AVATAR_SCALE_LIMIT = 10

function PersonLabel({ pubkey, color }: { pubkey: string; color: string }): JSX.Element {
  const profile = useProfile(pubkey)
  const text = (profile?.name ?? `${pubkey.slice(0, 8)}…`).toUpperCase()
  return <WorldLabel text={text} color={color} at={[0, 0.9, 0]} align="center" px={11} opacity={0.6} />
}

export function PresenceAvatars({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const people = usePresence((s) => s.people)
  const targets = useCyberspace((s) => s.targets)
  const me = useCyberspace((s) => s.identity.pubkey)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const near = useMemo(() => {
    if (scaleExp >= AVATAR_SCALE_LIMIT) return []
    const origin = alignedOrigin(anchor, scaleExp)
    return Object.values(people)
      .filter((p) => p.pubkey !== me && !targets[p.pubkey] && p.plane === anchorPlane)
      .map((p) => ({ ...p, centre: cellCentre(p.position, origin, scaleExp, axes) }))
      .filter((p) => Math.hypot(...p.centre) <= REACH)
  }, [people, targets, me, anchor, anchorPlane, scaleExp, axes])

  if (near.length === 0) return null

  return (
    <>
      {near.map((p) => (
        <group key={p.pubkey} position={p.centre}>
          <AvatarShape pubkey={p.pubkey} color={targetColor(p.pubkey)} />
          <PersonLabel pubkey={p.pubkey} color={targetColor(p.pubkey)} />
        </group>
      ))}
    </>
  )
}
