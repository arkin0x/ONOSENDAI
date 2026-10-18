/**
 * TvSegments.tsx: Cyberspace TV's segments, for what happened on the tape
 * besides moves (arkinox, 2026-10-18).
 *
 * - A bag sealed somewhere no public hint names plays in an inset, on a cube
 *   that stands for it and nowhere: outlines, then sides, a key stamped on
 *   each side, the sides fading, LOCATION SECRET. A bag whose hint box is
 *   public plays in the world instead (scene/TvBoxes).
 * - An object published: an advertisement, NOW AVAILABLE!, the object
 *   turning, its name and who made it ("lets add the tv events for when new
 *   SNO objects are published publicly with a 'now available!' splash so it
 *   looks like an advertisement").
 * - A new avatar: the product shot, NEW LOOK, the owner's name.
 * - A comment: the news desk, the commenter as a photograph and the quote
 *   printing out. A comment on a move is public and prints as written; one
 *   on a bag is sealed to the bag's region and prints as redaction, which is
 *   what a viewer who has not found the bag can know of it.
 *
 * The panels are painted into the tube (scene/tvPainter.ts). What is here is
 * what they say, and the turning shard they show: rendered off screen by
 * TvSpinHost, for the painter to copy each frame.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useAvatarShard } from '../store/useAvatars'
import { placeable, useTv } from '../store/useTv'
import { objectsOf } from '../workshop/ObjectPicker'
import { avatarFromEvent } from '../lib/avatar'
import { QUOTE_MAX, type TapeItem } from '../lib/tv/director'
import { ShardSpin } from '../scene/ShardSpin'

/** How long a cut's transition takes, ms (scene/TvScreenEffect): a segment's clock starts after it. */
export const CUT_MS = 700

/** Seconds per character as a quote prints, at most, and how long before it starts. */
export const TYPE_S = 0.045
export const TYPE_DELAY_S = 0.8
/** A printed quote is finished this long before its shot ends, so its last words are read. */
const TYPE_DONE_BEFORE_S = 1.5

/**
 * A sealed comment's place in the quote: blocks the length of words, as a
 * censor's pen leaves them, the same every time for the same comment.
 */
export function redaction(id: string, length = 64): string {
  let out = ''
  let i = 0
  while (out.length < length) {
    const n = 2 + (parseInt(id.slice((i * 2) % 60, (i * 2) % 60 + 2), 16) % 8)
    out += `${'█'.repeat(n)} `
    i++
  }
  return out.trim()
}

/** What a quote prints: its words, cut at QUOTE_MAX, or the redaction standing in for them. */
export function quoteOf(item: Extract<TapeItem, { kind: 'comment' }>): string {
  if (item.text === null) return redaction(item.id)
  const chars = Array.from(item.text)
  return chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX).join('').trimEnd()}…` : item.text
}

/** Seconds per character for a quote: TYPE_S, or faster, so it finishes TYPE_DONE_BEFORE_S before its shot ends. */
export function typePace(chars: number, shotLength: number): number {
  const room = shotLength - CUT_MS / 1000 - TYPE_DELAY_S - TYPE_DONE_BEFORE_S
  return Math.min(TYPE_S, Math.max(0.005, room / Math.max(1, chars)))
}

/** What the chiron says a segment's author did. */
export function segmentDoing(item: TapeItem): string {
  if (item.kind === 'bag') return placeable(item.hint) ? 'SEALED A BAG · HINT BOX PUBLIC' : 'SEALED A BAG'
  if (item.kind === 'object') return 'PUBLISHED AN OBJECT'
  if (item.kind === 'avatar') return 'NEW AVATAR'
  if (item.kind === 'reaction') return 'REACTED'
  return item.on === 'bag' ? 'COMMENTED ON A BAG' : 'COMMENTED ON A MOVE'
}

/** The canvas the segment's turning shard is drawn in, for the painter; null when there is none. */
export const tvSpin: { canvas: HTMLCanvasElement | null } = { canvas: null }

/** The size the turning shard is rendered at, CSS px: copied, scaled, into the panel. */
const SPIN_PX = 256

/**
 * The segment's shard, turning, off screen: an object's, a new avatar's, or a
 * commenter's own avatar. Its canvas keeps its last frame (preserve) so the
 * painter can copy it whenever it paints.
 */
export function TvSpinHost(): JSX.Element | null {
  const item = useTv((s) => s.shot?.item)
  const commenter = item?.kind === 'comment' ? item.pubkey : ''
  const avatar = useAvatarShard(commenter)
  const shard = useMemo(() => {
    if (item?.kind === 'object') return objectsOf([item.event])[0]?.shard ?? null
    if (item?.kind === 'avatar') return avatarFromEvent(item.event)
    if (item?.kind === 'comment') return avatar
    return null
  }, [item, avatar])
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!shard) { tvSpin.canvas = null; return }
    // The canvas appears once the spin has mounted its renderer.
    const find = window.setInterval(() => {
      const c = host.current?.querySelector('canvas') ?? null
      if (c) { tvSpin.canvas = c; window.clearInterval(find) }
    }, 50)
    return () => { window.clearInterval(find); tvSpin.canvas = null }
  }, [shard])
  if (!shard) return null
  return (
    <div ref={host} className="tv__spinhost" aria-hidden="true">
      <ShardSpin key={item?.id} shard={shard} size={SPIN_PX} preserve />
    </div>
  )
}
