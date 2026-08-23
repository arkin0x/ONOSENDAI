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

/** The avatar's own red, so the marker for you is the colour you are drawn in. */
const YOU = '#ff2323'

/** §9.7: dataspace is centred on the half-axis point, 1 km = 1000 * 2^33. */
const EARTH_CENTRE = 1n << 84n
const EARTH_RADIUS = 6371n * 1000n * (1n << 33n)

export function useTargets(): CyberTarget[] {
  const plane = useCyberspace((s) => s.anchorPlane)
  const spectating = useCyberspace((s) => s.spectate !== null)
  const position = useCyberspace((s) => s.position)

  return useMemo(() => {
    const out: CyberTarget[] = []
    // While you are looking through someone else's eyes, the way home is a
    // thing worth pointing at from anywhere.
    if (spectating) out.push({ id: 'you', label: 'YOU', color: YOU, at: position })
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
  }, [plane, spectating, position])
}
