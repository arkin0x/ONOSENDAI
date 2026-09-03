import { describe, expect, it } from 'vitest'
import { HIDDEN_KIND, MESSAGE_KIND, SHARD_KIND } from './hidden'
import type { NostrEvent } from './events'
import {
  COMMENT_KIND,
  bagAddress,
  commentParent,
  commentTemplate,
  commentsFilter,
  countComments,
  itemParent,
  parseComment,
  threadComments,
  type CommentSubject,
} from './comments'

const AUTHOR = 'aa'.repeat(32)
const OTHER = 'bb'.repeat(32)
const subject: CommentSubject = { author: AUTHOR, lookupId: 'cd'.repeat(32), itemId: '11'.repeat(32), type: 'message' }

function ev(id: string, pubkey: string, createdAt: number, content: string, parent: { id: string; kind: number; pubkey: string }, root = bagAddress(subject)): NostrEvent {
  return { id, pubkey, created_at: createdAt, kind: COMMENT_KIND, content, sig: '', tags: [['A', root], ['K', String(HIDDEN_KIND)], ['P', AUTHOR], ['e', parent.id, '', parent.pubkey], ['k', String(parent.kind)], ['p', parent.pubkey]] }
}

describe('NIP-22 comment on a hidden item', () => {
  it('scopes the root to the bag by address, the parent to the inner item, and names the client', () => {
    const t = commentTemplate(subject, itemParent(subject), '  nice one  ', 1000)
    expect(t.kind).toBe(1111)
    expect(t.content).toBe('nice one')
    expect(t.tags).toEqual([
      ['A', `${HIDDEN_KIND}:${AUTHOR}:${subject.lookupId}`],
      ['K', String(HIDDEN_KIND)],
      ['P', AUTHOR],
      ['e', subject.itemId, '', AUTHOR],
      ['k', String(MESSAGE_KIND)],
      ['p', AUTHOR],
      ['client', 'ONOSENDAI'],
    ])
    expect(itemParent({ ...subject, type: 'shard' }).kind).toBe(SHARD_KIND)
  })
  it('a reply answers the comment, and its author is the one notified', () => {
    const t = commentTemplate(subject, commentParent({ id: '22'.repeat(32), pubkey: OTHER }), 'agreed', 1001)
    expect(t.tags.find((x) => x[0] === 'e')).toEqual(['e', '22'.repeat(32), '', OTHER])
    expect(t.tags.find((x) => x[0] === 'k')).toEqual(['k', '1111'])
    expect(t.tags.find((x) => x[0] === 'p')).toEqual(['p', OTHER])
    expect(t.tags.find((x) => x[0] === 'P')).toEqual(['P', AUTHOR])
  })
  it('refuses an empty comment and finds comments by the bag address', () => {
    expect(() => commentTemplate(subject, itemParent(subject), '   ', 1)).toThrow()
    expect(commentsFilter(subject)).toEqual({ kinds: [1111], '#A': [bagAddress(subject)], limit: 500 })
  })
  it('threads: top-level under the item, replies under their comment, other items and orphans left out', () => {
    const item = itemParent(subject)
    const a = ev('a1', OTHER, 10, 'first', item)
    const b = ev('b2', AUTHOR, 20, 'second', item)
    const r1 = ev('r1', AUTHOR, 30, 'reply to first', { id: 'a1', kind: COMMENT_KIND, pubkey: OTHER })
    const r2 = ev('r2', OTHER, 40, 'reply to reply', { id: 'r1', kind: COMMENT_KIND, pubkey: AUTHOR })
    const otherItem = ev('o1', OTHER, 15, 'on another item', { id: '99'.repeat(32), kind: MESSAGE_KIND, pubkey: AUTHOR })
    const orphan = ev('x1', OTHER, 50, 'reply to nothing here', { id: 'zz', kind: COMMENT_KIND, pubkey: OTHER })
    const otherBag = ev('y1', OTHER, 5, 'other bag', item, `${HIDDEN_KIND}:${OTHER}:deadbeef`)
    const thread = threadComments([r2, orphan, b, otherItem, a, r1, otherBag, a], subject)
    expect(thread.map((c) => c.id)).toEqual(['a1', 'b2'])
    expect(thread[0].replies.map((c) => c.id)).toEqual(['r1'])
    expect(thread[0].replies[0].replies.map((c) => c.id)).toEqual(['r2'])
    expect(countComments(thread)).toBe(4)
    expect(parseComment({ ...a, kind: 1 })).toBeNull()
  })
})
