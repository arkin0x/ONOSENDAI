/**
 * ItemsGrid.tsx: the pictures under an ITEMS button (owner, 2026-11-26: "the
 * number showing the amount of each kind of item isn't sufficient to see if
 * i have anything new or what i even have. maybe we show item images on a
 * grid under these buttons, side by side ... left side is loot").
 *
 * One grid per kind, under its own button: the newest held first, each in
 * the chamfered frame the rows use (ItemThumb), small enough that three sit
 * across half the panel. Always two rows of three tiles, filled or blank, so
 * the panel never changes height as items arrive. When there are more than
 * fit, the last tile says how many more and opens the list. An item not
 * looked at yet wears NEW (lib/itemsSeen.ts) until its card or its list is
 * opened. An empty grid says so in a quiet line over its blank tiles.
 *
 * Pictures cost what the rows' pictures cost and no more: a shard's comes
 * from the same cache under the same key (ShardThumb, store/useThumbs) and is
 * only asked for while the grid is near the visible part of the menu; a key
 * item's model likewise (ItemThumb lazy), through the one model cache
 * (useItemModel).
 */

import { useMemo } from 'react'
import { cashuLabel, readCashuToken } from '../lib/cashu'
import type { HeldItem } from '../lib/inventory'
import { GRID_SLOTS, gridOf, isNewItem, type ItemsKind } from '../lib/itemsSeen'
import { useInventory } from '../store/useInventory'
import { useItemsSeen } from '../store/useItemsSeen'
import { ItemThumb } from './ItemThumb'
import { Chamfer } from './ui/Chamfer'

/** A tile's picture side in CSS pixels; the stylesheet stretches it to a third of the column, which is about this. */
export const TILE_PX = 48
/** The mark on an item not looked at yet. */
export const NEW_MARK = 'NEW'

/** What a tile is called: a coin by its amount, as its row names it; everything else by its name. */
export function tileName(item: Pick<HeldItem, 'type' | 'text' | 'name'>): { name: string; coin: boolean } {
  if (item.type !== 'message') return { name: item.name, coin: false }
  const { raw, token } = readCashuToken(item.text ?? null)
  if (raw === null) return { name: item.name, coin: false }
  return { name: token ? cashuLabel(token) : 'cashu token', coin: true }
}

function ItemTile({ item, fresh, onOpen }: { item: HeldItem; fresh: boolean; onOpen: (item: HeldItem) => void }): JSX.Element {
  const { name, coin } = useMemo(() => tileName(item), [item])
  return (
    <button type="button" className={`items-tile${fresh ? ' is-new' : ''}`} data-tile={item.id} onClick={() => onOpen(item)} title={name} aria-label={fresh ? `${name}, new` : name}>
      {item.type === 'key'
        ? <ItemThumb type="key" image={item.key?.image} model={item.key?.model} size={TILE_PX} lazy />
        : <ItemThumb type={item.type} coin={coin} shard={item.type === 'shard' ? item.shard : undefined} size={TILE_PX} />}
      {fresh && <span className="items-tile__new" aria-hidden="true">{NEW_MARK}</span>}
    </button>
  )
}

interface Props {
  kind: ItemsKind
  /** This kind's items, newest first, as its list has them. */
  items: HeldItem[]
  /** The quiet line when there are none. */
  empty: string
  /** A tile was tapped. */
  onOpen: (item: HeldItem) => void
  /** The "+N more" tile was tapped: open the list. */
  onMore: () => void
}

export function ItemsGrid({ kind, items, empty, onOpen, onMore }: Props): JSX.Element {
  const holder = useInventory((s) => s.owner)
  // Still reading what this identity holds: blank slots, not "nothing yet".
  const loading = useInventory((s) => s.storage === 'loading')
  // No NEW mark until this identity's record has been read, so a seen item never blinks NEW.
  const seen = useItemsSeen((s) => (s.ready && s.owner === holder ? s.seen : null))
  const { shown, more, empty: blanks } = gridOf(items, GRID_SLOTS)
  const what = kind === 'keys' ? 'key items' : 'other loot'
  // A NEW item behind "+N more" says so on that tile, so nothing new is hidden.
  const newBehind = more > 0 && !!seen && items.slice(shown.length).some((it) => isNewItem(seen, it))
  return (
    <div className={`items-grid items-grid--${kind}${items.length === 0 ? ' is-empty' : ''}`} role="group" aria-label={`Your newest ${what}`} data-grid={kind}>
      {shown.map((it) => <ItemTile key={it.id} item={it} fresh={!!seen && isNewItem(seen, it)} onOpen={onOpen} />)}
      {more > 0 && (
        <button type="button" className={`items-tile items-tile--more${newBehind ? ' is-new' : ''}`} data-tile="more" onClick={onMore} title={`Open ${what.toUpperCase()}`} aria-label={`${more} more${newBehind ? ', some new' : ''}: open ${what}`}>
          <Chamfer size={TILE_PX}>
            <span className="items-tile__count">+{more}</span>
            <span className="items-tile__word">MORE</span>
          </Chamfer>
          {newBehind && <span className="items-tile__new" aria-hidden="true">{NEW_MARK}</span>}
        </button>
      )}
      {Array.from({ length: blanks }, (_, i) => (
        <span key={`blank-${i}`} className="items-tile items-tile--blank" aria-hidden="true">
          <Chamfer size={TILE_PX}><span className="items-tile__scan" /></Chamfer>
        </span>
      ))}
      {items.length === 0 && !loading && <p className="items-grid__empty">{empty}</p>}
    </div>
  )
}
