/**
 * TargetProjector.tsx — turns cyberspace coordinates into screen positions.
 *
 * Lives inside the Canvas because that is the only place the live camera is. It
 * writes into `targetScreens`, which the HUD overlay reads; see targets.ts for
 * why that is a module record and not store state.
 *
 * Positions are computed from the raw coordinates rather than from anything
 * already in render space, because a target is usually far outside the drawn
 * volume. cellDelta (under placeCentre and pointCentre) does the division in
 * fixed-point bigint, so a landmark 10^25 gibsons away still lands on a real
 * number instead of collapsing to Infinity.
 *
 * Everything is measured in the frame the scene on screen is drawn in, as it
 * is at this moment (arkinox, 2026-11-18: "every chain action that resolves
 * causes the other avatar in my hud to jitter"). A landing re-centres render
 * space on your new chain head, and the rig moves the camera by that shift
 * in the same frame. This used to read the drawn avatar's world matrix as
 * the last render left it, from before the shift, against the camera after
 * it, so for one frame at every landing the name, picture and ring under
 * another avatar were drawn as far off as the walk had come (a whole
 * segment), then snapped back; and the marker's own point was measured from
 * the store's anchor, which a landing moves a commit before the scene. Now
 * the avatar's and the camera's matrices are brought up to date first
 * (drawnLabelAnchor), and the point is placed against the committed anchor
 * (lib/renderFrame.ts), as the rig and your own avatar are.
 */

import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { Box3, Vector3, type Camera, type Object3D } from 'three'

import { placeCentre, pointCentre, stepFor, type Position, type ViewAxes } from '../lib/space'
import { drawnAvatars, targetScreens, viewAxis, type CyberTarget } from '../lib/targets'
import { viewAxisNdc } from '../lib/coverBand'
import { labelAnchor, type LabelAnchor } from '../lib/avatarLabel'
import { committedAnchor } from '../lib/renderFrame'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
  targets: CyberTarget[]
}

/**
 * Where a target's marker points, in render space: where the scene draws it.
 *
 * A person (you, a target, anyone present) is drawn at placeCentre, the
 * centre of their gibson's cell at this zoom (Avatar, OtherAvatar), so the
 * marker is too. It used to be the raw coordinate less half a cell, which
 * is the cell's low corner: the YOU circle and every other avatar's hung on
 * the corner of the cube they stood in (arkinox, 2026-11-02). Something with
 * an extent (Earth) keeps the continuous point its sphere is drawn about.
 * From CONTINUOUS_SCALE_MIN up the two agree, as placeCentre is pointCentre
 * there.
 */
export function targetPoint(
  t: { at: Position; radius?: bigint }, origin: Position, scaleExp: number, axes: ViewAxes,
): [number, number, number] {
  return t.radius === undefined ? placeCentre(t.at, origin, scaleExp, axes) : pointCentre(t.at, origin, scaleExp, axes)
}

/**
 * Where the label hangs under a drawn avatar, on the screen (lib/avatarLabel
 * labelAnchor), or undefined when none of it is in front of the camera.
 *
 * The avatar's world matrix and the camera's are brought up to date first,
 * parents included: a frame's callbacks move groups and the camera, and
 * three only recomputes world matrices when it renders. Box3.setFromObject
 * updates the object itself but not its parents, so an avatar whose group
 * was just re-placed (a landing's re-centring, in the commit before this
 * frame) was measured where the last render drew it, against a camera the
 * rig had already moved.
 */
export function drawnLabelAnchor(drawn: Object3D, camera: Camera, box: Box3 = new Box3(), corner: Vector3 = new Vector3()): LabelAnchor | undefined {
  camera.updateMatrixWorld()
  drawn.updateWorldMatrix(true, false)
  box.setFromObject(drawn)
  if (box.isEmpty()) return undefined
  return labelAnchor(
    { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
    (p) => {
      corner.set(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse)
      if (corner.z >= 0) return null
      corner.applyMatrix4(camera.projectionMatrix)
      return [corner.x, corner.y]
    },
  ) ?? undefined
}

/** The origin a frame measures targets from: the anchor the scene on screen was committed with (lib/renderFrame.ts), else the store's. */
export function projectorOrigin(s: { anchor: Position; scaleExp: number }): Position {
  return alignedOrigin(committedAnchor() ?? s.anchor, s.scaleExp)
}

export function TargetProjector({ axes, targets }: Props): null {
  const scratch = useMemo(() => new Vector3(), [])
  const forward = useMemo(() => new Vector3(), [])
  const toTarget = useMemo(() => new Vector3(), [])
  const box = useMemo(() => new Box3(), [])
  const corner = useMemo(() => new Vector3(), [])

  useFrame((state) => {
    const s = useCyberspace.getState()
    // Everything is measured from the anchor: the avatar being looked at, which
    // is you at the head and whoever or whenever else the scene is anchored on.
    // The one the scene on screen was drawn with, which a landing moves a
    // commit after the store (lib/renderFrame.ts), as the camera is.
    const origin = projectorOrigin(s)
    // The camera as the rig has left it this frame (drawnLabelAnchor).
    state.camera.updateMatrixWorld()
    const step = stepFor(s.scaleExp)
    const cam = state.camera as unknown as { fov?: number; position: Vector3 }
    state.camera.getWorldDirection(forward)
    const projScale = cam.fov === undefined
      ? 0
      : state.size.height / (2 * Math.tan((cam.fov * Math.PI) / 360))
    // The picture's middle: off the window's while BUILD shifts the lens.
    const axis = viewAxisNdc(state.camera.projectionMatrix, viewAxis)

    for (const t of targets) {
      const [x, y, z] = targetPoint(t, origin, s.scaleExp, axes)
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
      // needs undoing. The mirror is about the line of sight, which a lens
      // shift moves off the window's middle; the shift itself is not mirrored.
      const sx = behind ? 2 * axis.x - scratch.x : scratch.x
      const sy = behind ? 2 * axis.y - scratch.y : scratch.y

      const dist = (a: 'x' | 'y' | 'z'): bigint => {
        const d = t.at[a] - s.anchor[a]
        return d < 0n ? -d : d
      }
      // Chebyshev rather than Euclidean: no bigint square root, and for "how far
      // away is that" the largest axis gap is the honest headline anyway.
      const dx = dist('x'), dy = dist('y'), dz = dist('z')
      const distance = dx > dy ? (dx > dz ? dx : dz) : (dy > dz ? dy : dz)

      // The avatar as drawn, when the scene draws one for this target: the
      // label goes under its lowest point, centered on it (lib/avatarLabel;
      // arkinox, 2026-10-11). Without one (your own, or one not drawn) the
      // marker is the point above, the centre of the avatar's cell.
      const drawn = drawnAvatars[t.id]
      const avatar: LabelAnchor | undefined = drawn ? drawnLabelAnchor(drawn, state.camera, box, corner) : undefined

      targetScreens[t.id] = {
        ...(avatar ? { avatar } : {}),
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
