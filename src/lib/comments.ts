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
 * The words are sealed to the place, like the item they answer. A comment is
 * an FF-1 derived-key event: its `.content` is a public placeholder that any
 * NIP-22 client shows in the author's notifications, and the text lives in
 * an `encrypted` tag under the bag's region key (aes-256-gcm, the same bytes
 * FF-1 specifies), so whoever has reached the place, or opened the bag, reads
 * it and nobody else does. Element [3] of the tag names the derivation,
 * `cyberspace:region`, because there is no key service: every reader derives
 * the key from the location. No `d` tag, as FF-1 requires of derived events.
 */

import { HIDDEN_KIND, MESSAGE_KIND, SHARD_KIND, type HiddenType } from './hidden'
import type { EventTemplate, NostrEvent } from './events'
import { decryptForRegion, encryptForRegion } from './shardCrypto'
import type { Position } from './space'

export const COMMENT_KIND = 1111
export const MAX_COMMENT_LENGTH = 2000
/** NIP-89 client attribution: the app that wrote the comment. */
export const CLIENT_TAG: [string, string] = ['client', 'ONOSENDAI']
/** What every other client shows: an invitation, not the words. */
export const PLACEHOLDER = 'This comment is hidden at an undisclosed location in cyberspace. Happy hunting: https://onosendai.tech'
/** FF-1 `encrypted` tag: the scheme (the reference one) and, in place of a key service, the derivation. */
export const ENCRYPTED_SCHEME = 'aes-256-gcm'
export const KEY_DERIVATION = 'cyberspace:region'

/** The thing being commented on: one item, inside one bag. */
export interface CommentSubject {
  /** The bag's author, who also signed the inner item. */
  author: string
  /** The bag's `d` tag. */
  lookupId: string
  /** The inner item's event id. */
  itemId: string
  type: HiddenType
  /** Where the bag is hidden and the height it is encrypted to: what the region key derives from. */
  at: Position
  height: number
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
  /** The words when opened, else the placeholder. */
  text: string
  /** Still sealed: the key did not open it (or no key was at hand). */
  sealed: boolean
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

/**
 * The kind 1111 template, per NIP-22 (uppercase tags for the root scope,
 * lowercase for the parent) and FF-1 (placeholder content, the words in the
 * `encrypted` tag). `ciphertext` is what `sealedComment` produced.
 */
export function commentTemplate(subject: Pick<CommentSubject, 'author' | 'lookupId'>, parent: CommentParent, ciphertext: string, createdAt: number): EventTemplate {
  if (!ciphertext) throw new Error('a comment needs some text')
  return {
    kind: COMMENT_KIND,
    created_at: createdAt,
    content: PLACEHOLDER,
    tags: [
      ['A', bagAddress(subject)],
      ['K', String(HIDDEN_KIND)],
      ['P', subject.author],
      ['e', parent.id, '', parent.pubkey],
      ['k', String(parent.kind)],
      ['p', parent.pubkey],
      [...CLIENT_TAG],
      ['encrypted', ENCRYPTED_SCHEME, ciphertext, KEY_DERIVATION],
    ],
  }
}

/** The words sealed under the bag's region key, as a ready template. */
export async function sealedComment(subject: Pick<CommentSubject, 'author' | 'lookupId'>, parent: CommentParent, text: string, createdAt: number, key: Uint8Array): Promise<EventTemplate> {
  const body = text.trim().slice(0, MAX_COMMENT_LENGTH)
  if (!body) throw new Error('a comment needs some text')
  return commentTemplate(subject, parent, await encryptForRegion(key, body), createdAt)
}

/** The relay filter that finds every comment on a bag, whichever item they answer. */
export function commentsFilter(subject: Pick<CommentSubject, 'author' | 'lookupId'>): { kinds: number[]; '#A': string[]; limit: number } {
  return { kinds: [COMMENT_KIND], '#A': [bagAddress(subject)], limit: 500 }
}

interface Parsed {
  id: string
  pubkey: string
  createdAt: number
  /** The public content: the placeholder on a sealed comment, the words on a plaintext one. */
  preview: string
  /** The sealed words, when the comment carries them in our scheme. */
  ciphertext: string | null
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
  const enc = firstTag(ev, 'encrypted')
  const ciphertext = enc && enc[1] === ENCRYPTED_SCHEME && enc[2] ? enc[2] : null
  const preview = ev.content.trim().slice(0, MAX_COMMENT_LENGTH)
  if (!ciphertext && !preview) return null
  return { id: ev.id, pubkey: ev.pubkey, createdAt: ev.created_at, preview, ciphertext, rootAddress: root, parentId: parent, parentKind }
}

/** The words of every sealed comment the key opens, by event id. A wrong key opens nothing and says nothing. */
export async function openComments(events: NostrEvent[], key: Uint8Array): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  await Promise.all(events.map(async (ev) => {
    const c = parseComment(ev)
    if (!c?.ciphertext) return
    const text = (await decryptForRegion(key, c.ciphertext))?.trim()
    if (text) out.set(c.id, text.slice(0, MAX_COMMENT_LENGTH))
  }))
  return out
}

/**
 * The comments on ONE item, threaded: top-level comments answer the item,
 * replies hang under the comment they answer, oldest first at every level.
 * Comments on other items in the same bag, and replies whose parent is not
 * here, are left out.
 */
export function threadComments(events: NostrEvent[], subject: Pick<CommentSubject, 'author' | 'lookupId' | 'itemId'>, opened: ReadonlyMap<string, string> = new Map()): Comment[] {
  const address = bagAddress(subject)
  const byId = new Map<string, Comment & { parentKind: number }>()
  for (const ev of events) {
    const c = parseComment(ev)
    if (!c || c.rootAddress !== address || byId.has(c.id)) continue
    const words = opened.get(c.id)
    const sealed = c.ciphertext !== null && words === undefined
    byId.set(c.id, { id: c.id, pubkey: c.pubkey, createdAt: c.createdAt, text: words ?? (sealed ? PLACEHOLDER : c.preview), sealed, parentId: c.parentId, parentKind: c.parentKind, replies: [] })
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
