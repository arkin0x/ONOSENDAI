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
import type { Quaternion } from 'three'
import { GRID_RADIUS, placeCentre, type ViewAxes } from '../lib/space'
import { targetColor } from '../lib/targets'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { usePresence } from '../store/usePresence'
import { useProfile } from '../hooks/useProfile'
import { avatarTurn } from '../lib/facing'
import { OtherAvatar } from './OtherAvatar'

const REACH = GRID_RADIUS * 8
const AVATAR_SCALE_LIMIT = 10

function Person({ pubkey, center, turn }: { pubkey: string; center: [number, number, number]; turn: Quaternion }): JSX.Element {
  const profile = useProfile(pubkey)
  const text = (profile?.name ?? `${pubkey.slice(0, 8)}…`).toUpperCase()
  return <OtherAvatar pubkey={pubkey} color={targetColor(pubkey)} center={center} turn={turn} label={text} labelOpacity={0.6} />
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
      .map((p) => ({ ...p, centre: placeCentre(p.position, origin, scaleExp, axes) }))
      .filter((p) => Math.hypot(...p.centre) <= REACH)
  }, [people, targets, me, anchor, anchorPlane, scaleExp, axes])

  // Turned with the view like every shard and your own avatar, so a compass
  // turn that puts the world upside down puts them upside down with it.
  const turn = useMemo(() => avatarTurn(axes, null), [axes])

  if (near.length === 0) return null

  return (
    <>
      {near.map((p) => (
        <Person key={p.pubkey} pubkey={p.pubkey} center={p.centre} turn={turn} />
      ))}
    </>
  )
}
