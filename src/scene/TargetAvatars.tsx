/**
 * TargetAvatars.tsx — a targeted avatar, once you are close enough to see it.
 *
 * The HUD marker says where a target is from any distance; this is the thing
 * itself when it is inside the drawn world: the same wireframe icosahedron you
 * are drawn as, in the target's own color, with its name over it. The
 * position is the chain head the tracker keeps current, so a target that hops
 * while you watch moves here as soon as the hop lands, gliding from where it
 * was over AVATAR_LERP_MS as every avatar does (OtherAvatar; arkinox,
 * 2026-10-12).
 */

import { useMemo } from 'react'
import { GRID_RADIUS, placeCentre, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { avatarTurn } from '../lib/facing'
import { OtherAvatar } from './OtherAvatar'
import { useMutes } from '../store/useMutes'

/** Same cull as Earth and the spawn marker. */
const REACH = GRID_RADIUS * 8

/**
 * Only at scales below 2^10 gibsons per cell. The icosahedron is a cell wide
 * whatever the zoom, so at the top of the ladder it was an eighth of
 * cyberspace, and it sits on the cell's centre while the HUD marker sits on
 * the exact point, up to a cell apart. Far out, the marker is the target.
 */
const AVATAR_SCALE_LIMIT = 10

interface Props {
  axes: ViewAxes
}

export function TargetAvatars({ axes }: Props): JSX.Element | null {
  const targets = useCyberspace((s) => s.targets)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const focus = useCyberspace((s) => s.focusPubkey())

  // Where a position is drawn in this render frame; OtherAvatar asks it where
  // a target was, to glide it from there (lib/avatarLerp.ts).
  const place = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    return (p: Position) => placeCentre(p, origin, scaleExp, axes)
  }, [anchor, scaleExp, axes])

  const blocked = useMutes((s) => s.muted.pubkeys)
  const near = useMemo(() => {
    if (scaleExp >= AVATAR_SCALE_LIMIT) return []
    const list = useCyberspace.getState().targetList()
    return list
      // Someone standing in the other plane is not here (§2.4).
      // Nor a target you blocked (store/useMutes).
      .filter((t) => t.id !== focus && targets[t.id]?.plane === anchorPlane && !blocked.has(t.id))
      .map((t) => ({ ...t, centre: place(t.at) }))
      .filter((t) => Math.hypot(...t.centre) <= REACH)
    // targets is what targetList reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, anchorPlane, scaleExp, focus, place, blocked])

  // Turned with the view like every shard and your own avatar, so a compass
  // turn that puts the world upside down puts them upside down with it.
  const turn = useMemo(() => avatarTurn(axes, null), [axes])

  if (near.length === 0) return null

  return (
    <>
      {near.map((t) => (
        <OtherAvatar key={t.id} pubkey={t.id} color={t.color} center={t.centre} position={t.at} place={place} turn={turn} label={t.label} labelOpacity={0.9} />
      ))}
    </>
  )
}
