/**
 * PathTrail.tsx - renders red lines connecting all committed positions.
 *
 * Shows the movement chain as a visible trail through cyberspace.
 * Each segment connects consecutive positions in the history array.
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
  const positionHistory = useCyberspace((s) => s.positionHistory)
  const position = useCyberspace((s) => s.position)

  const geometry = useMemo(() => {
    if (positionHistory.length < 2) return null

    const origin = alignedOrigin(position, scaleExp)
    const vertices: number[] = []

    // All three axes. The trail used to map right and up only and pin depth to a
    // constant, so it drew a flat shadow of a 3D path: every out-axis hop
    // collapsed to nothing, and rotating the view changed which axis was being
    // flattened, so the shape changed with the view. Cell centres, matching the
    // cursor and the avatar, so a segment ends where its gibson is drawn.
    const centre = (p: typeof position): [number, number, number] =>
      cellCentre(p, origin, scaleExp, axes)

    for (let i = 0; i < positionHistory.length - 1; i++) {
      vertices.push(...centre(positionHistory[i]), ...centre(positionHistory[i + 1]))
    }

    const geom = new BufferGeometry()
    geom.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    return geom
  }, [positionHistory, axes, scaleExp, position])

  // The newest segment ends on the avatar, which is drawn trailing behind its
  // committed cell for a moment after a commit. Left alone, the trail would
  // reach the destination while you were still visibly travelling to it, so the
  // line would lead you there. Its final vertex rides the same offset.
  const lastVertex = useRef<Float32Array | null>(null)
  useFrame(() => {
    const attr = geometry?.attributes.position
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

  if (!geometry) return null

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#ff0000" linewidth={2} toneMapped={false} />
    </lineSegments>
  )
}
