/**
 * ChatRoomBox.tsx — the room you are speaking to, and the rooms you can hear.
 *
 * While the chat is open, a green cube marks the aligned 2^SCAN_MAX_HEIGHT
 * region a line from here is sealed to: whoever stands inside it hears you.
 * Around it, dimmer, the block of the 26 neighboring cubes whose keys the
 * feed also holds: whoever speaks inside that block is heard here. Both are
 * drawn from the anchor, which is your avatar when you are at your head and
 * the place you are looking otherwise, since the scan and the feed follow
 * the anchor. The point is to see at a glance whether the avatars near you
 * are within your shot.
 */

import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { GRID_RADIUS, cellDelta, type AxisName, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useChat } from '../store/useChat'
import { SCAN_MAX_HEIGHT } from '../store/useShards'
import { WorldLabel } from './WorldLabel'

/** The green of "found here", the same as the deploy box and the region keys. */
const ROOM = '#52e39f'

interface Props {
  axes: ViewAxes
}

export function ChatRoomBox({ axes }: Props): JSX.Element | null {
  const open = useChat((s) => s.open)
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const geometry = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])

  const box = useMemo(() => {
    if (!open) return null
    const exp = SCAN_MAX_HEIGHT - scaleExp
    const side = exp >= 0 ? Number(1n << BigInt(exp)) : 1 / Number(1n << BigInt(-exp))
    // The listening block is three rooms wide; past the field it is a wall of
    // lines, and under a cell there is nothing to see.
    if (side * 3 > GRID_RADIUS * 8 || side < 0.02) return null
    const origin = alignedOrigin(anchor, scaleExp)
    const h = BigInt(SCAN_MAX_HEIGHT)
    const centre: [number, number, number] = [0, 0, 0]
    ;[axes.right, axes.up, axes.out].forEach((a, i) => {
      const axis: AxisName = a.axis
      const base = (anchor[axis] >> h) << h
      const lo = cellDelta(base, origin[axis], scaleExp)
      centre[i] = (lo + (side - 1) / 2) * a.dir
    })
    return { centre, side }
  }, [open, anchor, scaleExp, axes])

  if (!box) return null

  return (
    <>
      {/* The room a line from here reaches. */}
      <lineSegments geometry={geometry} position={box.centre} scale={box.side} frustumCulled={false} renderOrder={9}>
        <lineBasicMaterial color={ROOM} toneMapped={false} transparent opacity={0.85} depthTest={false} />
      </lineSegments>
      {/* The rooms a line reaches here from: this one and the 26 around it. */}
      <lineSegments geometry={geometry} position={box.centre} scale={box.side * 3} frustumCulled={false} renderOrder={9}>
        <lineBasicMaterial color={ROOM} toneMapped={false} transparent opacity={0.22} depthTest={false} />
      </lineSegments>
      <WorldLabel text="⚿" small={`CHAT 2^${SCAN_MAX_HEIGHT}`} color={ROOM} at={box.centre} offset={[0, box.side / 2 + 0.6, 0]} px={13} opacity={0.9} />
    </>
  )
}
