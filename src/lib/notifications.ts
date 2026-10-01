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
  /** Kept without proof that it is ONOSENDAI's (a target found nowhere): worded as a possibility. */
  guessed?: boolean
}

function kindOn(kind: number | null, id: string, lookupId?: string): NotifOn | null {
  if (kind === ACTION_KIND) return { type: 'action', id }
  if (kind === COMMENT_KIND) return { type: 'comment', id }
  if (kind === SHARD_KIND || kind === OBJECT_KIND) return { type: 'item', id, lookupId }
  return null
}

/** Comment threads that are ONOSENDAI's: a move's, or a bag's. */
function ourRoot(rootKind: number): boolean {
  return rootKind === ACTION_KIND || rootKind === HIDDEN_KIND
}

/** What this device already knows is yours, so no lookup is needed for it. */
export interface Known {
  /** Ids of the moves on your chain. */
  actions: ReadonlySet<string>
  /** Ids of the items you hid, with their bag's lookup id. */
  items: ReadonlyMap<string, string | undefined>
}

export const NOTHING_KNOWN: Known = { actions: new Set(), items: new Map() }

/**
 * A notification that may still need its target looked up before it can be
 * told from ordinary social traffic (arkinox, 2026-09-30: likes on plain notes
 * were showing as "reacted to your hidden item").
 *
 * - `kind1`: a reaction to a kind 1. A hidden message is a kind 1 that is
 *   never published on its own, so a target found on a relay is an ordinary
 *   note (dropped), and one found nowhere is kept as a possible hidden message.
 * - `comment`: a reaction to a kind 1111. Kept when that comment's thread is a
 *   move or a bag, dropped when it is some other app's thread, kept when the
 *   comment cannot be found.
 * - `unknown`: a reaction with no `k` tag, which many clients leave off.
 *   Classified by the target's real kind; kept as a possible hidden message
 *   when the target cannot be found.
 *
 * When in doubt a notification is kept, never dropped (arkinox: "err on the
 * side of bleedover notifications rather than missing something").
 */
export interface Candidate {
  n: Notification
  lookup: { id: string; rule: 'kind1' | 'comment' | 'unknown' } | null
}

/** Enough of a looked-up target to classify it. */
export interface Target { kind: number; tags: string[][] }

/** One event as a notification for `me`, pending a lookup when it cannot be placed on its own; null when it is not ONOSENDAI's. */
export function classify(ev: NostrEvent, me: string, known: Known = NOTHING_KNOWN): Candidate | null {
  if (ev.pubkey === me) return null
  if (!ev.tags.some((t) => t[0] === 'p' && t[1] === me)) return null

  if (ev.kind === REACTION_KIND) {
    const r = parseReaction(ev)
    if (!r) return null
    const base = { id: ev.id, from: ev.pubkey, createdAt: ev.created_at, what: 'reaction' as const, content: r.content, image: r.image, sealed: false, ciphertext: null, bag: null }
    const mineItem = known.items.has(r.targetId)
    const item: NotifOn = { type: 'item', id: r.targetId, lookupId: known.items.get(r.targetId) }
    if (known.actions.has(r.targetId)) return { n: { ...base, on: { type: 'action', id: r.targetId } }, lookup: null }
    if (mineItem) return { n: { ...base, on: item }, lookup: null }
    if (r.targetKind === MESSAGE_KIND) return { n: { ...base, on: item, guessed: true }, lookup: { id: r.targetId, rule: 'kind1' } }
    if (r.targetKind === COMMENT_KIND) return { n: { ...base, on: { type: 'comment', id: r.targetId } }, lookup: { id: r.targetId, rule: 'comment' } }
    if (r.targetKind === null) return { n: { ...base, on: item, guessed: true }, lookup: { id: r.targetId, rule: 'unknown' } }
    const on = kindOn(r.targetKind, r.targetId)
    return on ? { n: { ...base, on }, lookup: null } : null
  }

  if (ev.kind === COMMENT_KIND) {
    const c = parseComment(ev)
    if (!c) return null
    const rootKind = Number(ev.tags.find((t) => t[0] === 'K')?.[1])
    // Only a move's thread or a bag's is ONOSENDAI's; NIP-22 threads of any
    // other kind belong to other apps.
    if (!ourRoot(rootKind)) return null
    const bag = rootKind === HIDDEN_KIND ? c.rootAddress : null
    const lookupId = bag?.split(':')[2]
    // A reply answers a comment; a top-level comment answers the thing itself.
    const on: NotifOn | null = c.parentKind === COMMENT_KIND
      ? { type: 'comment', id: c.parentId }
      : rootKind === ACTION_KIND ? { type: 'action', id: c.rootAddress } : (kindOn(c.parentKind, c.parentId, lookupId) ?? { type: 'item', id: c.parentId, lookupId })
    if (!on) return null
    return { n: { id: ev.id, from: ev.pubkey, createdAt: ev.created_at, what: 'comment', content: c.preview, sealed: c.ciphertext !== null, ciphertext: c.ciphertext, bag, on }, lookup: null }
  }
  return null
}

/** Settle a candidate with what the lookup found (`undefined` = not found anywhere). */
export function resolve(c: Candidate, found: ReadonlyMap<string, Target>): Notification | null {
  if (!c.lookup) return c.n
  const t = found.get(c.lookup.id)
  const commentIsOurs = (x: Target): boolean => ourRoot(Number(x.tags.find((tag) => tag[0] === 'K')?.[1]))
  switch (c.lookup.rule) {
    case 'kind1':
      // Published on its own, so an ordinary note, not a hidden message.
      return t ? null : c.n
    case 'comment':
      return !t || (t.kind === COMMENT_KIND && commentIsOurs(t)) ? c.n : null
    case 'unknown': {
      if (!t) return c.n
      if (t.kind === COMMENT_KIND) return commentIsOurs(t) ? { ...c.n, on: { type: 'comment', id: c.lookup.id }, guessed: false } : null
      const on = kindOn(t.kind, c.lookup.id)
      return on ? { ...c.n, on, guessed: false } : null
    }
  }
}

/** One event as a notification, placed without any lookup: what `classify` is sure of, else null. */
export function toNotification(ev: NostrEvent, me: string, known: Known = NOTHING_KNOWN): Notification | null {
  const c = classify(ev, me, known)
  return c && !c.lookup ? c.n : null
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
