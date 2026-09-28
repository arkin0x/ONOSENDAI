/**
 * notifications.test.ts: what a tagging event says happened, and where its
 * VIEW button goes.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { NostrEvent } from './events'
import { commentTemplate } from './comments'
import { mergeNotifications, toNotification, unreadCount } from './notifications'
import { ACTION_KIND, actionCommentTemplate, reactionTemplate } from './social'

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

  it('a reaction to your hidden shard or message goes to the item', () => {
    for (const kind of [3330, 1, 33331]) {
      const n = toNotification(sign(reactionTemplate({ id: 'b'.repeat(64), pubkey: me, kind }, '+', 5), them), me)
      expect(n?.on).toEqual({ type: 'item', id: 'b'.repeat(64), lookupId: undefined })
    }
  })

  it('a reaction to your comment goes to the comment', () => {
    const n = toNotification(sign(reactionTemplate({ id: 'c'.repeat(64), pubkey: me, kind: 1111 }, '🔥', 5), them), me)
    expect(n?.on).toEqual({ type: 'comment', id: 'c'.repeat(64) })
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
