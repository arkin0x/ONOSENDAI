/**
 * publicShardComments.test.ts: comments on a published shard (arkinox,
 * 2026-11-14): public NIP-22 comments under the shard's address, and a
 * notification when one tags you, which VIEW opens on the shard's card.
 */

import { describe, expect, it } from 'vitest'
import { actionCommentTemplate } from '../social'
import { classify } from '../notifications'
import type { NostrEvent } from '../events'

const ME = 'e'.repeat(64)
const THEM = '7'.repeat(64)
const ADDRESS = `33331:${ME}:maze-kit/skulls`
const SHARD = { id: 's'.repeat(64), pubkey: ME, kind: 33331, address: ADDRESS }

function signed(t: ReturnType<typeof actionCommentTemplate>, id = 'c'.repeat(64)): NostrEvent {
  return { ...t, id, pubkey: THEM, sig: '' } as NostrEvent
}

describe('a comment on a published shard', () => {
  it('names the shard by its address as well as its id, root and parent', () => {
    const t = actionCommentTemplate(SHARD, 'nice skulls', 1)
    expect(t.tags).toContainEqual(['A', ADDRESS, ''])
    expect(t.tags).toContainEqual(['a', ADDRESS, ''])
    expect(t.tags).toContainEqual(['E', SHARD.id, '', ME])
    expect(t.tags).toContainEqual(['K', '33331'])
    expect(t.tags).toContainEqual(['p', ME])
  })

  it('a reply keeps the shard as its root and names the comment as its parent', () => {
    const t = actionCommentTemplate(SHARD, 'yes', 2, { id: 'c'.repeat(64), pubkey: THEM, kind: 1111 })
    expect(t.tags).toContainEqual(['A', ADDRESS, ''])
    expect(t.tags.some((x) => x[0] === 'a')).toBe(false)
    expect(t.tags).toContainEqual(['e', 'c'.repeat(64), '', THEM])
  })

  it('a move\'s comment is as it was: no address', () => {
    const t = actionCommentTemplate({ id: 'm'.repeat(64), pubkey: ME, kind: 3333 }, 'go', 1)
    expect(t.tags.some((x) => x[0] === 'A' || x[0] === 'a')).toBe(false)
  })

  it('is a notification about your shard, by its address', () => {
    const c = classify(signed(actionCommentTemplate(SHARD, 'nice skulls', 1)), ME)
    expect(c?.lookup).toBeNull()
    expect(c?.n.on).toEqual({ type: 'item', id: SHARD.id, kind: 33331, address: ADDRESS })
  })

  it('a reply on that thread to your comment is a reply notification', () => {
    const t = actionCommentTemplate(SHARD, 'yes', 2, { id: 'c'.repeat(64), pubkey: ME, kind: 1111 })
    expect(classify(signed(t, 'd'.repeat(64)), ME)?.n.on).toEqual({ type: 'comment', id: 'c'.repeat(64) })
  })
})
