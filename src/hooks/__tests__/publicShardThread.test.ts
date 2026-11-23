/**
 * publicShardThread.test.ts: a published shard's comments are read by its
 * address (`#A`), and every top-level comment on any version of it is in the
 * thread, even one from another client that names an older version by `e`
 * alone (review of the notifications overhaul, 2026-11-14).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis

const asked = vi.hoisted(() => ({ filters: [] as unknown[], events: [] as unknown[] }))
vi.mock('../../lib/relay', async (real) => ({
  ...(await real<typeof import('../../lib/relay')>()),
  onCanonicalSignIn: () => () => {},
  queryAnyChecked: vi.fn(async (_r: string[], f: unknown) => { asked.filters.push(f); return { events: asked.events, trouble: null } }),
}))
vi.mock('../../lib/inbox', async (real) => ({ ...(await real<typeof import('../../lib/inbox')>()), relaysFor: async () => ['wss://relay.test'] }))

import { mountHook, settle } from '../../test/hookRoot'
import { useActionComments } from '../useSocial'
import { actionCommentTemplate } from '../../lib/social'

const ME = 'e'.repeat(64)
const THEM = '7'.repeat(64)
const ADDRESS = `33331:${ME}:skulls`
const NOW_ID = '1'.repeat(64)
const OLD_ID = '2'.repeat(64)
const shard = { id: NOW_ID, pubkey: ME, kind: 33331, address: ADDRESS }

const ev = (t: ReturnType<typeof actionCommentTemplate>, id: string) => ({ ...t, id, pubkey: THEM, sig: '' })

let hook: { current: () => ReturnType<typeof useActionComments>; unmount: () => Promise<void> } | null = null
afterEach(async () => { await hook?.unmount(); hook = null; asked.filters = []; asked.events = [] })

describe('a published shard\'s thread', () => {
  it('is asked for by address, and holds comments on this version, an older one, and replies', async () => {
    const onNow = ev(actionCommentTemplate(shard, 'on this one', 1), 'a'.repeat(64))
    // Another client: root by address, parent the older version by `e` alone, no `a`.
    const older = actionCommentTemplate({ ...shard, id: OLD_ID }, 'on the old one', 2)
    const onOld = ev({ ...older, tags: older.tags.filter((t) => t[0] !== 'a') }, 'b'.repeat(64))
    const reply = ev(actionCommentTemplate(shard, 'a reply', 3, { id: 'a'.repeat(64), pubkey: THEM, kind: 1111 }), 'c'.repeat(64))
    asked.events = [onNow, onOld, reply]
    const h = mountHook(() => useActionComments(shard), {})
    hook = h
    await settle(10)
    expect(asked.filters[0]).toEqual({ kinds: [1111], '#A': [ADDRESS], limit: 500 })
    const comments = h.current().comments
    expect(comments.map((c) => c.text)).toEqual(['on this one', 'on the old one'])
    expect(comments[0].replies.map((c) => c.text)).toEqual(['a reply'])
  })

  it('a move is asked for by its id, as before', async () => {
    hook = mountHook(() => useActionComments({ id: NOW_ID, pubkey: ME, kind: 3333 }), {})
    await settle(10)
    expect(asked.filters[0]).toEqual({ kinds: [1111], '#E': [NOW_ID], limit: 500 })
  })
})
