/**
 * itemMark.ts - item blueprints wear an orange mark (owner, 2026-11-27: "can
 * we mark a blueprint with a special colored mark to designate it as an item
 * blueprint?"). An item blueprint is one whose prize is an item or a tool
 * (today the game's Compiler blueprint; later key items, maybe) rather than a
 * shard. Driven by the prize's kind, never a name, so a new item blueprint
 * gets the mark by itself. A found card's prize is sealed until it is built,
 * so only what this device knows can be marked: the game's own, and your own.
 */

import type { BlueprintCard } from './blueprintDb'

/** The Compiler's orange: its ring glows (compilerBreaker.sno.json, built-in palette 117), Rustband's edge too. */
export const ITEM_ORANGE = '#f47000'

/** Whether a card is an item blueprint, by its prize's kind (a tool or an item). */
export function isItemBlueprint(card: Pick<BlueprintCard, 'prizeKind' | 'source'>): boolean {
  return card.prizeKind === 'tool' || card.prizeKind === 'item' || card.source === 'game'
}

/** Whether a prize is an item (not a shard): for prizes already opened, as the smash's reveal shows them. */
export function isItemPrize(prize: { type: string }): boolean {
  return prize.type === 'tool' || prize.type === 'item'
}
