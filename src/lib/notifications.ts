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
 * | a published shard, hidden nowhere here | reaction `k` 33331, or comment root `K` 33331 | its card, PUBLIC (usePublicShard) |
 * | a comment of yours | reaction `k` 1111, or comment parent `k` 1111 | whatever that comment answers |
 *
 * Every row's button says VIEW, and lands on the comment or the reactions (landingOf).
 *
 * Comments on hidden items are sealed to the place (comments.ts); the store
 * opens the ones on your own bags, and the rest say only that a sealed
 * comment arrived.
 */

import { COMMENT_KIND, parseComment } from './comments'
import type { NostrEvent } from './events'
import { HIDDEN_KIND, MESSAGE_KIND, SHARD_KIND, itemLineage } from './hidden'
import { ACTION_KIND, REACTION_KIND, parseReaction } from './social'

/** An object hidden by reference is its own addressable event (spec §7.6). */
const OBJECT_KIND = 33331

export type NotifOn =
  | { type: 'action'; id: string }
  /**
   * `address`: the reaction's `a`, for a shard hidden by reference, whose id
   * changes each time the object is published again under that address.
   * `kind`: the reacted event's, from `k`, when given.
   */
  | { type: 'item'; id: string; lookupId?: string; address?: string; kind?: number }
  | { type: 'comment'; id: string }
  /** A local chat line that tagged you: its inner event id (arkinox, 2026-10-13). */
  | { type: 'chat'; id: string }

export interface Notification {
  id: string
  from: string
  createdAt: number
  what: 'reaction' | 'comment' | 'mention'
  /** The reaction as written, the comment's words (the placeholder while sealed), or the chat line that tagged you. */
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

/** Comment threads that are ONOSENDAI's: a move's, a bag's, or a published shard's (arkinox, 2026-11-14). */
function ourRoot(rootKind: number): boolean {
  return rootKind === ACTION_KIND || rootKind === HIDDEN_KIND || rootKind === OBJECT_KIND
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
    const item: NotifOn = { type: 'item', id: r.targetId, lookupId: known.items.get(r.targetId), ...(r.targetAddress ? { address: r.targetAddress } : {}), ...(r.targetKind !== null ? { kind: r.targetKind } : {}) }
    if (known.actions.has(r.targetId)) return { n: { ...base, on: { type: 'action', id: r.targetId } }, lookup: null }
    if (mineItem) return { n: { ...base, on: item }, lookup: null }
    if (r.targetKind === MESSAGE_KIND) return { n: { ...base, on: item, guessed: true }, lookup: { id: r.targetId, rule: 'kind1' } }
    if (r.targetKind === COMMENT_KIND) return { n: { ...base, on: { type: 'comment', id: r.targetId } }, lookup: { id: r.targetId, rule: 'comment' } }
    if (r.targetKind === null) return { n: { ...base, on: item, guessed: true }, lookup: { id: r.targetId, rule: 'unknown' } }
    const on = r.targetKind === SHARD_KIND || r.targetKind === OBJECT_KIND ? item : kindOn(r.targetKind, r.targetId)
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
    // A published shard's thread is the object, by its address (lib/social actionCommentTemplate).
    const shardAddress = rootKind === OBJECT_KIND && c.rootAddress.startsWith(`${OBJECT_KIND}:`) ? c.rootAddress : undefined
    // A reply answers a comment; a top-level comment answers the thing itself.
    const on: NotifOn | null = c.parentKind === COMMENT_KIND
      ? { type: 'comment', id: c.parentId }
      : rootKind === ACTION_KIND ? { type: 'action', id: c.rootAddress }
        : rootKind === OBJECT_KIND ? { type: 'item', id: c.parentId, kind: OBJECT_KIND, ...(shardAddress ? { address: shardAddress } : {}) }
          : (kindOn(c.parentKind, c.parentId, lookupId) ?? { type: 'item', id: c.parentId, lookupId })
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

/**
 * A chat line that tagged you, as a notification (arkinox, 2026-10-13). Chat
 * is ephemeral, so no relay will ever hand these back: they are made here,
 * when the line arrives, and kept on this device (useNotifications).
 */
export function mentionNotification(line: { id: string; from: string; at: number; text: string }): Notification {
  return { id: line.id, from: line.from, createdAt: line.at, what: 'mention', content: line.text, sealed: false, ciphertext: null, bag: null, on: { type: 'chat', id: line.id } }
}

/** The notifications a relay can be asked about again: everything but chat mentions, which no relay keeps. */
export function fromRelays(list: readonly Notification[]): Notification[] {
  return list.filter((n) => n.what !== 'mention')
}

/** How many arrived after you last looked. */
export function unreadCount(list: Notification[], lastSeen: number): number {
  return list.filter((n) => n.createdAt > lastSeen).length
}

/** What hiddenRowFor needs of a row of yours (store/useShards MyDeployment). */
export interface HiddenRowLike {
  eventId: string
  lookupId: string
  inner?: { id?: string; kind: number; tags: string[][] }
  ref?: string[]
  /** The lineage an inline shard kept when it went by reference to fit its bag (store/useShards MyDeployment `lineage`). */
  lineage?: string
}

/**
 * The row of yours an item notification is about, or undefined when this
 * device hid no such thing (arkinox, 2026-11-02: four of four refused, on the
 * phone that hid them). A reaction names an item by:
 *
 * | It names | Row it is |
 * |---|---|
 * | the row's own id | that row |
 * | the inner event as this device holds it now | a shard by reference, refreshed since it was hidden |
 * | the first version's id (`d`) | an item carried inline and moved by EDIT (itemLineage) |
 * | the lineage it kept | an inline shard that went by reference to fit its bag |
 * | the object's address (`a`) | a shard by reference, republished under that address since |
 * | the bag (a comment's `A`) | the first row in that bag |
 */
export function hiddenRowFor<T extends HiddenRowLike>(rows: readonly T[], on: { id: string | null; lookupId?: string; address?: string }): T | undefined {
  const id = on.id
  const byId = id
    ? rows.find((d) => d.eventId === id) ??
      rows.find((d) => d.inner?.id === id) ??
      rows.find((d) => !d.ref && d.inner?.id !== undefined && itemLineage(d.inner as { id: string; kind: number; tags: string[][] }) === id) ??
      rows.find((d) => d.lineage === id)
    : undefined
  return byId ??
    (on.address ? rows.find((d) => d.ref?.[0] === 'a' && d.ref[1] === on.address) : undefined) ??
    (on.lookupId ? rows.find((d) => d.lookupId === on.lookupId) : undefined)
}

/** Whether an item notification is about a kind 33331 object: a shard. */
export function onShard(on: { kind?: number; address?: string }): boolean {
  return on.kind === OBJECT_KIND || on.address?.startsWith(`${OBJECT_KIND}:`) === true
}

/** The author an address names, `<kind>:<author>:<d>`. */
function authorOf(address: string): string {
  return address.split(':')[1] ?? ''
}

/**
 * Whether an item notification is about a shard you published that this
 * device hid nowhere: other clients show your kind 33331 objects in their
 * feeds, and a reaction there is to the shard, not to a hidden item. Yours:
 * a reaction can tag you on someone else's shard (the hider of a shard of
 * theirs is told too), and that one is no shard of yours (review of #590).
 * With no `a`, the shard is taken as yours, as the tag that reached you says.
 */
export function publishedShardOnly(on: NotifOn, rows: readonly HiddenRowLike[], me: string): boolean {
  return on.type === 'item' && onShard(on) && (on.address === undefined || authorOf(on.address) === me) && !hiddenRowFor(rows, on)
}

/**
 * Whether an item notification is about someone else's published shard,
 * hidden nowhere here: a comment on their shard's public thread that tags
 * you, now that those threads count (ourRoot). Neither "your shard" nor
 * "your hidden item".
 */
export function theirPublishedShard(on: NotifOn, rows: readonly HiddenRowLike[], me: string): boolean {
  return on.type === 'item' && onShard(on) && on.address !== undefined && authorOf(on.address) !== me && !hiddenRowFor(rows, on)
}

/** VIEW's refusals on an item. */
export const NOT_HIDDEN_HERE = 'That item is not one this device hid, so it cannot be opened from here.'
export const SHARD_UNCHECKED = 'That shard could not be read from any relay. Try again later.'
export const SHARD_NOT_FOUND = 'That shard could not be found on any relay.'
export const SHARD_SEALED = 'That shard is sealed, and was not hidden on this device.'
export const SHARD_UNREADABLE = 'That shard could not be read.'

/**
 * What VIEW opens on an item: the row this device hid it as, or a shard that
 * is published (its address, or its id when nothing says the address), or
 * why it opens nothing.
 */
export type ItemView<T> = { row: T } | { published: { address?: string; id: string | null } } | { why: string }

/**
 * What VIEW goes to (hiddenRowFor), or why not. A reaction on a shard with
 * no `a` (Ditto writes none) names it by id alone, and only the shard itself
 * says its address, so it is fetched (`fetch`) before anything else: its
 * address may find a row hidden here. A shard hidden nowhere here is opened
 * as the published shard it is (arkinox, 2026-11-14: "we should have a modal
 * to view published SNO/shards"), yours or another author's. A fetch that
 * fails or finds nothing cannot tell, and says so (review of #590).
 */
export async function itemToView<T extends HiddenRowLike>(
  rows: () => readonly T[],
  on: { id: string | null; lookupId?: string; address?: string; kind?: number },
  fetch: (id: string) => Promise<{ kind: number; pubkey: string; tags: string[][] } | null>,
): Promise<ItemView<T>> {
  const here = hiddenRowFor(rows(), on)
  if (here) return { row: here }
  if (!onShard(on)) return { why: NOT_HIDDEN_HERE }
  let address = on.address
  if (address === undefined && on.id !== null) {
    let ev: { kind: number; pubkey: string; tags: string[][] } | null = null
    try { ev = await fetch(on.id) } catch { ev = null }
    const d = ev?.tags.find((t) => t[0] === 'd')?.[1]
    if (!ev || d === undefined) return { why: SHARD_UNCHECKED }
    address = `${ev.kind}:${ev.pubkey}:${d}`
    const row = hiddenRowFor(rows(), { id: null, address })
    if (row) return { row }
  }
  return { published: { ...(address !== undefined ? { address } : {}), id: on.id } }
}

/** Where VIEW lands in what it opens: a comment (highlighted), or the reactions. */
export type LandOn = { comment: string } | { reactions: true }

/**
 * What VIEW scrolls to once the thing is open (arkinox, 2026-11-14: "If I
 * click view, I want to see the reactions section or comment thread"): a
 * comment or a reply is that comment; a reaction to your comment is your
 * comment; a reaction to a move or an item is the reactions. A chat tag has
 * its own landing (the line in chat).
 */
export function landingOf(n: Pick<Notification, 'id' | 'what' | 'on'>): LandOn | null {
  if (n.what === 'mention') return null
  if (n.what === 'comment') return { comment: n.id }
  return n.on.type === 'comment' ? { comment: n.on.id } : { reactions: true }
}
