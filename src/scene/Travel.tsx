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
 * The glide itself is lib/avatarLerp.ts AvatarLerp, the one every avatar
 * uses, over AVATAR_LERP_MS whatever the distance (arkinox, 2026-10-12). It
 * used to scale with distance here (220 ms plus 45 ms per cell, capped at
 * 900 ms); one constant for every avatar replaced that.
 *
 * The move is registered in a layout effect, before the browser can paint:
 * a passive effect could let one frame draw the avatar at its new place with
 * no offset yet, a flash at the destination before the glide began.
 */

import { useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AvatarLerp, type Vec3 } from '../lib/avatarLerp'
import { anchorCentre, placeCentre, type Position, type ViewAxes } from '../lib/space'
import { travelOffset } from '../lib/travel'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

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
  const lerp = useRef(new AvatarLerp())
  const out = useRef<Vec3>([0, 0, 0])

  useLayoutEffect(() => {
    const old = previous.current
    previous.current = anchor
    if (old.x === anchor.x && old.y === anchor.y && old.z === anchor.z) return

    const cut = previousKey.current !== focusKey || exploring
    previousKey.current = focusKey
    if (cut) {
      lerp.current.clear()
      travelOffset.set(0, 0, 0)
      return
    }

    // Where the avatar was, expressed against the origin it now uses, as an
    // offset from where it now stands. Below the continuous range it stands
    // on the origin and the subtraction is of zero; in it the avatar stands
    // at its sub-cell position (anchorCentre), and travelOffset has to be
    // measured from there for the hop to end where the avatar is drawn.
    const [x, y, z] = placeCentre(old, alignedOrigin(anchor, scaleExp), scaleExp, axes)
    const [sx, sy, sz] = anchorCentre(anchor, scaleExp, axes)
    // A hop far enough to leave the drawn world snaps (AVATAR_SNAP_CELLS);
    // one that lands mid-glide continues from where the avatar is drawn.
    const now = performance.now()
    lerp.current.move([x - sx, y - sy, z - sz], now)
    travelOffset.set(...lerp.current.offset(now, out.current))
    // scaleExp and axes are read at commit time on purpose: a zoom or a rotation
    // mid-flight must not restart or re-aim a journey already under way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, focusKey])

  useFrame(() => {
    if (travelOffset.lengthSq() === 0) return
    travelOffset.set(...lerp.current.offset(performance.now(), out.current))
  })

  return null
}
