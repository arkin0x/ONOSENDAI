/**
 * PathTrail.tsx - renders the chain as a line through cyberspace.
 *
 * Each segment connects consecutive committed positions. When the scene is
 * anchored on an earlier action, the trail up to that action is drawn in full
 * and what came after it is drawn faint: the chain is the same object, you are
 * just standing somewhere along it, and the faint part is where it goes next.
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { useCyberspace } from '../store/useCyberspace'
import { cellCentre, type ViewAxes } from '../lib/space'
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
    // flattened, so the shape changed with the view. Cell centres, matching the
    // cursor and the avatar, so a segment ends where its gibson is drawn.
    const centre = (p: typeof anchor): [number, number, number] =>
      cellCentre(p, origin, scaleExp, axes)

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
    return { walked: make(walked), ahead: make(ahead) }
  }, [positionHistory, axes, scaleExp, anchor, split])

  // The newest segment ends on the avatar, which is drawn trailing behind its
  // committed cell for a moment after a commit. Left alone, the trail would
  // reach the destination while you were still visibly travelling to it, so the
  // line would lead you there. Its final vertex rides the same offset. Only at
  // the head: in history nothing is travelling.
  const lastVertex = useRef<Float32Array | null>(null)
  useFrame(() => {
    if (exploreIndex !== null || spectate || focus !== null) return
    const attr = geometry?.walked?.attributes.position
    if (!attr) return
    const arr = attr.array as Float32Array
    const n = arr.length
    if (n < 3) return
    if (lastVertex.current !== arr) lastVertex.current = arr
    arr[n - 3] = travelOffset.x
    arr[n - 2] = travelOffset.y
    arr[n - 1] = travelOffset.z
    attr.needsUpdate = true
  })

  // A focus view (a hyperspace stop, EARTH, a shard) anchors the scene far
  // from the chain, and the head-riding vertex above would pin the trail's
  // last point to the render origin: a red line from your history straight
  // into whatever is being viewed. The avatar hides under a focus; its trail
  // does too.
  if (!geometry || focus !== null) return null

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
