/**
 * Travel.tsx — drives the avatar's catch-up after a commit.
 *
 * Watches the committed position. `position` only advances when a proof lands
 * (`applyProofMessage` sets it, and nothing else does), so this fires at exactly
 * the right moment on its own: nothing moves while the work is being done, and
 * the journey begins the instant it is paid for. That ordering is the point.
 * Sliding during the computation would imply the move was already happening,
 * when in fact the whole premise of the protocol is that it has to be earned
 * first.
 *
 * Duration scales mildly with distance so a one gibson step is a flick and a
 * long haul reads as a haul, but it is clamped: this is punctuation on a commit,
 * not a cutscene, and it must never make the interface feel slow.
 */

import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { cellCentre, type Position, type ViewAxes } from '../lib/space'
import { travelOffset } from '../lib/travel'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

/** Seconds, before the per-distance term. */
const BASE = 0.22
/** Extra seconds per render cell travelled. */
const PER_CELL = 0.045
const MAX = 0.9

interface Props {
  axes: ViewAxes
}

export function Travel({ axes }: Props): null {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const previous = useRef<Position>(position)
  const from = useRef(new Vector3())
  const duration = useRef(0)
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    const old = previous.current
    previous.current = position
    if (old.x === position.x && old.y === position.y && old.z === position.z) return

    // Where the avatar was, expressed against the origin it now uses.
    const [x, y, z] = cellCentre(old, alignedOrigin(position, scaleExp), scaleExp, axes)
    from.current.set(x, y, z)

    // A hop far enough to leave the drawn world would animate a mesh nobody can
    // see; snap those instead of pretending to fly there.
    if (from.current.length() > 400) {
      travelOffset.set(0, 0, 0)
      startedAt.current = null
      return
    }

    duration.current = Math.min(MAX, BASE + PER_CELL * from.current.length())
    startedAt.current = null
    travelOffset.copy(from.current)
    // scaleExp and axes are read at commit time on purpose: a zoom or a rotation
    // mid-flight must not restart or re-aim a journey already under way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position])

  useFrame((state) => {
    if (travelOffset.lengthSq() === 0) return
    if (startedAt.current === null) startedAt.current = state.clock.elapsedTime

    const t = (state.clock.elapsedTime - startedAt.current) / duration.current
    if (t >= 1) {
      travelOffset.set(0, 0, 0)
      startedAt.current = null
      return
    }
    // Ease out: leaves quickly, settles onto the destination rather than
    // stopping dead on it.
    const k = 1 - t
    travelOffset.copy(from.current).multiplyScalar(k * k * k)
  })

  return null
}
