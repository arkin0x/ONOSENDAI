/**
 * ItemThumb.tsx - the one picture a row of ITEMS starts with, KEY ITEMS and
 * OTHER LOOT alike, in the chamfered frame at the Shard Feed's size (owner,
 * 2026-11-15: "I dont like that it is a different sized picture than the
 * items. Make all pictures/icons the size of the shard sizes").
 *
 * - A shard shows its rendered picture (ShardThumb), and so does anything
 *   handed one (a seed's bloom as grown, in DISCOVERED NEARBY).
 * - A key item that wears a model (lib/itemModel.ts) shows the model's
 *   picture once it has arrived; until then, and when it cannot, its own
 *   picture if it has one, else its icon.
 * - A key item with its own picture and no model shows that picture, pixel
 *   art, filling the frame.
 * - Everything else (a message, a coin, DNA, a sound, a seed, a chest) shows
 *   its kind's lucide icon, large and centred, in its kind's colour.
 */

import { useEffect, useRef, useState } from 'react'
import type { ShardModel } from 'sno-core/shards'
import type { HiddenType } from '../lib/hidden'
import type { ItemModelRef } from '../lib/itemModel'
import { isPictureUri } from '../lib/itemPicture'
import { useItemModel } from '../hooks/useItemModel'
import { ItemIcon } from './ItemIcon'
import { ShardThumb, scrollRootOf, watchNear } from './ShardThumb'
import { Chamfer, THUMB_PX } from './ui/Chamfer'

/** How big a kind's icon is drawn inside the frame: big enough to read as the picture, with air around it. */
export const THUMB_ICON_PX = 36

interface Props {
  type: HiddenType
  /** For a message: whether it carries a Cashu token, which is the coin. */
  coin?: boolean
  shard?: ShardModel | null
  image?: string
  model?: ItemModelRef | null
  /** The frame's side in CSS pixels: THUMB_PX, but for a chest's contents squeezed into a narrow column (ItemRows CHEST_INLINE_PX). */
  size?: number
  /**
   * Ask for a key item's model only once the frame comes near the visible
   * part of the box it scrolls in, as a shard's picture is asked for
   * (ShardThumb): the ITEMS grids sit in the menu, which opens often, and a
   * model no relay has is asked for again by every mount.
   */
  lazy?: boolean
}

function ModelThumb({ model, size, fallback }: { model: ItemModelRef; size: number; fallback: JSX.Element }): JSX.Element {
  const loaded = useItemModel(model)
  return loaded ? <ShardThumb shard={loaded.shard} size={size} /> : fallback
}

/** The model's picture once the frame has come near the visible part of its box; the fallback until then. Once near, it stays asked for. */
function NearModelThumb({ model, size, fallback }: { model: ItemModelRef; size: number; fallback: JSX.Element }): JSX.Element {
  const box = useRef<HTMLSpanElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return }
    return watchNear(el, scrollRootOf(el), (n) => { if (n) setNear(true) })
  }, [near])
  if (near) return <ModelThumb model={model} size={size} fallback={fallback} />
  return <span ref={box} className="itemthumb__wait">{fallback}</span>
}

export function ItemThumb({ type, coin = false, shard, image, model, size = THUMB_PX, lazy = false }: Props): JSX.Element {
  const kind = coin ? 'cashu' : type
  const icon = <ItemIcon className={`itemthumb__icon itemthumb__icon--${kind}`} type={type} coin={coin} size={Math.round(size * (THUMB_ICON_PX / THUMB_PX))} strokeWidth={1.75} />
  const own = image && isPictureUri(image) ? <img className="itemthumb__pic" src={image} alt="" width={size} height={size} draggable={false} /> : null
  const inner = shard
    ? <ShardThumb shard={shard} size={size} />
    : model
      ? lazy ? <NearModelThumb model={model} size={size} fallback={own ?? icon} /> : <ModelThumb model={model} size={size} fallback={own ?? icon} />
      : own ?? icon
  return <Chamfer className="itemthumb" size={size}>{inner}</Chamfer>
}
