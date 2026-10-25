/**
 * ShardThumb.tsx: a shard's picture in a row, wherever shards are listed
 * (2026-10-23).
 *
 * The one component every list puts beside a shard's name: the workshop's
 * SHARDS, PLACE OBJECT's MINE, the Shard Feed, a bag's contents, a chest's
 * contents and what was taken from one, what was found nearby. It is an
 * <img> of a picture drawn once by the one hidden canvas (scene/ThumbStage)
 * and kept (store/useThumbs, lib/thumbDb), under the shape's own hash
 * (lib/thumbKey), so an edit asks for a new picture and a rename does not.
 *
 * The picture is asked for once the row is within NEAR_PX of the visible
 * part of the box it scrolls in, and given back if the row leaves before its
 * turn. The box is found once, as the row mounts: the nearest ancestor that
 * scrolls. Against the page's viewport a margin does nothing for a row
 * inside a scrolling box (the feed found that out). One IntersectionObserver
 * serves every row in a box.
 *
 * While it waits the row shows a quiet square; an object with nothing in it,
 * a picture that could not be drawn, or a browser without WebGL shows the
 * shard's icon.
 */

import { useEffect, useRef, useState } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { useThumbs } from '../store/useThumbs'
import { thumbKeyOf } from '../lib/thumbKey'
import { ownThumbKey } from '../store/localObjects'
import { ItemIcon } from './ItemIcon'

/** How far outside the visible part of its box a row asks for its picture. */
export const NEAR_PX = 200
/** How long an edited shape stays still before its picture is asked for again: a drag in the workshop draws once, at the end. */
export const SETTLE_MS = 300

/** The nearest ancestor of `el` that scrolls, or null for the page. */
export function scrollRootOf(el: Element): Element | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (/(auto|scroll|overlay)/.test(`${s.overflowY} ${s.overflowX}`)) return p
  }
  return null
}

type Seen = (near: boolean) => void
const observers = new Map<Element | null, { io: IntersectionObserver; rows: Map<Element, Seen> }>()

/** Calls `seen` with whether `el` is near the visible part of `root`; the stop. One observer per root. */
export function watchNear(el: Element, root: Element | null, seen: Seen): () => void {
  let o = observers.get(root)
  if (!o) {
    const rows = new Map<Element, Seen>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) rows.get(e.target)?.(e.isIntersecting)
    }, { root, rootMargin: `${NEAR_PX}px` })
    o = { io, rows }
    observers.set(root, o)
  }
  o.rows.set(el, seen)
  o.io.observe(el)
  const mine = o
  return () => {
    mine.io.unobserve(el)
    mine.rows.delete(el)
    if (mine.rows.size === 0) { mine.io.disconnect(); observers.delete(root) }
  }
}

/** Whether a shard has anything to draw: its own vertices, or objects it places. */
export function drawable(shard: ShardModel): boolean {
  return shard.vertices.length > 0 || (shard.parts?.length ?? 0) > 0
}

interface Props {
  shard: ShardModel
  /** Width and height in CSS pixels. The picture is 160 pixels, sharp up to 80 on a phone's screen. */
  size?: number
  className?: string
  /**
   * An authoring view's picture of a shard of yours: your own pieces are
   * drawn from your workshop, published or not (lib/parts.ts fetchOwnFirst).
   * Everywhere else, as in the world, only what the relays hold.
   */
  own?: boolean
}

export function ShardThumb({ shard, size = 36, className, own = false }: Props): JSX.Element {
  const key = own ? ownThumbKey(shard) : thumbKeyOf(shard)
  const can = drawable(shard)
  const url = useThumbs((s) => s.urls[key])
  // The last picture of this shard: an edited shape keeps it until its new
  // one is drawn, rather than blinking to the wait. Only the same shard's: a
  // row keyed by place can be handed another shard.
  const last = useRef<{ id: string; url: string } | null>(null)
  if (url) last.current = { id: shard.id, url }
  const shown = url ?? (last.current?.id === shard.id ? last.current.url : undefined)
  const icon = useThumbs((s) => !can || s.disabled || !!s.failed[key])
  const box = useRef<HTMLSpanElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el || !can) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    return watchNear(el, scrollRootOf(el), setNear)
  }, [can])

  // Wanted while near, and only once the shape has been still a moment; given back when it leaves or changes.
  useEffect(() => {
    if (!near || !can || url) return
    let asked = false
    const t = window.setTimeout(() => { asked = true; useThumbs.getState().want(key, shard, own) }, SETTLE_MS)
    return () => {
      window.clearTimeout(t)
      if (asked) useThumbs.getState().unwant(key)
    }
  }, [near, can, url, key, shard, own])

  return (
    <span ref={box} className={className ? `shardthumb ${className}` : 'shardthumb'} style={{ width: size, height: size }} aria-hidden="true">
      {icon && !url
        ? <ItemIcon type="shard" size={Math.max(12, Math.round(size * 0.4))} />
        : shown
          ? <img src={shown} alt="" width={size} height={size} draggable={false} />
          : <span className="shardthumb__wait" />}
    </span>
  )
}
