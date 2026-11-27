/**
 * relayCardAlone.test.ts - a blueprint card (kind 3343) is never sent on its
 * own (DECK-0010 §7.1 and §10): it travels only inside a bag (33330) or a
 * sealed entry (33335). Every send in lib/relay.ts refuses one, before any
 * socket is touched.
 */

import { describe, expect, it, vi } from 'vitest'

// The real sends (every test file gets the offline relay otherwise): the refusal comes before any socket.
const { CARD_ALONE_REASON, publish, publishLight, publishMany, publishOnceTo } = await vi.importActual<typeof import('../relay')>('../relay')

const card = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1, kind: 3343, tags: [], content: '{}', sig: 'c'.repeat(128) }

describe('a card never goes alone', () => {
  it('publishMany, publish, publishOnceTo and publishLight refuse it', async () => {
    expect(await publishMany(['wss://relay.test'], card)).toEqual({ ok: false, reason: CARD_ALONE_REASON })
    expect((await publish(card)).ok).toBe(false)
    expect((await publishOnceTo('wss://relay.test', card)).ok).toBe(false)
    expect(await publishLight(card)).toBe(false)
  })
})
