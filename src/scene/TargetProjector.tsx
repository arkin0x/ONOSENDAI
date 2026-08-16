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

  useFrame((state) => {
    const s = useCyberspace.getState()
    const origin = alignedOrigin(s.position, s.scaleExp)
    const step = stepFor(s.scaleExp)
    const cam = state.camera as unknown as { fov?: number; position: Vector3 }
    const projScale = cam.fov === undefined
      ? 0
      : state.size.height / (2 * Math.tan((cam.fov * Math.PI) / 360))

    for (const t of targets) {
      const [x, y, z] = [axes.right, axes.up, axes.out].map(
        (a) => cellDelta(t.at[a.axis], origin[a.axis], s.scaleExp) * a.dir,
      )
      scratch.set(x, y, z)

      const depth = Math.max(0.001, cam.position.distanceTo(scratch))
      scratch.project(state.camera)

      // project() mirrors x and y for anything behind the camera, which would
      // put a target directly behind you on the wrong edge of the screen.
      const behind = scratch.z > 1
      const sx = behind ? -scratch.x : scratch.x
      const sy = behind ? -scratch.y : scratch.y

      const dist = (a: 'x' | 'y' | 'z'): bigint => {
        const d = t.at[a] - s.position[a]
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
