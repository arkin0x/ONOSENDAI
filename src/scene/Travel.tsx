/**
 * Travel.tsx — drives the avatar's catch-up after a move.
 *
 * Watches the anchor. At your own head that advances only when a proof lands
 * (`applyProofMessage` sets it, and nothing else does), so this fires at
 * exactly the right moment on its own: nothing moves while the work is being
 * done, and the journey begins the instant it is paid for. That ordering is
 * the point. Sliding during the computation would imply the move was already
 * happening, when in fact the whole premise of the protocol is that it has to
 * be earned first. While spectating, the anchor advances when THEIR proof
 * lands on the relay, and the same catch-up shows their hop.
 *
 * Scrubbing history and changing whose chain is shown are not moves, and snap.
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
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // A new chain (respawn), a new avatar (spectate), or a new fixed point
  // (looking at a shard) is a cut, not a journey.
  const focusKey = useCyberspace((s) => `${s.focusPubkey()}:${s.genesisId}:${s.focus ? s.focus.position.x.toString() : ''}`)
  const exploring = useCyberspace((s) => s.exploreIndex !== null)

  const previous = useRef<Position>(anchor)
  const previousKey = useRef(focusKey)
  const from = useRef(new Vector3())
  const duration = useRef(0)
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    const old = previous.current
    previous.current = anchor
    if (old.x === anchor.x && old.y === anchor.y && old.z === anchor.z) return

    const cut = previousKey.current !== focusKey || exploring
    previousKey.current = focusKey
    if (cut) {
      travelOffset.set(0, 0, 0)
      startedAt.current = null
      return
    }

    // Where the avatar was, expressed against the origin it now uses.
    const [x, y, z] = cellCentre(old, alignedOrigin(anchor, scaleExp), scaleExp, axes)
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
  }, [anchor, focusKey])

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
