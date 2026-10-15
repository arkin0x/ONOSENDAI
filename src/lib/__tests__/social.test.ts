/**
 * social.test.ts: reactions and public comments on actions (NIP-25 / NIP-22),
 * the NIP-65 inbox relays they are sent to, and comments threading under an
 * action rather than a bag.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { NostrEvent } from '../events'
import { threadUnder } from '../comments'
import { readRelaysOf } from '../inbox'
import { ACTION_KIND, actionCommentTemplate, deletedBy, groupReactions, parseReaction, reactionGlyph, reactionTemplate, unreactTemplate } from '../social'

const alice = generateSecretKey()
const bob = generateSecretKey()
const carol = generateSecretKey()
const pk = (sk: Uint8Array): string => getPublicKey(sk)
const sign = (t: Parameters<typeof finalizeEvent>[0], sk: Uint8Array): NostrEvent => finalizeEvent(t, sk) as unknown as NostrEvent
const action = { id: 'a'.repeat(64), pubkey: pk(alice), kind: ACTION_KIND }

describe('a reaction', () => {
  it('names the action by e, its author by p, its kind by k', () => {
    const t = reactionTemplate(action, '🤙', 100)
    expect(t.kind).toBe(7)
    expect(t.content).toBe('🤙')
    expect(t.tags).toContainEqual(['e', action.id, '', action.pubkey])
    expect(t.tags).toContainEqual(['p', action.pubkey])
    expect(t.tags).toContainEqual(['k', '3333'])
  })

  it('tags the hider too when the item is someone else\'s object, once each', () => {
    const t = reactionTemplate(action, '+', 100, [pk(bob), action.pubkey])
    expect(t.tags.filter((x) => x[0] === 'p').map((x) => x[1])).toEqual([action.pubkey, pk(bob)])
  })

  it('draws + as a heart and - as a thumbs down', () => {
    expect(reactionGlyph('+')).toBe('❤️')
    expect(reactionGlyph('-')).toBe('👎')
    expect(reactionGlyph('🔥')).toBe('🔥')
  })

  it('reads a custom emoji\'s image from its emoji tag', () => {
    const ev = sign({ kind: 7, created_at: 1, content: ':soapbox:', tags: [['e', action.id], ['emoji', 'soapbox', 'https://x/s.png']] }, bob)
    expect(parseReaction(ev)?.image).toBe('https://x/s.png')
  })
})

describe('grouping reactions', () => {
  it('one row per emoji, most used first, a person counted once per emoji, deletions left out', () => {
    const r1 = sign(reactionTemplate(action, '🤙', 10), bob)
    const r2 = sign(reactionTemplate(action, '🤙', 11), carol)
    const r3 = sign(reactionTemplate(action, '🤙', 12), bob)
    const r4 = sign(reactionTemplate(action, '🔥', 9), carol)
    const other = sign(reactionTemplate({ ...action, id: 'b'.repeat(64) }, '👍', 9), carol)
    const groups = groupReactions([r1, r2, r3, r4, other], action.id)
    expect(groups.map((g) => [g.content, g.pubkeys.length])).toEqual([['🤙', 2], ['🔥', 1]])
    expect(groups[0].ids.get(pk(bob))).toBe(r1.id)

    const del = sign(unreactTemplate(r4.id, 20), carol)
    const forged = sign(unreactTemplate(r2.id, 20), bob)
    const authorOf = new Map([r1, r2, r3, r4].map((r) => [r.id, r.pubkey]))
    const gone = deletedBy([del, forged], authorOf)
    // Only an author can take back their own reaction.
    expect([...gone]).toEqual([r4.id])
    expect(groupReactions([r1, r2, r3, r4], action.id, gone).map((g) => g.content)).toEqual(['🤙'])
  })
})

describe('a comment on an action', () => {
  it('is rooted on the action by E/K/P and tags the author, in plain words', () => {
    const t = actionCommentTemplate(action, '  nice hop  ', 100)
    expect(t.kind).toBe(1111)
    expect(t.content).toBe('nice hop')
    expect(t.tags).toContainEqual(['E', action.id, '', action.pubkey])
    expect(t.tags).toContainEqual(['K', '3333'])
    expect(t.tags).toContainEqual(['e', action.id, '', action.pubkey])
    expect(t.tags).toContainEqual(['k', '3333'])
    expect(t.tags.some((x) => x[0] === 'encrypted')).toBe(false)
    expect(() => actionCommentTemplate(action, '   ', 100)).toThrow()
  })

  it('threads under the action: a reply hangs under the comment it answers, and tags both people', () => {
    const top = sign(actionCommentTemplate(action, 'first', 10), bob)
    const replyT = actionCommentTemplate(action, 'reply', 11, { id: top.id, pubkey: pk(bob), kind: 1111 })
    expect(replyT.tags.filter((x) => x[0] === 'p').map((x) => x[1]).sort()).toEqual([pk(alice), pk(bob)].sort())
    const reply = sign(replyT, carol)
    const elsewhere = sign(actionCommentTemplate({ ...action, id: 'c'.repeat(64) }, 'other', 12), carol)
    const thread = threadUnder([reply, top, elsewhere], action.id, action.id)
    expect(thread.map((c) => c.text)).toEqual(['first'])
    expect(thread[0].replies.map((c) => c.text)).toEqual(['reply'])
  })
})

describe('inbox relays (NIP-65)', () => {
  it('takes read and unmarked relays, secure only, deduplicated, at most four', () => {
    const list = { tags: [
      ['r', 'wss://read.one/', 'read'], ['r', 'wss://write.only', 'write'], ['r', 'wss://both.one'],
      ['r', 'ws://plain.one'], ['r', 'wss://read.one'], ['r', 'wss://c'], ['r', 'wss://d'], ['r', 'wss://e'],
    ] }
    expect(readRelaysOf(list)).toEqual(['wss://read.one', 'wss://both.one', 'wss://c', 'wss://d'])
    expect(readRelaysOf(null)).toEqual([])
  })
})
