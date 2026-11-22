/**
 * standingHead.test.ts: the head check before a signature reads the standing
 * subscription on each relay instead of asking again (owner's ruling of
 * 2026-11-22), and never signs blind.
 *
 * | Watch state | Signs at once? |
 * |---|---|
 * | a current relay, its newest move in hand | yes |
 * | a current relay delivered a move not in hand (another device) | no: the relays are asked, which catches up first |
 * | no relay current (dead, AUTH-held, reconnected and not caught up, socket silent) | no: the relays are asked, and the move holds without an answer |
 * | the page's first look (CHECKING YOUR CHAIN) not answered | no |
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const watch = vi.hoisted(() => ({ relays: null as null | Array<{ url: string; current: boolean; newest: { id: string } | null }> }))
vi.mock('../../lib/ownWatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ownWatch')>()),
  ownWatchState: () => watch.relays,
}))

import { standingHeadHolds, useCyberspace } from '../useCyberspace'
import type { NostrEvent } from '../../lib/events'

const PK = 'ab'.repeat(32)
const ev = (n: number): NostrEvent => ({ id: n.toString(16).padStart(64, '0'), pubkey: PK, created_at: n, kind: 3333, tags: [], content: '', sig: '' })
const CANON = 'wss://relay.onosendai.tech/'
const OTHER = 'wss://other.example/'

beforeEach(() => {
  useCyberspace.setState({
    identity: { ...useCyberspace.getState().identity, pubkey: PK },
    events: [ev(1), ev(2), ev(3)],
    held: null,
    chainConflict: null,
    chainSync: { pubkey: PK, status: 'done' },
  } as never)
})

describe('the head check from the standing subscriptions', () => {
  it('a current relay whose newest is the head in hand: signs with no question', () => {
    watch.relays = [{ url: CANON, current: true, newest: ev(3) }, { url: OTHER, current: false, newest: null }]
    expect(standingHeadHolds(PK)).toBe(true)
  })

  it('a dead or AUTH-held relay does not hold it up, while another is current', () => {
    watch.relays = [{ url: CANON, current: false, newest: null }, { url: OTHER, current: true, newest: ev(3) }]
    expect(standingHeadHolds(PK)).toBe(true)
  })

  it('a relay delivered a move from another device that is not in hand: not at once', () => {
    watch.relays = [{ url: CANON, current: true, newest: ev(3) }, { url: OTHER, current: true, newest: ev(4) }]
    expect(standingHeadHolds(PK)).toBe(false)
  })

  it('even a relay that is not current counts against it when it delivered a move not in hand', () => {
    watch.relays = [{ url: CANON, current: true, newest: ev(3) }, { url: OTHER, current: false, newest: ev(4) }]
    expect(standingHeadHolds(PK)).toBe(false)
  })

  it('no relay current (all silent, or reconnected and not caught up): never signs blind', () => {
    watch.relays = [{ url: CANON, current: false, newest: ev(3) }, { url: OTHER, current: false, newest: ev(3) }]
    expect(standingHeadHolds(PK)).toBe(false)
    watch.relays = null
    expect(standingHeadHolds(PK)).toBe(false)
  })

  it('before the page\'s first look has answered, or while it could not, the move asks', () => {
    watch.relays = [{ url: CANON, current: true, newest: ev(3) }]
    useCyberspace.setState({ chainSync: { pubkey: PK, status: 'checking' } } as never)
    expect(standingHeadHolds(PK)).toBe(false)
    useCyberspace.setState({ chainSync: { pubkey: PK, status: 'unreachable' } } as never)
    expect(standingHeadHolds(PK)).toBe(false)
  })

  it('a held chain or a conflict is never signed past from the watch', () => {
    watch.relays = [{ url: CANON, current: true, newest: ev(3) }]
    useCyberspace.setState({ chainConflict: { kind: 'x' } } as never)
    expect(standingHeadHolds(PK)).toBe(false)
  })
})
