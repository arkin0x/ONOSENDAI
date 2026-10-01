/**
 * chainHold.test.ts - the self-check verdict, the first move it decides, the
 * status line, and the conflict a held chain can end up in, row by row.
 */

import { describe, expect, it } from 'vitest'
import {
  decideSelfCheck,
  firstMove,
  foldHeldConflict,
  holdReason,
  chainStatusLabel,
  chainStatusOf,
  localSupersedes,
  refusalText,
  summarizeChain,
  type StatusFacts,
} from './chainHold'
import { ACTION_KIND, spawnTemplate, type NostrEvent } from './events'
import type { RelayAnswer } from './relayOutcome'

const PUBKEY = 'ab'.repeat(32)
const CANON = 'wss://cyberspace.nostr1.com'
const hex = (n: number): string => n.toString(16).padStart(64, '0')

function spawn(id: string, createdAt: number): NostrEvent {
  return { ...spawnTemplate(PUBKEY, createdAt), id, pubkey: PUBKEY, sig: '0'.repeat(128) }
}

function hop(id: string, prev: string, genesis: string, createdAt: number): NostrEvent {
  return {
    id,
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: ACTION_KIND,
    content: '',
    sig: '0'.repeat(128),
    tags: [
      ['A', 'hop'],
      ['C', hex(0xaa)],
      ['c', PUBKEY],
      ['S', '0-0-0'],
      ['e', genesis, '', 'genesis'],
      ['e', prev, '', 'previous'],
      ['proof', hex(0xbeef)],
    ],
  }
}

const answered = (url: string, events: NostrEvent[] = []): RelayAnswer => ({ url, outcome: 'answered', events })
const refused = (url: string, reason: string): RelayAnswer => ({ url, outcome: 'refused', reason, events: [] })
const unreachable = (url: string): RelayAnswer => ({ url, outcome: 'unreachable', reason: 'no answer in time', events: [] })

describe('the self-check verdict', () => {
  const chain = [spawn(hex(1), 100)]

  it('is found when any relay returned a chain, whatever the canonical relay did', () => {
    expect(decideSelfCheck([unreachable(CANON), answered('wss://mine.example', chain)], CANON, true)).toEqual({ status: 'found', events: chain })
    expect(decideSelfCheck([refused(CANON, 'restricted: no'), answered('wss://mine.example', chain)], CANON, false).status).toBe('found')
  })

  it('is none only when the canonical relay really answered with nothing', () => {
    expect(decideSelfCheck([answered(CANON)], CANON, true)).toEqual({ status: 'none' })
    // A trailing slash is the same relay.
    expect(decideSelfCheck([answered(`${CANON}/`)], CANON, true)).toEqual({ status: 'none' })
    // Another relay answering "nothing" knows only about itself.
    expect(decideSelfCheck([unreachable(CANON), answered('wss://mine.example')], CANON, true).status).toBe('unknown')
  })

  it('does not count events that build no chain as a chain', () => {
    const orphan = hop(hex(2), hex(9), hex(9), 200)
    expect(decideSelfCheck([answered(CANON, [orphan])], CANON, true)).toEqual({ status: 'none' })
  })

  it('names the cause when nobody could say', () => {
    expect(decideSelfCheck([unreachable(CANON)], CANON, false)).toEqual({ status: 'unknown', cause: { kind: 'offline' } })
    expect(decideSelfCheck([refused(CANON, 'auth-required: sign in')], CANON, true))
      .toEqual({ status: 'unknown', cause: { kind: 'refused', url: CANON, reason: 'auth-required: sign in' } })
    expect(decideSelfCheck([unreachable(CANON)], CANON, true))
      .toEqual({ status: 'unknown', cause: { kind: 'unreachable', reason: 'no answer in time' } })
    expect(decideSelfCheck([], CANON, true)).toEqual({ status: 'unknown', cause: { kind: 'unreachable', reason: 'not asked' } })
  })
})

describe('the first move of a provisional identity', () => {
  it('continues a relay chain that already placed it, and signs nothing', () => {
    for (const st of ['found', 'none', 'unknown', 'checking'] as const) expect(firstMove(st, true)).toBe('adopted')
  })

  it('signs a normal spawn only on none, and holds every other answer', () => {
    expect(firstMove('none', false)).toBe('spawn')
    expect(firstMove('unknown', false)).toBe('spawn-held')
    expect(firstMove('checking', false)).toBe('spawn-held')
    expect(firstMove('found', false)).toBe('spawn-held')
  })
})

describe('the hold, in words', () => {
  it('says why', () => {
    expect(holdReason({ pubkey: PUBKEY, status: 'unknown', cause: { kind: 'offline' } })).toBe('offline')
    expect(holdReason({ pubkey: PUBKEY, status: 'unknown', cause: { kind: 'unreachable', reason: 'x' } })).toBe('relays did not answer')
    expect(holdReason({ pubkey: PUBKEY, status: 'unknown', cause: { kind: 'refused', url: CANON, reason: 'auth-required: hi' } }))
      .toBe('the relay refused: it wants your signer to log in')
    expect(holdReason({ pubkey: PUBKEY, status: 'checking' })).toBe('checking the relays')
  })

  it('passes a refusal it has no plainer words for through as given', () => {
    expect(refusalText('restricted: members only')).toBe('restricted: members only')
  })
})

describe('the chain status under the switch', () => {
  const base: StatusFacts = { live: true, held: false, conflict: false, waiting: 0, online: true, relayUp: true }

  it('reports nothing when what is waiting can leave, or LOCAL is keeping it here', () => {
    expect(chainStatusOf(base)).toBeNull()
    expect(chainStatusOf({ ...base, waiting: 2 })).toBeNull()
    expect(chainStatusOf({ ...base, online: false, relayUp: false })).toBeNull()
    expect(chainStatusOf({ ...base, live: false, waiting: 3, online: false, relayUp: false })).toBeNull()
  })

  it('reports a LIVE queue that cannot leave, and why', () => {
    const offline = chainStatusOf({ ...base, waiting: 3, online: false, relayUp: false })!
    expect(offline).toEqual({ kind: 'waiting', count: 3, why: 'offline' })
    expect(chainStatusLabel(offline, null)).toBe('3 WAITING · OFFLINE')
    const norelay = chainStatusOf({ ...base, waiting: 1, relayUp: false })!
    expect(chainStatusLabel(norelay, null)).toBe('1 WAITING · NO RELAY')
  })

  it('puts a conflict over a hold, and a hold over either setting', () => {
    expect(chainStatusOf({ ...base, held: true, conflict: true })).toEqual({ kind: 'conflict' })
    expect(chainStatusOf({ ...base, held: true, waiting: 4, online: false })).toEqual({ kind: 'held' })
    expect(chainStatusOf({ ...base, live: false, held: true })).toEqual({ kind: 'held' })
  })

  it('names the hold\'s cause in the label', () => {
    const held = { kind: 'held' } as const
    expect(chainStatusLabel(held, { pubkey: PUBKEY, status: 'unknown', cause: { kind: 'offline' } })).toBe('HELD · OFFLINE')
    expect(chainStatusLabel(held, { pubkey: PUBKEY, status: 'unknown', cause: { kind: 'unreachable', reason: 'x' } })).toBe('HELD · NO ANSWER')
    expect(chainStatusLabel(held, { pubkey: PUBKEY, status: 'unknown', cause: { kind: 'refused', url: CANON, reason: 'auth-required: x' } })).toBe('HELD · RELAY REFUSED')
    expect(chainStatusLabel(held, { pubkey: PUBKEY, status: 'checking' })).toBe('HELD · CHECKING')
  })
})

describe('a held chain against a relay chain', () => {
  const relaySpawn = spawn(hex(10), 100)
  const relayChain = [relaySpawn, hop(hex(11), relaySpawn.id, relaySpawn.id, 110)]
  const localSpawn = spawn(hex(20), 500)
  const localChain = [localSpawn, hop(hex(21), localSpawn.id, localSpawn.id, 510), hop(hex(22), hex(21), localSpawn.id, 520)]

  it('summarizes each chain from its newest spawn', () => {
    const s = summarizeChain(relayChain)!
    expect(s).toMatchObject({ startedAt: 100, actions: 2, lastActive: 110, spawnId: relaySpawn.id, headId: hex(11) })
    expect(s.sector).toMatch(/\d/)
    expect(summarizeChain([])).toBeNull()
  })

  it('lets the local chain be kept only when its spawn is the newer one', () => {
    expect(localSupersedes(localChain, relayChain)).toBe(true)
    // The relay chain respawned after the local one was started.
    expect(localSupersedes(localChain, [...relayChain, spawn(hex(30), 900)])).toBe(false)
  })

  it('raises a conflict on a relay chain, grows it, and ignores what is no chain or nothing new', () => {
    const first = foldHeldConflict(null, [relaySpawn], localChain, 1000)
    expect(first).toEqual({ kind: 'held', relayEvents: [relaySpawn], at: 1000 })
    const grown = foldHeldConflict(first, relayChain, localChain, 2000)
    expect(grown?.relayEvents).toHaveLength(2)
    expect(grown?.at).toBe(1000)
    expect(foldHeldConflict(grown, relayChain, localChain, 3000)).toBe(grown)
    expect(foldHeldConflict(null, [hop(hex(40), hex(41), hex(41), 1)], localChain, 1)).toBeNull()
    // Our own events coming back are not a rival chain.
    expect(foldHeldConflict(null, localChain, localChain, 1)).toBeNull()
  })
})
