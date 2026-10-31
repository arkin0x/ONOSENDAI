/**
 * DoorRooms.tsx: the red cube (chest and door design, 4.4, R8).
 *
 * One outline per door of yours in view: its room, the aligned cube of its
 * height, so you can see where what you place is sealed to it. For you alone
 * and only in BUILD or DEPLOY: it is drawn from your own door rows, and only
 * while the Builder is on. A door being placed has one too, which follows its
 * height (4.2). A room too big for the view is drawn clipped about the door,
 * as the green region box is (DeployRegionBox drawnRegion).
 */

import { useEffect, useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { deployPoint, type ViewAxes } from '../lib/space'
import { buildPlane, buildStepOf } from '../lib/buildCursor'
import type { OwnDoor } from '../lib/doors'
import { useBuilder } from '../store/useBuilder'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { ownDoors, useShards, type MyDeployment } from '../store/useShards'
import { drawnRegion } from './DeployRegionBox'

/** The red of a lock. */
export const ROOM_RED = '#ff3b4e'
/** The widest a room is drawn, in cells, as the green box. */
const MAX_CELLS = 25
/** How far from the view's centre a room is still drawn, in cells. */
const REACH = 400

/**
 * Which rooms to outline: none outside BUILD and DEPLOY (R8), and only your
 * own doors, in the plane on show. Rows of one room are one outline.
 */
export function roomOutlines(mine: readonly MyDeployment[], me: string, building: boolean, plane: number): OwnDoor[] {
  if (!building) return []
  const seen = new Set<string>()
  return ownDoors(mine, me).filter((d) => {
    if (d.plane !== plane) return false
    const s = BigInt(d.height)
    const key = `${d.height}:${d.at.x >> s}:${d.at.y >> s}:${d.at.z >> s}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function DoorRooms({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const building = useBuilder((s) => s.active)
  const mine = useShards((s) => s.mine)
  const me = useCyberspace((s) => s.identity.pubkey)
  const plane = useCyberspace(buildPlane)
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const cursor = useCyberspace((s) => s.cursor)
  const step = useCyberspace(buildStepOf)
  const height = useShards((s) => s.deployHeight)
  // A door being placed: its cube follows the height (4.2).
  const placing = useShards((s) => (s.pending?.type === 'chest' && s.pending.door && !s.pending.move ? s.pending.spot?.at ?? true : null))
  const geometry = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const boxes = useMemo(() => {
    const origin = alignedOrigin(anchor, scaleExp)
    const out: Array<{ key: string; centre: [number, number, number]; size: [number, number, number] }> = []
    for (const d of roomOutlines(mine, me, building, plane)) {
      const b = drawnRegion(d.at, origin, d.height, scaleExp, axes, MAX_CELLS)
      if (b && Math.hypot(...b.centre) <= REACH) out.push({ key: d.eventId, centre: b.centre, size: b.size })
    }
    if (building && placing) {
      const at = placing === true ? deployPoint(cursor, step, height) : placing
      const b = drawnRegion(at, origin, height, scaleExp, axes, MAX_CELLS)
      if (b) out.push({ key: 'placing', centre: b.centre, size: b.size })
    }
    return out
  }, [mine, me, building, plane, anchor, scaleExp, axes, placing, cursor, step, height])

  if (boxes.length === 0) return null
  return (
    <group>
      {boxes.map((b) => (
        <lineSegments key={b.key} geometry={geometry} position={b.centre} scale={b.size} frustumCulled={false} renderOrder={9}>
          <lineBasicMaterial color={ROOM_RED} toneMapped={false} transparent opacity={0.95} depthTest={false} />
        </lineSegments>
      ))}
    </group>
  )
}
