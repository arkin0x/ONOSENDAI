/**
 * notificationsCyberspaceOnly.test.ts: NOTIFICATIONS holds Cyberspace things
 * only (arkinox, 2026-11-14: "i am now seeing all of my nostr notifications.
 * I only want to see cyberspace-related notifications here").
 *
 * - Reactions to normal notes, kind 1 replies, comments in other threads and
 *   zaps are dropped; reactions and comments on a move, a bag, a published
 *   shard (and replies in its thread) are kept.
 * - The relays are asked only for what can be Cyberspace's, and the list,
 *   the unread count behind the badge and the toast agree.
 * - A page that is all someone else's traffic is read past, and the end of
 *   the list is where the relays run out, not the first empty page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

type Ev = { id: string; kind: number; created_at: number; tags: string[][] }
type F = { kinds?: number[]; ids?: string[]; limit?: number; until?: number; since?: number; [tag: `#${string}`]: string[] | undefined }

/** A relay that honors kinds, ids, single-letter tag filters, since, until and limit, newest first. */
const relay = vi.hoisted(() => ({ events: [] as Ev[], published: [] as Ev[], asked: [] as F[], trouble: null as null | 'auth' }))
function matches(ev: Ev, f: F): boolean {
  if (f.kinds && !f.kinds.includes(ev.kind)) return false
  if (f.ids && !f.ids.includes(ev.id)) return false
  if (f.since !== undefined && ev.created_at < f.since) return false
  if (f.until !== undefined && ev.created_at > f.until) return false
  for (const [key, want] of Object.entries(f)) {
    if (!key.startsWith('#') || !want) continue
    if (!ev.tags.some((t) => t[0] === key.slice(1) && (want as string[]).includes(t[1]))) return false
  }
  return true
}
function answer(pool: Ev[], f: F): Ev[] {
  return pool.filter((e) => matches(e, f)).sort((a, b) => b.created_at - a.created_at).slice(0, f.limit ?? Infinity)
}
vi.mock('../../lib/relay', async (orig) => ({
  ...(await orig() as object),
  queryAny: vi.fn(async (_r: string[], f: F) => answer(relay.published, f)),
  queryAnyChecked: vi.fn(async (_r: string[], f: F) => { relay.asked.push(f); return { events: relay.trouble ? [] : answer(relay.events, f), trouble: relay.trouble } }),
  onCanonicalSignIn: () => () => {},
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/inbox', async (orig) => ({ ...(await orig() as object), relaysFor: async () => ['wss://relay.test'] }))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { commentTemplate } from '../../lib/comments'
import { ACTION_KIND, actionCommentTemplate, reactionTemplate } from '../../lib/social'
import { NOTHING_TO_OPEN, classify, itemToView, notificationFilters, publicThingName, resolve, toNotification, type Target } from '../../lib/notifications'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { LIMITS, nextUntil, useNotifications } from '../useNotifications'

const ME_SK = generateSecretKey()
const ME = getPublicKey(ME_SK)
const THEM_SK = generateSecretKey()
const THEM = getPublicKey(THEM_SK)
const T = 1_800_000_000
const sign = (t: Parameters<typeof finalizeEvent>[0], sk = THEM_SK): NostrEvent => finalizeEvent(t, sk) as unknown as NostrEvent

const NOTE = '1'.repeat(64)
const move = { id: 'a'.repeat(64), pubkey: ME, kind: ACTION_KIND }
const shard = { id: 'b'.repeat(64), pubkey: ME, kind: 33331, address: `33331:${ME}:shard-d` }
const bag = { id: 'c'.repeat(64), pubkey: ME, kind: 33330, address: `33330:${ME}:${'d'.repeat(64)}` }

/** A like as another client writes it: no ONOSENDAI `client` tag. */
function foreignLike(kind: number | null, id = NOTE, at = T, client = 'Amethyst'): NostrEvent {
  const tags = [['e', id, '', ME], ['p', ME], ...(kind === null ? [] : [['k', String(kind)]]), ['client', client]]
  return sign({ kind: 7, created_at: at, content: '+', tags })
}
const kind1Reply = (at = T): NostrEvent => sign({ kind: 1, created_at: at, content: 'gm', tags: [['e', NOTE, '', 'root'], ['p', ME]] })
const zap = (at = T): NostrEvent => sign({ kind: 9735, created_at: at, content: '', tags: [['p', ME], ['e', NOTE], ['bolt11', 'lnbc1'], ['description', '{}']] })
const noteComment = (at = T, parentKind = 1): NostrEvent => sign({ kind: 1111, created_at: at, content: 'great note', tags: [['E', NOTE, '', ME], ['K', '1'], ['P', ME], ['e', NOTE, '', ME], ['k', String(parentKind)], ['p', ME]] })

describe('what counts as Cyberspace (lib/notifications classify)', () => {
  const none = new Map<string, Target>()
  const kept = (ev: NostrEvent, found = none) => { const c = classify(ev, ME); return c ? resolve(c, found) : null }

  it('drops a reaction to a normal note, a kind 1 reply, a zap, a DM and a comment in a note thread', () => {
    expect(kept(foreignLike(1))).toBeNull()
    expect(kept(foreignLike(1, NOTE, T, 'Primal'))).toBeNull()
    expect(kept(foreignLike(null))).toBeNull()
    expect(kept(kind1Reply())).toBeNull()
    expect(kept(zap())).toBeNull()
    expect(kept(sign({ kind: 4, created_at: T, content: 'x', tags: [['p', ME]] }))).toBeNull()
    expect(kept(noteComment())).toBeNull()
    expect(kept(noteComment(T, 1111))).toBeNull()
    // A like on a comment of yours in a note's thread, and one on a comment found nowhere.
    expect(kept(foreignLike(1111, 'e'.repeat(64)), new Map([['e'.repeat(64), { kind: 1111, tags: [['K', '1']] }]]))).toBeNull()
    expect(kept(foreignLike(1111, 'e'.repeat(64)))).toBeNull()
  })

  it('keeps reactions on a move, a published shard (by k or by its a alone) and a bag', () => {
    expect(kept(sign(reactionTemplate(move, '🤙', T)))?.on).toEqual({ type: 'action', id: move.id })
    expect(kept(sign(reactionTemplate(shard, '🔥', T)))?.on).toMatchObject({ type: 'item', id: shard.id, kind: 33331, address: shard.address })
    const byAddressOnly = sign({ kind: 7, created_at: T, content: '+', tags: [['e', shard.id], ['a', shard.address], ['p', ME]] })
    expect(kept(byAddressOnly)?.on).toMatchObject({ type: 'item', kind: 33331, address: shard.address })
    expect(kept(sign(reactionTemplate(bag, '+', T)))?.on).toMatchObject({ type: 'item', kind: 33330, lookupId: 'd'.repeat(64) })
  })

  it('keeps reactions on the other things a bag holds and on your listing, avatar, DNA or tending, named as such', () => {
    for (const kind of [3330, 3340, 3341, 3351]) expect(kept(sign(reactionTemplate({ id: 'f'.repeat(64), pubkey: ME, kind }, '+', T)))?.on).toMatchObject({ type: 'item', kind })
    for (const kind of [33340, 11333, 3350, 3352]) {
      const n = kept(sign(reactionTemplate({ id: 'f'.repeat(64), pubkey: ME, kind }, '+', T)))
      expect(n?.on).toMatchObject({ type: 'item', kind })
      expect(publicThingName(n?.on.type === 'item' ? n.on.kind : undefined)).toMatch(/^your /)
    }
  })

  it('VIEW on your listing or avatar says there is nothing to open yet, rather than calling it an item you did not hide', async () => {
    for (const kind of [33340, 11333]) {
      expect(await itemToView(() => [], { id: 'f'.repeat(64), kind }, async () => null)).toEqual({ why: NOTHING_TO_OPEN })
    }
  })

  it('keeps comments on a move, a published shard and a bag, and a reply in a shard\'s thread', () => {
    expect(toNotification(sign(actionCommentTemplate(move, 'nice hop', T)), ME)?.on).toEqual({ type: 'action', id: move.id })
    expect(toNotification(sign(actionCommentTemplate(shard, 'nice shard', T)), ME)?.on).toMatchObject({ type: 'item', kind: 33331, address: shard.address })
    const sealed = commentTemplate({ author: ME, lookupId: 'd'.repeat(64) }, { id: 'f'.repeat(64), kind: 3330, pubkey: ME }, 'CIPHER', T)
    expect(toNotification(sign(sealed), ME)).toMatchObject({ sealed: true, bag: bag.address })
    const reply = actionCommentTemplate({ ...shard, pubkey: THEM, address: `33331:${THEM}:theirs` }, 'agreed', T, { id: '9'.repeat(64), pubkey: ME, kind: 1111 })
    expect(toNotification(sign(reply), ME)?.on).toEqual({ type: 'comment', id: '9'.repeat(64) })
  })

  it('a like on a kind 1 is a hidden message only from a Cyberspace client and only when it is published nowhere', () => {
    const fromApp = sign(reactionTemplate({ id: NOTE, pubkey: ME, kind: 1 }, '+', T))
    expect(kept(fromApp)).toMatchObject({ guessed: true, on: { type: 'item', id: NOTE } })
    expect(kept(fromApp, new Map([[NOTE, { kind: 1, tags: [] }]]))).toBeNull()
    expect(kept(foreignLike(1, NOTE, T, 'cyberspace-mcp'))).not.toBeNull()
    // One of your own hidden messages needs neither.
    expect(classify(foreignLike(1), ME, { actions: new Set(), items: new Map([[NOTE, 'LOOK']]) })?.n.on).toMatchObject({ type: 'item', lookupId: 'LOOK' })
  })

  it('asks the relays only for what can be Cyberspace\'s', () => {
    const [reactions, comments, shared] = notificationFilters(ME)
    expect(reactions).toMatchObject({ kinds: [7], '#p': [ME] })
    expect(reactions['#k']).toEqual(expect.arrayContaining(['3333', '33330', '33331', '3330', '1111']))
    expect(reactions['#k']).not.toContain('1')
    expect(comments).toMatchObject({ kinds: [1111], '#p': [ME] })
    expect(comments['#K']).toEqual(expect.arrayContaining(['3333', '33330', '33331']))
    expect(comments['#K']).not.toContain('1')
    expect(shared['#k']).toEqual(['1', '1063'])
  })
})

describe('nextUntil', () => {
  const at = (...ts: number[]) => ts.map((created_at) => ({ created_at }))
  it('is null for a page not filled, else its oldest second, and moves on by a second when the page ends where it began', () => {
    expect(nextUntil(at(5, 4), 3, undefined)).toBeNull()
    expect(nextUntil(at(10, 9, 8), 3, undefined)).toBe(8)
    expect(nextUntil(at(8, 8, 8), 3, 8)).toBe(7)
  })
})

describe('the store keeps only Cyberspace things', () => {
  beforeEach(() => {
    localStorage.clear()
    relay.events = []
    relay.published = []
    relay.asked = []
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: ME }, live: false })
    useShards.setState({ mine: [], discovered: {}, deleted: {} })
    relay.trouble = null
    useNotifications.setState({ me: null, items: [], opened: {}, lastSeen: 0, done: false, cursors: [undefined, undefined, undefined], newest: 0, floor: null, loading: false, trouble: null, open: false, shown: null })
  })

  it('lists, counts and toasts only the move, shard, bag and thread notifications, and read stays read', async () => {
    const ours = [
      sign(reactionTemplate(move, '🤙', T + 1)),
      sign(reactionTemplate(shard, '🔥', T + 2)),
      sign(reactionTemplate(bag, '+', T + 3)),
      sign(actionCommentTemplate(shard, 'nice shard', T + 4)),
      sign(actionCommentTemplate(move, 'nice hop', T + 5)),
    ]
    const theirs = [foreignLike(1, NOTE, T + 6), foreignLike(null, NOTE, T + 7), kind1Reply(T + 8), zap(T + 9), noteComment(T + 10)]
    relay.events = [...ours, ...theirs]
    relay.published = [{ id: NOTE, kind: 1, created_at: T, tags: [] }]
    localStorage.setItem(`onosendai:notif-seen:${ME}`, String(T + 2))

    await useNotifications.getState().start(ME)
    const s = useNotifications.getState()
    expect(s.items.map((n) => n.id).sort()).toEqual(ours.map((e) => e.id).sort())
    // The badge and the toast count what is listed after the seen mark, nothing else.
    expect(s.unread()).toBe(3)
    expect(s.done).toBe(true)
    // Every read asked for Cyberspace kinds only.
    expect(relay.asked.every((f) => f['#k'] || f['#K'])).toBe(true)

    // Opening and closing reads them; a reload keeps them read.
    s.setOpen(true)
    useNotifications.getState().setOpen(false)
    expect(useNotifications.getState().unread()).toBe(0)
    useNotifications.setState({ me: null })
    await useNotifications.getState().start(ME)
    expect(useNotifications.getState().unread()).toBe(0)
  })

  it('pages each filter on its own: a flood of likes on notes neither hides nor delays the move under them, and the end is where the relays end', async () => {
    const old = sign(reactionTemplate(move, '🤙', T))
    // More app-written likes on published notes than two pages of that filter hold, all newer than the move's reaction.
    const likes = Array.from({ length: LIMITS[2] * 2 + 5 }, (_, i) => sign(reactionTemplate({ id: NOTE, pubkey: ME, kind: 1 }, '+', T + 100 + i)))
    relay.events = [old, ...likes]
    relay.published = [{ id: NOTE, kind: 1, created_at: T, tags: [] }]

    await useNotifications.getState().start(ME)
    expect(useNotifications.getState().items.map((n) => n.id)).toEqual([old.id])
    expect(useNotifications.getState().unread()).toBe(1)
    expect(useNotifications.getState().done).toBe(false)

    for (let i = 0; i < 5 && !useNotifications.getState().done; i += 1) await useNotifications.getState().loadMore()
    expect(useNotifications.getState().done).toBe(true)
    expect(useNotifications.getState().items.map((n) => n.id)).toEqual([old.id])
  })

  it('reads likes on a kind 1 back no further than the oldest other notification', async () => {
    const old = sign(reactionTemplate(move, '🤙', T))
    // Years of likes on notes, before and after the move's reaction.
    const likes = Array.from({ length: LIMITS[2] * 3 }, (_, i) => sign(reactionTemplate({ id: NOTE, pubkey: ME, kind: 1 }, '+', T + 50 - i)))
    relay.events = [old, ...likes]
    relay.published = [{ id: NOTE, kind: 1, created_at: T, tags: [] }]
    await useNotifications.getState().start(ME)
    for (let i = 0; i < 5 && !useNotifications.getState().done; i += 1) await useNotifications.getState().loadMore()
    expect(useNotifications.getState().done).toBe(true)
    // The first page of those likes already reached past the move's reaction: no second page.
    expect(relay.asked.filter((f) => f['#k']?.includes('1') && !f['#k']?.includes('3333'))).toHaveLength(1)
  })

  it('a page the canonical relay refused moves nothing: it is read again', async () => {
    relay.events = [sign(reactionTemplate(move, '🤙', T + 1))]
    relay.trouble = 'auth'
    await useNotifications.getState().start(ME)
    expect(useNotifications.getState()).toMatchObject({ items: [], done: false, trouble: 'auth', cursors: [undefined, undefined, undefined] })
    expect(useNotifications.getState().newest).toBe(0)
    relay.trouble = null
    await useNotifications.getState().loadMore()
    expect(useNotifications.getState().items).toHaveLength(1)
    expect(useNotifications.getState().done).toBe(true)
  })

  it('the poll on sign-in reads a refused first page again, from the top', async () => {
    relay.events = [sign(reactionTemplate(move, '🤙', T + 1))]
    relay.trouble = 'auth'
    await useNotifications.getState().start(ME)
    relay.trouble = null
    await useNotifications.getState().poll()
    expect(useNotifications.getState()).toMatchObject({ trouble: null, done: true, newest: T + 1 })
    expect(useNotifications.getState().items).toHaveLength(1)
  })

  it('a poll reads from the newest event seen, kept or not, and reads back through a filter that filled its page', async () => {
    relay.events = [sign(reactionTemplate(move, '🤙', T)), foreignLike(1, NOTE, T + 50)]
    await useNotifications.getState().start(ME)
    expect(useNotifications.getState().newest).toBe(T + 50)

    // While the tab slept: a shard reaction, then more move reactions than one page holds, all after it.
    const shardLike = sign(reactionTemplate(shard, '🔥', T + 60))
    const burst = Array.from({ length: LIMITS[0] + 3 }, (_, i) => sign(reactionTemplate(move, '+', T + 100 + i)))
    relay.events.push(shardLike, ...burst)
    relay.asked = []
    await useNotifications.getState().poll()
    const ids = new Set(useNotifications.getState().items.map((n) => n.id))
    expect(ids.has(shardLike.id)).toBe(true)
    expect(burst.every((e) => ids.has(e.id))).toBe(true)
    expect(relay.asked.every((f) => f.since === T + 50)).toBe(true)
  })
})
