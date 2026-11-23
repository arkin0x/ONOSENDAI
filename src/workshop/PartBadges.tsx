/**
 * PartBadges.tsx: the LINK or COPY mark (PartFormBadge) in a corner of every
 * object the shard on the bench places (owner, 2026-11-22): green for a link
 * to a public object, orange for a copy carried with what you hide
 * (lib/partForm.ts, the rule the hide itself follows).
 *
 * Each mark stands on the top corner of its object's box, in the object's own
 * placement, so it moves and turns with it, and is drawn over the canvas as a
 * page element, the same size whatever the zoom. It never takes a tap: the
 * object under it does. A shard placing very many objects (a floor of tiles)
 * shows none, rather than a field of marks hiding what they mark.
 */

import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { placedBounds, refKey, type Placed } from 'sno-core/parts'
import type { ShardModel } from 'sno-core/shards'
import { useResolved } from '../lib/parts'
import type { PartForm } from '../lib/partForm'
import { hiddenIn, useWorkshop } from '../store/useWorkshop'
import { hiddenSets } from '../lib/shardGroups'
import { isLook } from './lookTool'

const NO_KEYS: string[] = []
import { PartFormBadge } from './PartFormBadge'
import { usePartForms } from './partForms'

/** Past this many placements, no marks: a floor of tiles would be all marks, and each is a page element moved every frame. */
export const MAX_BADGES = 32

/** Where each placed object's mark stands, in the bench's render units, and what it is. */
export function badgeSpots(shard: ShardModel, resolved: ReadonlyMap<string, { model: ShardModel | null; children: Placed['children'] }>, form: (refIndex: number) => PartForm): Array<{ index: number; at: [number, number, number]; form: PartForm }> {
  const parts = shard.parts ?? []
  if (parts.length === 0 || parts.length > MAX_BADGES) return []
  const bare: ShardModel = { ...shard, vertices: [], faces: [] }
  const out: Array<{ index: number; at: [number, number, number]; form: PartForm }> = []
  parts.forEach((part, index) => {
    const ref = shard.refs?.[part.ref]
    if (!ref) return
    const r = resolved.get(refKey(ref))
    const b = placedBounds(bare, [{ part, ref, model: r?.model ?? null, children: r?.children ?? [] }])
    if (!b) return
    // The top corner nearest the default view (+X, +Y, toward the camera's +Z).
    out.push({ index, at: [b.max[0], b.max[1], b.max[2]], form: form(part.ref) })
  })
  return out
}

export function PartBadges(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const resolved = useResolved(shard ?? null)
  const form = usePartForms(shard)
  // Not on a placed object a hidden group hides (GROUPS' HIDE).
  const hiddenKeys = useWorkshop((s) => (isLook(s.tool) ? NO_KEYS : s.hiddenGroups))
  const spots = useMemo(() => {
    if (!shard) return []
    const gone = hiddenSets(shard, hiddenIn(hiddenKeys, shard))?.parts
    const all = badgeSpots(shard, resolved, form)
    return gone?.size ? all.filter((b) => !gone.has(b.index)) : all
  }, [shard, resolved, form, hiddenKeys])
  if (spots.length === 0) return null
  return (
    <>
      {spots.map((s) => (
        <Html key={s.index} position={s.at} zIndexRange={[4, 0]} pointerEvents="none">
          <div className="partform-pin"><PartFormBadge form={s.form} /></div>
        </Html>
      ))}
    </>
  )
}
