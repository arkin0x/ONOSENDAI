/**
 * SecretRegions.tsx — the regions you can open, drawn where they are.
 *
 * A held region key (store/useSecrets) is a cube of side 2^height, aligned on
 * every axis, and holding it means you can ask the relay what is hidden there
 * and read the answer. A key is held when it opened something or when it was
 * bought, so a cage here is not "somewhere you walked": it is somewhere with
 * something in it. This draws each one you are near as a light green cage with
 * a key at its +X +Z corner, the same green the deploy box uses for "found
 * here", so the colour means one thing throughout.
 *
 * Only what is worth drawing is drawn. A cube smaller than a few pixels or
 * wider than the field says nothing, and the nearest few are enough: past that
 * the cages overlap into a haze and the frame pays for it.
 */

import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { GRID_RADIUS, cellDelta, type AxisName, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useSecrets, type HeldKey } from '../store/useSecrets'
import { WorldLabel } from './WorldLabel'

/** The green of "found here", dimmer than the deploy box so it sits behind the work. */
const HELD = '#52e39f'

/** How many cages are drawn at once, nearest first. */
const DRAWN_MAX = 16

interface Props {
  axes: ViewAxes
}

interface Cage {
  key: HeldKey
  centre: [number, number, number]
  corner: [number, number, number]
  /** Per view axis, because a movement's region is a box and not a cube. */
  sides: [number, number, number]
}

export function SecretRegions({ axes }: Props): JSX.Element | null {
  const keys = useSecrets((s) => s.keys)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const show = useCyberspace((s) => s.showSecrets)

  const geometry = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])

  const cages = useMemo(() => {
    if (!show) return []
    const origin = alignedOrigin(anchor, scaleExp)
    const out: Cage[] = []
    const sideOf = (height: number): number => {
      const exp = height - scaleExp
      return exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
    }
    for (const key of Object.values(keys)) {
      if (key.plane !== anchorPlane) continue
      const widest = sideOf(key.height)
      if (widest > GRID_RADIUS * 6 || widest < 0.05) continue
      const centre: [number, number, number] = [0, 0, 0]
      const corner: [number, number, number] = [0, 0, 0]
      const sides: [number, number, number] = [1, 1, 1]
      let far = 0
      ;[axes.right, axes.up, axes.out].forEach((a, i) => {
        const axis: AxisName = a.axis
        // A hop's region is a box: each axis is as wide as its own crossing.
        const side = sideOf(key.heights ? key.heights[axis] : key.height)
        sides[i] = side
        const lo = cellDelta(BigInt(key.base[axis]), origin[axis], scaleExp)
        centre[i] = (lo + (side - 1) / 2) * a.dir
        // Always the same corner: +X and +Z, at the region's floor. A key
        // hanging at a fixed corner says which cage it belongs to, where one
        // at the nearest corner just floats.
        corner[i] = (lo + (axis === 'y' ? -0.5 : side - 0.5)) * a.dir
        far = Math.max(far, Math.abs(centre[i]))
      })
      if (far > GRID_RADIUS * 4) continue
      out.push({ key, centre, corner, sides })
    }
    // Nearest first, so the ones you are standing in are the ones you see.
    out.sort((a, b) => Math.hypot(...a.centre) - Math.hypot(...b.centre))
    return out.slice(0, DRAWN_MAX)
  }, [show, keys, anchor, anchorPlane, scaleExp, axes])

  if (cages.length === 0) return null

  return (
    <>
      {cages.map((cage) => (
        <group key={cage.key.lookupId}>
          <lineSegments geometry={geometry} position={cage.centre} scale={cage.sides} frustumCulled={false} renderOrder={8}>
            <lineBasicMaterial color={HELD} toneMapped={false} transparent opacity={0.4} depthTest={false} />
          </lineSegments>
          {/* The key at the region's low corner: a held region is an open one. */}
          <WorldLabel text="⚿" color={HELD} at={cage.corner} px={16} opacity={0.85} align="center" />
        </group>
      ))}
    </>
  )
}
