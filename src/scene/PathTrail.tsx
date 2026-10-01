/**
 * PathTrail.tsx - renders the chain as a line through cyberspace.
 *
 * Each segment connects consecutive committed positions. When the scene is
 * anchored on an earlier action, the trail up to that action is drawn in full
 * and what came after it is drawn faint: the chain is the same object, you are
 * just standing somewhere along it, and the faint part is where it goes next.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { useCyberspace } from '../store/useCyberspace'
import { anchorCentre, placeCentre, type ViewAxes } from '../lib/space'
import { travelOffset } from '../lib/travel'
import { alignedOrigin } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
  scaleExp: number
}

export function PathTrail({ axes, scaleExp }: Props): JSX.Element | null {
  const ownHistory = useCyberspace((s) => s.positionHistory)
  const spectate = useCyberspace((s) => s.spectate)
  const anchor = useCyberspace((s) => s.anchor)
  const exploreIndex = useCyberspace((s) => s.exploreIndex)
  const focus = useCyberspace((s) => s.focus)
  // Off from the Chain panel's switch (arkinox, 2026-10-01); read with the
  // other hooks so the early return below stays after every one of them.
  const showTrail = useCyberspace((s) => s.showTrail)

  // Whose trail: the spectated avatar's chain, else your own.
  const positionHistory = useMemo(
    () => (spectate ? spectate.actions.map((a) => a.position) : ownHistory),
    [spectate, ownHistory],
  )
  const split = exploreIndex ?? positionHistory.length - 1

  const geometry = useMemo(() => {
    if (positionHistory.length < 2) return null

    const origin = alignedOrigin(anchor, scaleExp)
    const walked: number[] = []
    const ahead: number[] = []

    // All three axes. The trail used to map right and up only and pin depth to a
    // constant, so it drew a flat shadow of a 3D path: every out-axis hop
    // collapsed to nothing, and rotating the view changed which axis was being
    // flattened, so the shape changed with the view. placeCentre, matching
    // the cursor and the avatar, so a segment ends where its gibson is drawn:
    // cell centres below the continuous range, true positions in it, where a
    // trail across the whole cube would otherwise fold onto eight corners.
    const centre = (p: typeof anchor): [number, number, number] =>
      placeCentre(p, origin, scaleExp, axes)

    for (let i = 0; i < positionHistory.length - 1; i++) {
      const into = i < split ? walked : ahead
      into.push(...centre(positionHistory[i]), ...centre(positionHistory[i + 1]))
    }

    const make = (v: number[]): BufferGeometry | null => {
      if (v.length === 0) return null
      const geom = new BufferGeometry()
      geom.setAttribute('position', new Float32BufferAttribute(v, 3))
      return geom
    }
    // Where the avatar stands, for the head-riding vertex below.
    return { walked: make(walked), ahead: make(ahead), head: anchorCentre(anchor, scaleExp, axes) }
  }, [positionHistory, axes, scaleExp, anchor, split])
  // Rebuilt on every hop and re-anchor; the old pair's GL buffers go with it.
  useEffect(() => () => { geometry?.walked?.dispose(); geometry?.ahead?.dispose() }, [geometry])

  // The newest segment ends on the avatar, which is drawn trailing behind its
  // committed cell for a moment after a commit. Left alone, the trail would
  // reach the destination while you were still visibly travelling to it, so the
  // line would lead you there. Its final vertex rides the same offset, from
  // the same place the avatar stands. Only at the head: in history nothing is
  // travelling.
  const lastVertex = useRef<Float32Array | null>(null)
  useFrame(() => {
    if (exploreIndex !== null || spectate || focus !== null) return
    const attr = geometry?.walked?.attributes.position
    const head = geometry?.head
    if (!attr || !head) return
    const arr = attr.array as Float32Array
    const n = arr.length
    if (n < 3) return
    if (lastVertex.current !== arr) lastVertex.current = arr
    arr[n - 3] = head[0] + travelOffset.x
    arr[n - 2] = head[1] + travelOffset.y
    arr[n - 1] = head[2] + travelOffset.z
    attr.needsUpdate = true
  })

  // A focus view (a hyperspace stop, EARTH, a shard) anchors the scene far
  // from the chain, and the head-riding vertex above would pin the trail's
  // last point to the render origin: a red line from your history straight
  // into whatever is being viewed. The avatar hides under a focus; its trail
  // does too.
  if (!geometry || focus !== null || !showTrail) return null

  return (
    <>
      {geometry.walked && (
        <lineSegments geometry={geometry.walked} frustumCulled={false}>
          <lineBasicMaterial color="#ff0000" linewidth={2} toneMapped={false} />
        </lineSegments>
      )}
      {geometry.ahead && (
        <lineSegments geometry={geometry.ahead} frustumCulled={false}>
          <lineBasicMaterial color="#ff0000" transparent opacity={0.22} toneMapped={false} />
        </lineSegments>
      )}
    </>
  )
}
