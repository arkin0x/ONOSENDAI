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

/**
 * How much smaller labels are drawn on a narrow screen.
 *
 * A label's size is set in CSS pixels, which is the right unit for a desktop
 * window and too generous on a phone: the same 13 pixels is a comfortable
 * caption across 1280 and a shout across 400, where it also collides with
 * every other label because there is no room to spread out. This scales the
 * whole family down with the viewport, to a floor of 0.72 so the text stays
 * legible and stays a touch target. Full size from 700 CSS pixels up.
 */
export function labelShrink(width: number): number {
  return Math.max(0.72, Math.min(1, width / 700))
}

interface Props {
  text: string
  color: string
  /** Static anchor, used when `follow` is absent. */
  at?: [number, number, number]
  /** Per-frame anchor, for things React does not drive. */
  follow?: () => [number, number, number]
  /** Offset from the anchor, in cells. */
  offset?: [number, number, number]
  /**
   * Offset from the anchor in PIXELS, on screen, which is almost always what a
   * caller wants and almost never what `offset` gives them. A label holds a
   * constant pixel height, so nudging its anchor by a fraction of a cell pins
   * the text and its gap to different scales: the text stays put and the gap
   * grows and shrinks with camera depth. Applied inside the billboard, where
   * one unit is one `px`, so the offset is screen-aligned and depth-free.
   */
  offsetPx?: [number, number]
  /** Height in CSS pixels, held constant at any camera distance. */
  px?: number
  opacity?: number
  /** Left for labels that hang off a point, centre for labels that cap a face. */
  align?: 'left' | 'center'
  /**
   * A second line under the first, smaller and dimmer: a caption that belongs
   * to this label rather than a label of its own.
   *
   * It has to live inside this group. The group is scaled every frame so that
   * one local unit is exactly `px` pixels, so a local offset is a pixel offset
   * and the caption sits the same distance below its line at every zoom and
   * every camera distance. Placing a caption by nudging its anchor in cells
   * instead, which is what the world messages used to do, pins two things that
   * are sized differently to the same world offset: the text holds its pixel
   * height while the gap between them grows and shrinks with depth, and at a
   * wide view the caption ends up an inch away from what it captions.
   */
  sub?: string
  /** The caption's size, as a fraction of the line above it. */
  subScale?: number
  /** The caption's colour; the line's own colour when absent. */
  subColor?: string
  /** The caption's opacity. */
  subOpacity?: number
  /**
   * A second string set beside the first at a smaller size, as one piece: a
   * glyph and its reading, where the glyph carries and the reading explains.
   * The pair straddles the anchor, so neither has to be measured to place the
   * other, and both scale together because they share the group.
   */
  small?: string
  /** How big the second string is, as a fraction of the first. */
  smallScale?: number
}

export function WorldLabel({
  text, color, at, follow, offset = [0, 0, 0], offsetPx = [0, 0], px = 14, opacity = 1, align = 'left',
  small, smallScale = 0.68, sub, subScale = 0.72, subColor, subOpacity = 0.7,
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
    g.scale.setScalar((px * labelShrink(state.size.width) * depth) / projScale)
  })

  // One unit inside the billboard is one `px`, so a pixel offset divides by it.
  const nudge: [number, number, number] = [offsetPx[0] / px, offsetPx[1] / px, 0]

  return (
    <group ref={group}>
      <Billboard>
       <group position={nudge}>
        <Text
          font={WORLD_FONT}
          fontSize={1}
          anchorX={small === undefined ? align : 'right'}
          anchorY="middle"
          color={color}
          textAlign={align}
          fillOpacity={opacity}
          outlineWidth={0.06}
          outlineColor="#05070d"
          position={small === undefined ? undefined : [-0.14, 0, 0]}
        >
          {text}
        </Text>
        {small !== undefined && (
          <Text
            font={WORLD_FONT}
            fontSize={smallScale}
            anchorX="left"
            anchorY="middle"
            color={color}
            fillOpacity={opacity}
            outlineWidth={0.06}
            outlineColor="#05070d"
            position={[0.14, 0, 0]}
          >
            {small}
          </Text>
        )}
        {sub !== undefined && (
          <Text
            font={WORLD_FONT}
            fontSize={subScale}
            anchorX={align === 'center' ? 'center' : 'left'}
            anchorY="middle"
            color={subColor ?? color}
            textAlign={align}
            fillOpacity={opacity * subOpacity}
            outlineWidth={0.06}
            outlineColor="#05070d"
            position={[0, -(0.5 + subScale * 0.85), 0]}
          >
            {sub}
          </Text>
        )}
       </group>
      </Billboard>
    </group>
  )
}
