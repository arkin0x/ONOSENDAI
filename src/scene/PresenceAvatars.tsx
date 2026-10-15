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
import { presenceDrawn, usePresence, type Person as Present } from '../store/usePresence'
import { useProfile } from '../hooks/useProfile'
import { avatarTurn } from '../lib/facing'
import { OtherAvatar } from './OtherAvatar'

const REACH = GRID_RADIUS * 8
const AVATAR_SCALE_LIMIT = 10

interface PersonProps {
  pubkey: string
  center: [number, number, number]
  position: Present['position']
  place: (p: Present['position']) => [number, number, number]
  turn: Quaternion
}

function Person({ pubkey, center, position, place, turn }: PersonProps): JSX.Element {
  const profile = useProfile(pubkey)
  const text = (profile?.name ?? `${pubkey.slice(0, 8)}…`).toUpperCase()
  return <OtherAvatar pubkey={pubkey} color={targetColor(pubkey)} center={center} position={position} place={place} turn={turn} label={text} labelOpacity={0.6} />
}

export function PresenceAvatars({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const people = usePresence((s) => s.people)
  const targets = useCyberspace((s) => s.targets)
  const me = useCyberspace((s) => s.identity.pubkey)
  // Whoever scene/Avatar draws: you, or the avatar you spectate.
  const focus = useCyberspace((s) => s.focusPubkey())
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  // Where a position is drawn in this render frame; OtherAvatar asks it where
  // someone was, to glide them from there.
  const place = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    return (p: Present['position']) => placeCentre(p, origin, scaleExp, axes)
  }, [anchor, scaleExp, axes])

  const near = useMemo(() => {
    if (scaleExp >= AVATAR_SCALE_LIMIT) return []
    return presenceDrawn(people, { me, focus, targets, plane: anchorPlane })
      .map((p) => ({ ...p, centre: place(p.position) }))
      .filter((p) => Math.hypot(...p.centre) <= REACH)
  }, [people, targets, me, focus, anchorPlane, scaleExp, place])

  // Turned with the view like every shard and your own avatar, so a compass
  // turn that puts the world upside down puts them upside down with it.
  const turn = useMemo(() => avatarTurn(axes, null), [axes])

  if (near.length === 0) return null

  return (
    <>
      {near.map((p) => (
        <Person key={p.pubkey} pubkey={p.pubkey} center={p.centre} position={p.position} place={place} turn={turn} />
      ))}
    </>
  )
}
