/**
 * deleteWords.ts: the words on the card that guards DELETE and REMOVE FROM
 * CHEST in the shard modal (arkinox, 2026-10-10: "we need a confirmation
 * step").
 *
 * Pure, so the sentences can be read in a test without a modal: what the
 * thing is called, and what deleting it or taking it out of a chest really
 * does, as useShards deleteInstance and removeFromChest do it. Two lines at
 * most: the button's tooltip carries the rest.
 */

import type { WorldItem } from '../store/useShards'
import { textWithoutToken } from './cashu'

/** What the card says: a question for its title, then the short lines under it. */
export interface ConfirmWords {
  title: string
  lines: string[]
}

/** The thing the words are about: its kind and whatever names it. */
export type NamedItem = Pick<WorldItem, 'type' | 'shard' | 'text' | 'keyItem' | 'chest'>

/** How much of a message names it. */
export const MESSAGE_NAME_CHARS = 40

/**
 * The first words of a message, on one line, cut at MESSAGE_NAME_CHARS with
 * an ellipsis. A Cashu token is not words, so it is left out, and a message
 * that was nothing but a token has no name at all.
 */
export function messageName(text: string | null | undefined): string {
  const words = textWithoutToken(text).replace(/\s+/g, ' ').trim()
  if (words.length <= MESSAGE_NAME_CHARS) return words
  return `${words.slice(0, MESSAGE_NAME_CHARS).trimEnd()}…`
}

/**
 * "the shard Giraffe", "the message “Hello…”", "the key Door", "the chest
 * Door"; "this shard" and so on when nothing names it.
 */
export function itemLabel(item: NamedItem): string {
  const name = item.type === 'message'
    ? messageName(item.text)
    : item.type === 'key' ? item.keyItem?.name ?? '' : item.type === 'chest' ? item.chest?.name ?? '' : item.shard?.name ?? ''
  if (!name) return `this ${item.type}`
  return item.type === 'message' ? `the message “${name}”` : `the ${item.type} ${name}`
}

/** The card behind DELETE, as deleteInstance works. */
export function deleteWords(item: NamedItem): ConfirmWords {
  return {
    title: `Delete ${itemLabel(item)}?`,
    lines: [
      'The bag in this region is rewritten without it, or deleted when this was the last thing of yours there.',
      'Copies others already took stay with them. This cannot be undone.',
    ],
  }
}

/** The card behind REMOVE FROM CHEST, as removeFromChest works; the chest is named when it is known. */
export function removeWords(item: NamedItem, chestName: string | null | undefined): ConfirmWords {
  return {
    title: `Take ${itemLabel(item)} out of ${chestName ? `the chest ${chestName}` : 'its chest'}?`,
    lines: [
      'The chest is sealed again without it; the chest and everything else in it stay.',
      'Copies others already took stay with them.',
    ],
  }
}
