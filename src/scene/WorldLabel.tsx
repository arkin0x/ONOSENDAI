/**
 * WorldLabel.tsx — text that lives in the scene but reads like HUD.
 *
 * Billboarded so it always faces you, and rescaled from view depth every frame
 * so it holds a constant pixel height. Without that second part a label shrinks
 * to nothing as you pull the camera out, which is exactly when you most want to
 * read it.
 *
 * `follow` exists because some labels are attached to things driven per frame
 * rather than by React. The cursor is the case that matters: it moves on the
 * frame you press the key, and a label that waited for a render would visibly
 * lag behind the cube it is supposed to be stuck to.
 */

import { useMemo, useRef } from 'react'
import { Billboard, Text } from '@react-three/drei'
import { useFrame, type RootState } from '@react-three/fiber'
import { Group, Vector3 } from 'three'
import { WORLD_FONT } from '../lib/font'

interface Props {
  text: string
  color: string
  /** Static anchor, used when `follow` is absent. */
  at?: [number, number, number]
  /** Per-frame anchor, for things React does not drive. */
  follow?: () => [number, number, number]
  /** Offset from the anchor, in cells. */
  offset?: [number, number, number]
  /** Height in CSS pixels, held constant at any camera distance. */
  px?: number
  opacity?: number
}

export function WorldLabel({
  text, color, at, follow, offset = [0, 0, 0], px = 14, opacity = 1,
}: Props): JSX.Element {
  const group = useRef<Group>(null)
  const scratch = useMemo(() => new Vector3(), [])

  useFrame((state: RootState) => {
    const g = group.current
    if (!g) return

    const anchor = follow ? follow() : at
    if (anchor) {
      g.position.set(anchor[0] + offset[0], anchor[1] + offset[1], anchor[2] + offset[2])
    }

    const cam = state.camera as unknown as { fov?: number; position: Vector3 }
    if (cam.fov === undefined) return
    const depth = Math.max(0.001, cam.position.distanceTo(g.getWorldPosition(scratch)))
    const projScale = state.size.height / (2 * Math.tan((cam.fov * Math.PI) / 360))
    g.scale.setScalar((px * depth) / projScale)
  })

  return (
    <group ref={group}>
      <Billboard>
        <Text
          font={WORLD_FONT}
          fontSize={1}
          anchorX="left"
          anchorY="middle"
          color={color}
          fillOpacity={opacity}
          outlineWidth={0.06}
          outlineColor="#05070d"
        >
          {text}
        </Text>
      </Billboard>
    </group>
  )
}
