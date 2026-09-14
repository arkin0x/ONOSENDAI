/**
 * useTargets.ts — what is worth pointing at right now.
 *
 * Deliberately a list rather than a hardcoded Earth. The same marker serves any
 * fixed landmark and, once there is anyone else here, any other avatar: the
 * problem a target solves is "this thing is somewhere in 2^85 and I cannot see
 * it", which is identical whether the thing is a planet or a person.
 */

import { useMemo } from 'react'
import { EARTH } from '../lib/palette'
import { targetColor, type CyberTarget } from '../lib/targets'
import { usePresence } from '../store/usePresence'
import { useCyberspace } from '../store/useCyberspace'

/** The avatar's own red, so the marker for you is the color you are drawn in. */
const YOU = '#ff2323'

/** §9.7: dataspace is centred on the half-axis point, 1 km = 1000 * 2^33. */
const EARTH_CENTRE = 1n << 84n
const EARTH_RADIUS = 6371n * 1000n * (1n << 33n)

/**
 * Whether a focus is on the planet: its centre, a point on its surface, or a
 * landfall block. Judged by where the focus is rather than by what it is
 * called, so every way of looking at Earth counts. Earth is 2^55.6 gibsons
 * in radius and the next thing in dataspace is some 10^8 radii away, so a
 * box of 2^57 a side around the centre holds the planet and nothing else.
 */
export function onEarth(focus: { position: { x: bigint; y: bigint; z: bigint }; plane: number } | null): boolean {
  if (!focus || focus.plane !== 0) return false
  const reach = 1n << 57n
  const near = (v: bigint): boolean => (v > EARTH_CENTRE ? v - EARTH_CENTRE : EARTH_CENTRE - v) <= reach
  return near(focus.position.x) && near(focus.position.y) && near(focus.position.z)
}

export function useTargets(): CyberTarget[] {
  const plane = useCyberspace((s) => s.anchorPlane)
  const spectating = useCyberspace((s) => s.spectate !== null)
  const focused = useCyberspace((s) => s.focus !== null)
  const position = useCyberspace((s) => s.position)
  const headPlane = useCyberspace((s) => s.headPlane)
  const tracked = useCyberspace((s) => s.targets)
  const focus = useCyberspace((s) => s.focusPubkey())
  // Looking at the planet, from anywhere on or in it: the marker points at
  // its core, and says so, since from the surface the centre is straight down.
  const viewingEarth = useCyberspace((s) => onEarth(s.focus))
  const people = usePresence((s) => s.people)
  const me = useCyberspace((s) => s.identity.pubkey)

  return useMemo(() => {
    const out: CyberTarget[] = []
    // Tracked pubkeys first, except the one the scene is looking through: a
    // marker for the avatar you are standing on would sit on your own centre.
    // Only targets in the plane the scene is showing: a coordinate in the
    // other plane is not a place in this one (§2.4).
    for (const t of useCyberspace.getState().targetList()) {
      if (t.id === focus) continue
      const tr = tracked[t.id]
      if (tr && tr.plane !== plane) continue
      out.push(t)
    }
    // Everyone else in the sector, at any distance: the same marker a target
    // gets, dimmer, so a person shows at the screen's edge before they are in
    // the field, and passing one without knowing stops being the normal case.
    // Same plane rule as a target; your targets and you are already covered.
    for (const p of Object.values(people)) {
      if (p.pubkey === me || p.pubkey === focus || tracked[p.pubkey] || p.plane !== plane) continue
      out.push({ id: p.pubkey, label: `${p.pubkey.slice(0, 8)}…`.toUpperCase(), color: targetColor(p.pubkey), at: p.position, presence: true })
    }
    // While the camera is anywhere you are not (someone else's eyes, a
    // hyperspace stop, EARTH, a shard), the way home is a thing worth
    // pointing at from anywhere; the projector's distance readout doubles as
    // how far the viewed place is from where you actually stand.
    if ((spectating || focused) && headPlane === plane) out.push({ id: 'you', label: 'YOU', color: YOU, at: position })
    // Ideaspace has no physical mapping, so there is no planet in it to point at.
    if (plane === 0) {
      out.push({
        id: 'earth',
        label: viewingEarth ? "EARTH'S CORE" : 'EARTH',
        color: EARTH,
        at: { x: EARTH_CENTRE, y: EARTH_CENTRE, z: EARTH_CENTRE },
        radius: EARTH_RADIUS,
      })
    }
    return out
    // tracked is what targetList reads; listed so the memo follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plane, headPlane, spectating, focused, position, tracked, focus, people, me, viewingEarth])
}
