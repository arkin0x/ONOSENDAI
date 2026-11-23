/**
 * stampTap.ts: a tap on the bench with STAMP's OBJECT (owner, 2026-11-23):
 * COPY or LINK the chosen shard where the ghost stands, refused in plain
 * words when it would leave the shard past what one hidden object holds
 * (lib/shardFullness.ts), and where the tap lands when SNAP TO ITS SIZE is on.
 *
 * Here rather than in the store: the size check reads the hidden object's
 * envelope (lib/hidden.ts), which the workshop's store does not load. The
 * store applies what this works out as one undoable edit (commitStamp).
 */

import { MAX_EXTENT, toPayload, validPoint, type ShardModel } from 'sno-core/shards'
import { stampRefusal } from '../lib/shardFullness'
import { snapToSize, stampedShard, stampSize, type StampedRange } from '../lib/stampCopy'
import { withAuthoredConstrain } from '../lib/walkConstrain'
import { useWorkshop } from '../store/useWorkshop'

type P3 = [number, number, number]

/** A shard's payload in UTF-8 bytes, as the hide writes it. */
export const payloadBytes = (s: ShardModel): number => new TextEncoder().encode(JSON.stringify(toPayload(withAuthoredConstrain(s)))).length

const plural = (n: number, one: string): string => `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`

/**
 * Stamp the chosen object at `at` as STAMP's form says. `self` is this
 * shard's own address, which a LINK must never place. The range of what a
 * COPY made (lib/stampCopy.ts StampedRange; also the store's `lastCopy`), or
 * null when nothing was stamped (the reason is on the notice line) or for a
 * LINK.
 */
export function stampTap(at: P3, self?: string): StampedRange | null {
  const w = useWorkshop.getState()
  const s = w.current()
  const object = w.stampObject
  const say = (notice: string): null => { useWorkshop.setState({ notice }); return null }
  if (!s) return null
  if (!object) return say('Choose a shard to stamp first: tap the slot under OBJECT.')
  // A tap snapped to the object's size can land a little past this grid's edge: COPY grows the grid, as far as any grid goes.
  if (!validPoint(at, MAX_EXTENT)) return say('Not stamped: that is past the edge of the grid.')
  const form = w.stampForm
  if (form === 'link' && self && object.ref[1] === self) return say('An object cannot place itself.')
  const r = stampedShard(s, { ref: object.ref, copy: object.copy ?? null }, form, at, w.stampFacing)
  if (!r.ok) return say(r.why)
  const why = stampRefusal(payloadBytes(s), payloadBytes(r.shard))
  if (why) return say(why)
  if (form === 'link') {
    w.commitStamp(r.shard, null, `"${object.name}" placed. It is one object: SELECT it to move, turn or copy it.`)
    return null
  }
  const points = r.added.vertices[1] - r.added.vertices[0]
  const faces = r.added.faces[1] - r.added.faces[0]
  const extra = [
    r.snapped > 0 ? `${plural(r.snapped, 'color')} had no room in the palette and took the nearest.` : '',
    object.copy && object.copy.rounded > 0 ? `${plural(object.copy.rounded, 'point')} between grid ticks moved to the nearest.` : '',
  ].filter(Boolean).join(' ')
  return w.commitStamp(r.shard, r.added, `"${object.name}" copied in: ${plural(points, 'point')} and ${plural(faces, 'face')}, yours to edit.${extra ? ` ${extra}` : ''}`)
}

/**
 * Where a tap at `raw` (ticks, unrounded) lands with SNAP TO ITS SIZE: on the
 * object's own size along the working plane. Null when snapping does not
 * apply (not OBJECT, snap off, nothing chosen, or a chosen shard with no
 * size), and the grid's own snap is used.
 */
export function stampAim(raw: P3): P3 | null {
  const w = useWorkshop.getState()
  if (w.tool !== 'stamp' || w.stampMode !== 'object' || !w.stampSnap || !w.stampObject?.size) return null
  const s = w.current()
  if (!s) return null
  const size = stampSize(w.stampObject.size, w.stampFacing, s.unit)
  if (!size) return null
  return snapToSize(raw, w.level, w.plane, size, w.step())
}
