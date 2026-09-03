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
import type { CyberTarget } from '../lib/targets'
import { useCyberspace } from '../store/useCyberspace'

/** The avatar's own red, so the marker for you is the color you are drawn in. */
const YOU = '#ff2323'

/** §9.7: dataspace is centred on the half-axis point, 1 km = 1000 * 2^33. */
const EARTH_CENTRE = 1n << 84n
const EARTH_RADIUS = 6371n * 1000n * (1n << 33n)

export function useTargets(): CyberTarget[] {
  const plane = useCyberspace((s) => s.anchorPlane)
  const spectating = useCyberspace((s) => s.spectate !== null)
  const focused = useCyberspace((s) => s.focus !== null)
  const position = useCyberspace((s) => s.position)
  const headPlane = useCyberspace((s) => s.headPlane)
  const tracked = useCyberspace((s) => s.targets)
  const focus = useCyberspace((s) => s.focusPubkey())

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
    // While the camera is anywhere you are not (someone else's eyes, a
    // hyperspace stop, EARTH, a shard), the way home is a thing worth
    // pointing at from anywhere; the projector's distance readout doubles as
    // how far the viewed place is from where you actually stand.
    if ((spectating || focused) && headPlane === plane) out.push({ id: 'you', label: 'YOU', color: YOU, at: position })
    // Ideaspace has no physical mapping, so there is no planet in it to point at.
    if (plane === 0) {
      out.push({
        id: 'earth',
        label: 'EARTH',
        color: EARTH,
        at: { x: EARTH_CENTRE, y: EARTH_CENTRE, z: EARTH_CENTRE },
        radius: EARTH_RADIUS,
      })
    }
    return out
    // tracked is what targetList reads; listed so the memo follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plane, headPlane, spectating, focused, position, tracked, focus])
}
