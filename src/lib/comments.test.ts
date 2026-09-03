/**
 * comments.test.ts - a comment is a NIP-22 kind 1111 scoped to the bag and
 * parented to the item, and an FF-1 derived-key event: placeholder content,
 * the words sealed under the bag's region key, no d tag. The right key opens
 * it, the wrong key leaves the placeholder, plaintext comments still thread.
 */

import { describe, expect, it } from 'vitest'
import { HIDDEN_KIND, MESSAGE_KIND, SHARD_KIND } from './hidden'
import type { NostrEvent } from './events'
import {
  COMMENT_KIND,
  ENCRYPTED_SCHEME,
  KEY_DERIVATION,
  PLACEHOLDER,
  bagAddress,
  commentParent,
  commentTemplate,
  commentsFilter,
  countComments,
  itemParent,
  openComments,
  parseComment,
  sealedComment,
  threadComments,
  type CommentSubject,
} from './comments'

const AUTHOR = 'aa'.repeat(32)
const OTHER = 'bb'.repeat(32)
const subject: CommentSubject = { author: AUTHOR, lookupId: 'cd'.repeat(32), itemId: '11'.repeat(32), type: 'message', at: { x: 0n, y: 0n, z: 0n }, height: 0 }
const KEY = new Uint8Array(32).map((_, i) => i * 7 + 1)
const WRONG = new Uint8Array(32).map((_, i) => 255 - i)

function ev(id: string, pubkey: string, createdAt: number, content: string, parent: { id: string; kind: number; pubkey: string }, root = bagAddress(subject), extra: string[][] = []): NostrEvent {
  return { id, pubkey, created_at: createdAt, kind: COMMENT_KIND, content, sig: '', tags: [['A', root], ['K', String(HIDDEN_KIND)], ['P', AUTHOR], ['e', parent.id, '', parent.pubkey], ['k', String(parent.kind)], ['p', parent.pubkey], ...extra] }
}

/** A sealed comment as the relay would hand it back. */
async function sealed(id: string, pubkey: string, createdAt: number, text: string, parent: { id: string; kind: number; pubkey: string }, key = KEY): Promise<NostrEvent> {
  const t = await sealedComment(subject, parent, text, createdAt, key)
  return { ...t, id, pubkey, sig: '' } as NostrEvent
}

describe('NIP-22 comment on a hidden item, sealed per FF-1', () => {
  it('scopes the root to the bag, the parent to the item, names the client, and seals the words with no d tag', async () => {
    const t = await sealedComment(subject, itemParent(subject), '  nice one  ', 1000, KEY)
    expect(t.kind).toBe(1111)
    expect(t.content).toBe(PLACEHOLDER)
    const enc = t.tags.find((x) => x[0] === 'encrypted')!
    expect(enc[1]).toBe(ENCRYPTED_SCHEME)
    expect(enc[2].length).toBeGreaterThan(20)
    expect(enc[3]).toBe(KEY_DERIVATION)
    expect(t.tags.filter((x) => x[0] !== 'encrypted')).toEqual([
      ['A', `${HIDDEN_KIND}:${AUTHOR}:${subject.lookupId}`],
      ['K', String(HIDDEN_KIND)],
      ['P', AUTHOR],
      ['e', subject.itemId, '', AUTHOR],
      ['k', String(MESSAGE_KIND)],
      ['p', AUTHOR],
      ['client', 'ONOSENDAI'],
    ])
    expect(t.tags.some((x) => x[0] === 'd')).toBe(false)
    expect(itemParent({ ...subject, type: 'shard' }).kind).toBe(SHARD_KIND)
  })

  it('a reply answers the comment, and its author is the one notified', () => {
    const t = commentTemplate(subject, commentParent({ id: '22'.repeat(32), pubkey: OTHER }), 'ciphertext', 1001)
    expect(t.tags.find((x) => x[0] === 'e')).toEqual(['e', '22'.repeat(32), '', OTHER])
    expect(t.tags.find((x) => x[0] === 'k')).toEqual(['k', '1111'])
    expect(t.tags.find((x) => x[0] === 'p')).toEqual(['p', OTHER])
    expect(t.tags.find((x) => x[0] === 'P')).toEqual(['P', AUTHOR])
  })

  it('refuses an empty comment and finds comments by the bag address', async () => {
    await expect(sealedComment(subject, itemParent(subject), '   ', 1000, KEY)).rejects.toThrow()
    expect(() => commentTemplate(subject, itemParent(subject), '', 1000)).toThrow()
    expect(commentsFilter(subject)).toEqual({ kinds: [1111], '#A': [bagAddress(subject)], limit: 500 })
  })

  it('the right key opens the words, the wrong key leaves the placeholder, and a plaintext comment reads as written', async () => {
    const a = await sealed('a1', OTHER, 10, 'found it under the arch', itemParent(subject))
    const b = ev('b2', OTHER, 11, 'old plaintext comment', itemParent(subject))
    expect(parseComment(a)!.ciphertext).not.toBeNull()
    expect(parseComment(a)!.preview).toBe(PLACEHOLDER)
    expect(parseComment(b)!.ciphertext).toBeNull()

    const opened = await openComments([a, b], KEY)
    expect(opened.get('a1')).toBe('found it under the arch')
    expect(opened.has('b2')).toBe(false)
    const thread = threadComments([a, b], subject, opened)
    expect(thread.map((c) => [c.text, c.sealed])).toEqual([['found it under the arch', false], ['old plaintext comment', false]])

    const wrong = await openComments([a], WRONG)
    expect(wrong.size).toBe(0)
    const still = threadComments([a], subject, wrong)
    expect(still[0].text).toBe(PLACEHOLDER)
    expect(still[0].sealed).toBe(true)
    // No key at all: the same placeholder.
    expect(threadComments([a], subject)[0].sealed).toBe(true)
  })

  it('threads: top-level under the item, replies under their comment, other items and orphans left out', async () => {
    const other = ev('x9', OTHER, 5, 'on another item', { id: '33'.repeat(32), kind: MESSAGE_KIND, pubkey: AUTHOR })
    const a1 = await sealed('a1', OTHER, 10, 'first', itemParent(subject))
    const b2 = await sealed('b2', AUTHOR, 12, 'second', itemParent(subject))
    const r1 = await sealed('r1', AUTHOR, 11, 'reply to first', { id: 'a1', kind: COMMENT_KIND, pubkey: OTHER })
    const r2 = await sealed('r2', OTHER, 13, 'reply to the reply', { id: 'r1', kind: COMMENT_KIND, pubkey: AUTHOR })
    const orphan = await sealed('o1', OTHER, 14, 'answers a comment we never saw', { id: 'zz'.repeat(32), kind: COMMENT_KIND, pubkey: OTHER })
    const elsewhere = ev('e1', OTHER, 15, 'another bag', itemParent(subject), `${HIDDEN_KIND}:${OTHER}:${'ef'.repeat(32)}`)
    const events = [other, r2, orphan, b2, a1, r1, elsewhere, a1]
    const thread = threadComments(events, subject, await openComments(events, KEY))
    expect(thread.map((c) => c.id)).toEqual(['a1', 'b2'])
    expect(thread[0].replies.map((c) => c.id)).toEqual(['r1'])
    expect(thread[0].replies[0].replies.map((c) => c.id)).toEqual(['r2'])
    expect(thread[0].replies[0].replies[0].text).toBe('reply to the reply')
    expect(countComments(thread)).toBe(4)
  })
})
