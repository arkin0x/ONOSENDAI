/**
 * notifications.ts: what someone did that concerns you, read from the events
 * that tag you (arkinox, 2026-09-28).
 *
 * Two kinds reach you: a reaction (kind 7) and a comment (kind 1111), each
 * `p`-tagging you. Each is classified by what it answers, which is what the
 * notification's VIEW button goes to:
 *
 * | Answers | How it is told | VIEW |
 * |---|---|---|
 * | a chain action (kind 3333) | reaction `k` 3333, or comment root `K` 3333 | the action's modal |
 * | a hidden item (a shard or message in a bag) | reaction `k` 3330 / 1 / 33331, or comment root `K` 33330 | that deployment |
 * | a comment of yours | reaction `k` 1111, or comment parent `k` 1111 | whatever that comment answers |
 *
 * Comments on hidden items are sealed to the place (comments.ts); the store
 * opens the ones on your own bags, and the rest say only that a sealed
 * comment arrived.
 */

import { COMMENT_KIND, parseComment } from './comments'
import type { NostrEvent } from './events'
import { HIDDEN_KIND, MESSAGE_KIND, SHARD_KIND } from './hidden'
import { ACTION_KIND, REACTION_KIND, parseReaction } from './social'

/** An object hidden by reference is its own addressable event (spec §7.6). */
const OBJECT_KIND = 33331

export type NotifOn =
  | { type: 'action'; id: string }
  | { type: 'item'; id: string; lookupId?: string }
  | { type: 'comment'; id: string }

export interface Notification {
  id: string
  from: string
  createdAt: number
  what: 'reaction' | 'comment'
  /** The reaction as written, or the comment's words (the placeholder while sealed). */
  content: string
  /** A NIP-30 custom emoji's image. */
  image?: string
  /** A comment whose words are sealed to a place. */
  sealed: boolean
  /** The sealed words, to be opened with the bag's region key. */
  ciphertext: string | null
  /** The bag a sealed comment belongs to, `33330:<author>:<lookup id>`. */
  bag: string | null
  on: NotifOn
}

function kindOn(kind: number | null, id: string, lookupId?: string): NotifOn | null {
  if (kind === ACTION_KIND) return { type: 'action', id }
  if (kind === COMMENT_KIND) return { type: 'comment', id }
  if (kind === SHARD_KIND || kind === MESSAGE_KIND || kind === OBJECT_KIND) return { type: 'item', id, lookupId }
  return null
}

/** One event as a notification for `me`, or null when it is not one this app can place. */
export function toNotification(ev: NostrEvent, me: string): Notification | null {
  if (ev.pubkey === me) return null
  if (!ev.tags.some((t) => t[0] === 'p' && t[1] === me)) return null

  if (ev.kind === REACTION_KIND) {
    const r = parseReaction(ev)
    if (!r) return null
    const on = kindOn(r.targetKind, r.targetId)
    if (!on) return null
    return { id: ev.id, from: ev.pubkey, createdAt: ev.created_at, what: 'reaction', content: r.content, image: r.image, sealed: false, ciphertext: null, bag: null, on }
  }

  if (ev.kind === COMMENT_KIND) {
    const c = parseComment(ev)
    if (!c) return null
    const rootKind = Number(ev.tags.find((t) => t[0] === 'K')?.[1])
    const bag = rootKind === HIDDEN_KIND ? c.rootAddress : null
    const lookupId = bag?.split(':')[2]
    // A reply answers a comment; a top-level comment answers the thing itself.
    const on = c.parentKind === COMMENT_KIND
      ? { type: 'comment' as const, id: c.parentId }
      : rootKind === ACTION_KIND ? { type: 'action' as const, id: c.rootAddress } : kindOn(c.parentKind, c.parentId, lookupId)
    if (!on) return null
    return { id: ev.id, from: ev.pubkey, createdAt: ev.created_at, what: 'comment', content: c.preview, sealed: c.ciphertext !== null, ciphertext: c.ciphertext, bag, on }
  }
  return null
}

/** Newest first, one per id. */
export function mergeNotifications(a: Notification[], b: Notification[]): Notification[] {
  const byId = new Map<string, Notification>()
  for (const n of [...a, ...b]) if (!byId.has(n.id)) byId.set(n.id, n)
  return [...byId.values()].sort((x, y) => y.createdAt - x.createdAt || x.id.localeCompare(y.id))
}

/** How many arrived after you last looked. */
export function unreadCount(list: Notification[], lastSeen: number): number {
  return list.filter((n) => n.createdAt > lastSeen).length
}
