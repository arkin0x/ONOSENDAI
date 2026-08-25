/**
 * TargetProjector.tsx — turns cyberspace coordinates into screen positions.
 *
 * Lives inside the Canvas because that is the only place the live camera is. It
 * writes into `targetScreens`, which the HUD overlay reads; see targets.ts for
 * why that is a module record and not store state.
 *
 * Positions are computed from the raw coordinates rather than from anything
 * already in render space, because a target is usually far outside the drawn
 * volume. cellDelta does the division in fixed-point bigint, so a landmark 10^25
 * gibsons away still lands on a real number instead of collapsing to Infinity.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { Vector3 } from 'three'

import { cellDelta, stepFor, type ViewAxes } from '../lib/space'
import { targetScreens, type CyberTarget } from '../lib/targets'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
  targets: CyberTarget[]
}

export function TargetProjector({ axes, targets }: Props): null {
  const scratch = useMemo(() => new Vector3(), [])
  const forward = useMemo(() => new Vector3(), [])
  const toTarget = useMemo(() => new Vector3(), [])

  useFrame((state) => {
    const s = useCyberspace.getState()
    // Everything is measured from the anchor: the avatar being looked at, which
    // is you at the head and whoever or whenever else the scene is anchored on.
    const origin = alignedOrigin(s.anchor, s.scaleExp)
    const step = stepFor(s.scaleExp)
    const cam = state.camera as unknown as { fov?: number; position: Vector3 }
    state.camera.getWorldDirection(forward)
    const projScale = cam.fov === undefined
      ? 0
      : state.size.height / (2 * Math.tan((cam.fov * Math.PI) / 360))

    for (const t of targets) {
      const [x, y, z] = [axes.right, axes.up, axes.out].map(
        (a) => (cellDelta(t.at[a.axis], origin[a.axis], s.scaleExp) - 0.5) * a.dir,
      )
      scratch.set(x, y, z)

      const depth = Math.max(0.001, cam.position.distanceTo(scratch))

      // Behind is decided in view space, from the camera's own forward vector.
      //
      // The obvious test after project() is NDC z > 1, and it is wrong: that is
      // also true of anything past the far plane, which is every target worth
      // having. The far plane is 6000 render units and a landmark is routinely
      // 10^10 cells away, so the marker for something dead ahead was being
      // treated as behind and mirrored to the opposite edge. Which is why it
      // appeared above you on one side of the sky and below you on the other.
      toTarget.copy(scratch).sub(cam.position)
      const behind = toTarget.dot(forward) <= 0

      scratch.project(state.camera)
      // project() genuinely does mirror x and y behind the camera, because the
      // perspective divide is by a negative w there. That is the only case that
      // needs undoing.
      const sx = behind ? -scratch.x : scratch.x
      const sy = behind ? -scratch.y : scratch.y

      const dist = (a: 'x' | 'y' | 'z'): bigint => {
        const d = t.at[a] - s.anchor[a]
        return d < 0n ? -d : d
      }
      // Chebyshev rather than Euclidean: no bigint square root, and for "how far
      // away is that" the largest axis gap is the honest headline anyway.
      const dx = dist('x'), dy = dist('y'), dz = dist('z')
      const distance = dx > dy ? (dx > dz ? dx : dz) : (dy > dz ? dy : dz)

      targetScreens[t.id] = {
        x: sx,
        y: sy,
        onScreen: !behind && Math.abs(sx) <= 1 && Math.abs(sy) <= 1,
        distance,
        px: t.radius === undefined
          ? 0
          : (Number((t.radius * 10_000n) / step) / 10_000) * projScale / depth,
      }
    }
  })

  return null
}
