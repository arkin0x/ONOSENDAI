/**
 * notifications.test.ts: what a tagging event says happened, and where its
 * VIEW button goes.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { NostrEvent } from '../events'
import { commentTemplate } from '../comments'
import { classify, mergeNotifications, resolve, toNotification, unreadCount, type Target } from '../notifications'
import { ACTION_KIND, actionCommentTemplate, reactionTemplate } from '../social'

const meSk = generateSecretKey()
const them = generateSecretKey()
const me = getPublicKey(meSk)
const sign = (t: Parameters<typeof finalizeEvent>[0], sk: Uint8Array): NostrEvent => finalizeEvent(t, sk) as unknown as NostrEvent
const move = { id: 'a'.repeat(64), pubkey: me, kind: ACTION_KIND }

describe('toNotification', () => {
  it('a reaction to your move goes to the move', () => {
    const n = toNotification(sign(reactionTemplate(move, '🤙', 5), them), me)
    expect(n).toMatchObject({ what: 'reaction', content: '🤙', on: { type: 'action', id: move.id } })
  })

  it('a reaction to your hidden shard or object goes to the item, no lookup needed', () => {
    for (const kind of [3330, 33331]) {
      const n = toNotification(sign(reactionTemplate({ id: 'b'.repeat(64), pubkey: me, kind }, '+', 5), them), me)
      expect(n?.on).toEqual({ type: 'item', id: 'b'.repeat(64), lookupId: undefined })
    }
  })

  it('a reaction to your comment goes to the comment, once the comment is found in a move or bag thread', () => {
    const c = classify(sign(reactionTemplate({ id: 'c'.repeat(64), pubkey: me, kind: 1111 }, '🔥', 5), them), me)!
    expect(resolve(c, new Map([['c'.repeat(64), { kind: 1111, tags: [['K', '3333']] }]]))?.on).toEqual({ type: 'comment', id: 'c'.repeat(64) })
  })

  it('a comment on your move carries its words and goes to the move', () => {
    const n = toNotification(sign(actionCommentTemplate(move, 'nice hop', 5), them), me)
    expect(n).toMatchObject({ what: 'comment', content: 'nice hop', sealed: false, on: { type: 'action', id: move.id } })
  })

  it('a reply to your comment on a move goes to your comment', () => {
    const t = actionCommentTemplate({ ...move, pubkey: getPublicKey(them) }, 'yes', 5, { id: 'd'.repeat(64), pubkey: me, kind: 1111 })
    expect(toNotification(sign(t, them), me)?.on).toEqual({ type: 'comment', id: 'd'.repeat(64) })
  })

  it('a sealed comment on your hidden item names the bag and stays sealed until opened', () => {
    const t = commentTemplate({ author: me, lookupId: 'L'.repeat(8) }, { id: 'e'.repeat(64), kind: 3330, pubkey: me }, 'CIPHER', 5)
    const n = toNotification(sign(t, them), me)
    expect(n).toMatchObject({ what: 'comment', sealed: true, ciphertext: 'CIPHER', bag: `33330:${me}:${'L'.repeat(8)}`, on: { type: 'item', id: 'e'.repeat(64), lookupId: 'L'.repeat(8) } })
  })

  it('ignores your own events, events that do not tag you, and kinds it cannot place', () => {
    expect(toNotification(sign(reactionTemplate(move, '+', 5), meSk), me)).toBeNull()
    expect(toNotification(sign(reactionTemplate({ ...move, pubkey: getPublicKey(them) }, '+', 5), them), me)).toBeNull()
    expect(toNotification(sign(reactionTemplate({ ...move, kind: 30023 }, '+', 5), them), me)).toBeNull()
  })
})

describe('the list', () => {
  it('merges newest first, once per id, and counts what came after the seen mark', () => {
    const a = toNotification(sign(reactionTemplate(move, '+', 10), them), me)!
    const b = toNotification(sign(reactionTemplate(move, '🔥', 20), them), me)!
    const list = mergeNotifications([a], [b, a])
    expect(list.map((n) => n.createdAt)).toEqual([20, 10])
    expect(unreadCount(list, 10)).toBe(1)
    expect(unreadCount(list, 0)).toBe(2)
  })
})

describe('only ONOSENDAI traffic (arkinox, 2026-09-30)', () => {
  const none = new Map<string, Target>()
  const note = 'f'.repeat(64)
  const like = (kind: number | null, id = note) => {
    const t = reactionTemplate({ id, pubkey: me, kind: kind ?? 1 }, '+', 5)
    if (kind === null) t.tags = t.tags.filter((x) => x[0] !== 'k')
    return sign(t, them)
  }

  it('a like on an ordinary note is dropped once the note is found on a relay', () => {
    const c = classify(like(1), me)!
    expect(c.lookup).toEqual({ id: note, rule: 'kind1' })
    expect(resolve(c, new Map([[note, { kind: 1, tags: [] }]]))).toBeNull()
  })

  it('a like on a kind 1 that is one of your hidden messages needs no lookup and is sure', () => {
    const c = classify(like(1), me, { actions: new Set(), items: new Map([[note, 'LOOK']]) })!
    expect(c.lookup).toBeNull()
    expect(c.n).toMatchObject({ on: { type: 'item', id: note, lookupId: 'LOOK' } })
    expect(c.n.guessed).toBeUndefined()
  })

  it('a like on a kind 1 found nowhere is kept, as a possible hidden message', () => {
    const n = resolve(classify(like(1), me)!, none)
    expect(n).toMatchObject({ guessed: true, on: { type: 'item', id: note } })
  })

  it('a like with no k tag on one of your moves is known without a lookup', () => {
    const c = classify(like(null, move.id), me, { actions: new Set([move.id]), items: new Map() })!
    expect(c.lookup).toBeNull()
    expect(c.n.on).toEqual({ type: 'action', id: move.id })
  })

  it('a like with no k tag is placed by the target it finds, dropped for a note, kept when found nowhere', () => {
    const c = classify(like(null), me)!
    expect(c.lookup?.rule).toBe('unknown')
    expect(resolve(c, new Map([[note, { kind: 3333, tags: [] }]]))).toMatchObject({ on: { type: 'action', id: note }, guessed: false })
    expect(resolve(c, new Map([[note, { kind: 1, tags: [] }]]))).toBeNull()
    expect(resolve(c, none)).toMatchObject({ guessed: true })
  })

  it('a like on a comment counts only when that comment is in a move or bag thread', () => {
    const c = classify(like(1111), me)!
    expect(c.lookup?.rule).toBe('comment')
    expect(resolve(c, new Map([[note, { kind: 1111, tags: [['K', '3333']] }]]))).not.toBeNull()
    expect(resolve(c, new Map([[note, { kind: 1111, tags: [['K', '33330']] }]]))).not.toBeNull()
    expect(resolve(c, new Map([[note, { kind: 1111, tags: [['K', '30023']] }]]))).toBeNull()
    expect(resolve(c, none)).not.toBeNull()
  })

  it('a comment or reply in some other app\'s NIP-22 thread is dropped', () => {
    const t = {
      kind: 1111, created_at: 5, content: 'great article',
      tags: [['A', `30023:${me}:post`], ['K', '30023'], ['P', me], ['e', 'c'.repeat(64), '', me], ['k', '1111'], ['p', me]],
    }
    expect(classify(sign(t, them), me)).toBeNull()
  })

  it('reactions to kinds nothing here uses are dropped outright', () => {
    expect(classify(like(30023), me)).toBeNull()
    expect(classify(like(6), me)).toBeNull()
  })
})
