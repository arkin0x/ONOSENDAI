/**
 * GameRegionBox.tsx - the cube a game is played in, while the identity is in it.
 *
 * A virtual bracket declares its region in the clear: an aligned cube of
 * height H, 2^H gibsons on a side (spec §8.11.1). Clients should draw that
 * region while the identity is inside the game (§8.11.7), so a viewer can see
 * where the game is played and that the pink moves inside it are play, not
 * travel. Drawn for the action the scene stands on, yours or a spectated
 * chain's: at the head while a game holds the avatar, or at any action inside
 * a bracket while walking the chain. Pink, the color of play everywhere it is
 * drawn (palette GAME), and in the manner of the deploy box: edges only, sized
 * to the zoom, skipped when it would be too large or too small to read.
 */

import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { GRID_RADIUS, cellDelta, type AxisName, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { openBracket } from '../lib/events'
import { GAME } from '../lib/palette'

interface Props {
  axes: ViewAxes
}

export function GameRegionBox({ axes }: Props): JSX.Element | null {
  const events = useCyberspace((s) => s.events)
  const spectate = useCyberspace((s) => s.spectate)
  const exploreIndex = useCyberspace((s) => s.exploreIndex)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const focus = useCyberspace((s) => s.focus)

  const geometry = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])

  // The bracket open at the action the scene stands on, if any.
  const region = useMemo(() => {
    const chain = useCyberspace.getState().focusChain()
    return openBracket(chain, exploreIndex ?? chain.length - 1)?.region ?? null
  }, [events, spectate, exploreIndex])

  const box = useMemo(() => {
    if (!region || region.plane !== anchorPlane) return null
    // Side length in cells at this zoom: 2^(H - scaleExp).
    const exp = region.height - scaleExp
    const side = exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
    if (side > GRID_RADIUS * 8 || side < 0.02) return null
    const origin = alignedOrigin(anchor, scaleExp)
    const centre: [number, number, number] = [0, 0, 0]
    ;[axes.right, axes.up, axes.out].forEach((a, i) => {
      const axis: AxisName = a.axis
      const lo = cellDelta(region.base[axis], origin[axis], scaleExp)
      // The cube spans `side` cells from its low corner; center it.
      centre[i] = (lo + (side - 1) / 2) * a.dir
    })
    return { centre, side }
  }, [region, anchor, anchorPlane, scaleExp, axes])

  // A focus view is anchored somewhere else entirely; the chain's marks hide under it.
  if (!box || focus !== null) return null

  return (
    <lineSegments geometry={geometry} position={box.centre} scale={box.side} frustumCulled={false} renderOrder={9}>
      <lineBasicMaterial color={GAME} toneMapped={false} transparent opacity={0.75} depthTest={false} />
    </lineSegments>
  )
}
