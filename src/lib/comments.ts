/**
 * comments.ts: NIP-22 comments (kind 1111) on a hidden item.
 *
 * A hidden shard or message is an inner event sealed inside a bag, the
 * addressable kind 33330 envelope, and the bag is the only one of the two a
 * relay has ever seen. So a comment's ROOT scope is the bag, by address
 * (`A` = 33330:<author>:<lookup id>, `K` 33330, `P` the author), and its
 * PARENT is the item itself: the inner event's id, its kind (3330 for a
 * shard, 1 for a message) and its author, which is the bag's author. A
 * reply's parent is the comment it answers. Anyone reading NIP-22 sees a
 * comment on the bag and a `p` tag naming the author, which is what makes
 * the notification; only a client that has opened the bag can put the
 * comment under the exact item.
 *
 * Comments are plaintext and public, even though the item they answer is
 * hidden. The composer says so.
 */

import { HIDDEN_KIND, MESSAGE_KIND, SHARD_KIND, type HiddenType } from './hidden'
import type { EventTemplate, NostrEvent } from './events'

export const COMMENT_KIND = 1111
export const MAX_COMMENT_LENGTH = 2000
/** NIP-89 client attribution: the app that wrote the comment. */
export const CLIENT_TAG: [string, string] = ['client', 'ONOSENDAI']

/** The thing being commented on: one item, inside one bag. */
export interface CommentSubject {
  /** The bag's author, who also signed the inner item. */
  author: string
  /** The bag's `d` tag. */
  lookupId: string
  /** The inner item's event id. */
  itemId: string
  type: HiddenType
}

/** What a comment answers: the item, or another comment. */
export interface CommentParent {
  id: string
  kind: number
  pubkey: string
}

export interface Comment {
  id: string
  pubkey: string
  createdAt: number
  text: string
  parentId: string
  replies: Comment[]
}

export function bagAddress(subject: Pick<CommentSubject, 'author' | 'lookupId'>): string {
  return `${HIDDEN_KIND}:${subject.author}:${subject.lookupId}`
}

export function itemKind(type: HiddenType): number {
  return type === 'shard' ? SHARD_KIND : MESSAGE_KIND
}

/** The item as a parent: a top-level comment answers the item. */
export function itemParent(subject: CommentSubject): CommentParent {
  return { id: subject.itemId, kind: itemKind(subject.type), pubkey: subject.author }
}

/** A comment as a parent: a reply answers the comment. */
export function commentParent(c: Pick<Comment, 'id' | 'pubkey'>): CommentParent {
  return { id: c.id, kind: COMMENT_KIND, pubkey: c.pubkey }
}

/** The kind 1111 template, per NIP-22: uppercase tags for the root scope, lowercase for the parent. */
export function commentTemplate(subject: CommentSubject, parent: CommentParent, text: string, createdAt: number): EventTemplate {
  const body = text.trim().slice(0, MAX_COMMENT_LENGTH)
  if (!body) throw new Error('a comment needs some text')
  return {
    kind: COMMENT_KIND,
    created_at: createdAt,
    content: body,
    tags: [
      ['A', bagAddress(subject)],
      ['K', String(HIDDEN_KIND)],
      ['P', subject.author],
      ['e', parent.id, '', parent.pubkey],
      ['k', String(parent.kind)],
      ['p', parent.pubkey],
      [...CLIENT_TAG],
    ],
  }
}

/** The relay filter that finds every comment on a bag, whichever item they answer. */
export function commentsFilter(subject: Pick<CommentSubject, 'author' | 'lookupId'>): { kinds: number[]; '#A': string[]; limit: number } {
  return { kinds: [COMMENT_KIND], '#A': [bagAddress(subject)], limit: 500 }
}

interface Parsed {
  id: string
  pubkey: string
  createdAt: number
  text: string
  rootAddress: string
  parentId: string
  parentKind: number
}

function firstTag(ev: NostrEvent, name: string): string[] | undefined {
  return ev.tags.find((t) => t[0] === name)
}

/** A kind 1111 event as a comment, or null when it is not one we can place. */
export function parseComment(ev: NostrEvent): Parsed | null {
  if (ev.kind !== COMMENT_KIND) return null
  const root = firstTag(ev, 'A')?.[1]
  const parent = firstTag(ev, 'e')?.[1]
  const parentKind = Number(firstTag(ev, 'k')?.[1])
  if (!root || !parent || !Number.isFinite(parentKind)) return null
  const text = ev.content.trim()
  if (!text) return null
  return { id: ev.id, pubkey: ev.pubkey, createdAt: ev.created_at, text: text.slice(0, MAX_COMMENT_LENGTH), rootAddress: root, parentId: parent, parentKind }
}

/**
 * The comments on ONE item, threaded: top-level comments answer the item,
 * replies hang under the comment they answer, oldest first at every level.
 * Comments on other items in the same bag, and replies whose parent is not
 * here, are left out.
 */
export function threadComments(events: NostrEvent[], subject: CommentSubject): Comment[] {
  const address = bagAddress(subject)
  const byId = new Map<string, Comment & { parentKind: number }>()
  for (const ev of events) {
    const c = parseComment(ev)
    if (!c || c.rootAddress !== address || byId.has(c.id)) continue
    byId.set(c.id, { id: c.id, pubkey: c.pubkey, createdAt: c.createdAt, text: c.text, parentId: c.parentId, parentKind: c.parentKind, replies: [] })
  }
  const roots: Comment[] = []
  const ordered = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  for (const c of ordered) {
    if (c.parentKind !== COMMENT_KIND && c.parentId === subject.itemId) roots.push(c)
    else if (c.parentKind === COMMENT_KIND) byId.get(c.parentId)?.replies.push(c)
  }
  const placed = new Set<string>()
  const visit = (c: Comment): void => { placed.add(c.id); for (const r of c.replies) visit(r) }
  for (const r of roots) visit(r)
  for (const c of ordered) c.replies = c.replies.filter((r) => placed.has(r.id))
  return roots
}

export function countComments(list: Comment[]): number {
  return list.reduce((n, c) => n + 1 + countComments(c.replies), 0)
}
