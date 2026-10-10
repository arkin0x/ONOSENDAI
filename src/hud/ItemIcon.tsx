/**
 * ItemIcon.tsx: the one icon each kind of hidden thing wears in the HUD.
 *
 * Until 2026-10-10 a kind was drawn two ways. Every row and badge used a text
 * glyph from lib/hidden's hiddenGlyph (a diamond for a shard, a pencil for a
 * message, a Bitcoin sign for a coin, a key, a square for a chest), and the
 * Stash's four composer buttons used lucide icons, so one menu showed two
 * key icons and two message icons at once (arkinox, 2026-10-10, from a
 * screenshot: "Update it everywhere with the lucide pyramid icon. Replace the
 * message icon likewise with lucide scroll-text. I like the key icon in the
 * button better. Use that everywhere for keys."). Now a kind has one lucide
 * icon, named here and nowhere else: Pyramid, ScrollText, Bitcoin, KeyRound
 * and Vault are imported from lucide-react only by this file, and
 * __tests__/itemIcon.test.ts reads the sources under src/hud to keep it so.
 *
 * The scene is not the HUD: WorldMessages and ShardGhost draw their labels
 * as text into canvas textures, where an SVG has no place, so they keep
 * their text glyphs.
 *
 * The icon is decoration beside a label, never the label itself, so it is
 * aria-hidden and takes the text's color through currentColor. The size
 * matches the type beside it. The stroke is 2.25, which reads at 11 to 14px;
 * a caller beside an icon drawn heavier (the Stash buttons' Rss and Wrench
 * at 2.5) passes that instead.
 */

import { Bitcoin, KeyRound, Pyramid, ScrollText, Vault, type LucideIcon } from 'lucide-react'
import type { HiddenType } from '../lib/hidden'

/** A kind as a row shows it: a message that carries a Cashu token is a coin, apart from a message. */
export interface ItemKind {
  type: HiddenType
  coin: boolean
}

/** The lucide icon for a kind of hidden thing. A message with a Cashu token in it is the coin. */
export function itemIconOf(type: HiddenType, coin = false): LucideIcon {
  if (type === 'message') return coin ? Bitcoin : ScrollText
  if (type === 'key') return KeyRound
  if (type === 'chest') return Vault
  return Pyramid
}

/**
 * Each kind in a list of items once, in the order first seen: what a bag row
 * shows of its contents. One icon per kind, not one per item, because icons
 * are wider than the glyphs were and the item count is on the row already.
 */
export function distinctKinds(items: readonly ItemKind[]): ItemKind[] {
  const out: ItemKind[] = []
  for (const it of items) {
    const coin = it.type === 'message' && it.coin
    if (!out.some((k) => k.type === it.type && k.coin === coin)) out.push({ type: it.type, coin })
  }
  return out
}

interface Props {
  type: HiddenType
  /** For a message: whether it carries a Cashu token, which draws the coin instead. */
  coin?: boolean
  /** Width and height, in CSS pixels. */
  size?: number
  strokeWidth?: number
  /** Added after `item-icon`, for the color the row gives its mark. */
  className?: string
}

export function ItemIcon({ type, coin = false, size = 13, strokeWidth = 2.25, className }: Props): JSX.Element {
  const Icon = itemIconOf(type, coin)
  return <Icon className={className ? `item-icon ${className}` : 'item-icon'} size={size} strokeWidth={strokeWidth} aria-hidden />
}
