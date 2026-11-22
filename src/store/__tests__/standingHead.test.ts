/**
 * standingHead.test.ts: the head check before a signature reads the standing
 * subscription on each relay instead of asking again (owner's ruling of
 * 2026-11-22), and never signs blind.
 *
 * | Watch state | Signs at once? |
 * |---|---|
 * | a pinned relay current, every move delivered in hand | yes |
 * | a relay delivered a move not in hand (another device's) | no: the relays are asked, which catches up first |
 * | only relays this device alone lists are current | no |
 * | no relay current (dead, AUTH-held, reconnected and not caught up, socket silent) | no: the relays are asked, and the move holds without an answer |
 * | the page's first look (CHECKING YOUR CHAIN) not answered | no |
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const watch = vi.hoisted(() => ({ relays: null as null | Array<{ url: string; current: boolean; pinned: boolean }>, delivered: [] as string[] }))
vi.mock('../../lib/ownWatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ownWatch')>()),
  ownWatchState: () => watch.relays,
  unexplainedMoves: (_pk: string, inHand: (id: string) => boolean) => (watch.relays ? watch.delivered.filter((id) => !inHand(id)).length : null),
}))

import { standingHead, useCyberspace } from '../useCyberspace'
import type { NostrEvent } from '../../lib/events'

const PK = 'ab'.repeat(32)
const ev = (n: number): NostrEvent => ({ id: n.toString(16).padStart(64, '0'), pubkey: PK, created_at: n, kind: 3333, tags: [], content: '', sig: '' })
const CANON = 'wss://relay.onosendai.tech/'
const OTHER = 'wss://other.example/'
const SECOND = 'wss://cyberspace.nostr1.com/'
const holds = (pk: string): boolean => standingHead(pk) === 'holds'

beforeEach(() => {
  watch.delivered = []
  useCyberspace.setState({
    identity: { ...useCyberspace.getState().identity, pubkey: PK },
    events: [ev(1), ev(2), ev(3)],
    held: null,
    chainConflict: null,
    chainSync: { pubkey: PK, status: 'done' },
  } as never)
})

describe('the head check from the standing subscriptions', () => {
  it('a current pinned relay, every delivered move in hand: signs with no question', () => {
    watch.relays = [{ url: CANON, current: true, pinned: true }, { url: OTHER, current: false, pinned: false }]
    watch.delivered = [ev(3).id, ev(2).id]
    expect(holds(PK)).toBe(true)
  })

  it('a dead or AUTH-held canonical relay does not hold it up while the other pinned relay is current', () => {
    watch.relays = [{ url: CANON, current: false, pinned: true }, { url: SECOND, current: true, pinned: true }]
    expect(holds(PK)).toBe(true)
  })

  it('a relay only this device lists vouches for nothing: with no pinned relay current, the move is not signed from the watch', () => {
    watch.relays = [{ url: CANON, current: false, pinned: true }, { url: SECOND, current: false, pinned: true }, { url: OTHER, current: true, pinned: false }]
    expect(standingHead(PK)).toBe('quiet')
  })

  it('any relay, current or not, that delivered a move not in hand (another device\'s) sends the move to the relays first', () => {
    watch.relays = [{ url: CANON, current: true, pinned: true }, { url: OTHER, current: false, pinned: false }]
    watch.delivered = [ev(3).id, ev(4).id]
    expect(standingHead(PK)).toBe('ask')
  })

  it('a move in the same second as the head, from another device, is not taken for the head', () => {
    watch.relays = [{ url: CANON, current: true, pinned: true }]
    watch.delivered = [ev(3).id, { ...ev(3), id: 'f'.repeat(64) }.id]
    expect(standingHead(PK)).toBe('ask')
  })

  it('no relay current (all silent, or reconnected and not caught up), or no watch: never signs blind', () => {
    watch.relays = [{ url: CANON, current: false, pinned: true }, { url: SECOND, current: false, pinned: true }]
    expect(holds(PK)).toBe(false)
    watch.relays = null
    expect(standingHead(PK)).toBe('ask')
  })

  it('before the page\'s first look has answered, or while it could not, the move asks', () => {
    watch.relays = [{ url: CANON, current: true, pinned: true }]
    useCyberspace.setState({ chainSync: { pubkey: PK, status: 'checking' } } as never)
    expect(standingHead(PK)).toBe('ask')
    useCyberspace.setState({ chainSync: { pubkey: PK, status: 'unreachable' } } as never)
    expect(standingHead(PK)).toBe('ask')
  })

  it('a held chain or a conflict is never signed past from the watch', () => {
    watch.relays = [{ url: CANON, current: true, pinned: true }]
    useCyberspace.setState({ chainConflict: { kind: 'x' } } as never)
    expect(standingHead(PK)).toBe('ask')
  })
})
