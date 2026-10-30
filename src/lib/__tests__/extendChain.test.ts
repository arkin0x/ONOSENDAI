/**
 * extendChain.test.ts - a chain grown by one event reads exactly as the whole
 * chain built again would (arkinox, 2026-10-30: WALK steps took 2 to 6 s,
 * most of it rebuilding a 1,300-action chain on every action).
 *
 * extendChain is only allowed to answer when its answer is buildChain's, so
 * every case here compares the two, event by event, in the order the events
 * arrive; and the cases where only a whole build can know (a fork, a respawn,
 * an event that arrived before the one it follows, a break) must answer null.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { buildChain, extendChain, positionHex, spawnTemplate, type ActionEvent, type NostrEvent } from '../events'
import type { Position } from '../space'
import { actionEvent, enterVirtualEvent, exitVirtualEvent, hopEvent, nextId, virtualEvent } from './chainFixtures'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const spawn = finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent
const home = coordToXyz(hexToCoord(pk))
const plane = home.plane
const GAME = 'ab'.repeat(32)
const at = (dx: bigint): Position => ({ x: home.x + dx, y: home.y, z: home.z })
const hexAt = (p: Position): string => positionHex(p, plane)

/** spawn, then `n` hops along x, from `t0`. */
function hops(n: number, t0 = 1_010, from: NostrEvent[] = [spawn]): NostrEvent[] {
  const out = from.slice()
  for (let i = 0; i < n; i++) {
    const k = out.length
    out.push(hopEvent({ pubkey: pk, createdAt: t0 + k, genesisId: spawn.id, previousId: out[k - 1].id, c: k === 1 ? pk : hexAt(at(BigInt(k - 1))), to: at(BigInt(k)), plane }))
  }
  return out
}

/**
 * Feed `events` one at a time, as they arrive. For each, extendChain's
 * answer, when it gives one, must be what buildChain gives for everything so
 * far. Returns the answers: 'ext' (grown by one), 'same' (left as it was) or
 * 'null' (the caller builds it whole).
 */
function feed(events: NostrEvent[]): string[] {
  const answers: string[] = []
  let chain: ActionEvent[] = buildChain(events.slice(0, 1))
  for (let k = 1; k < events.length; k++) {
    const whole = buildChain(events.slice(0, k + 1))
    const grown = extendChain(chain, events.slice(0, k), events[k])
    if (grown !== null) expect(grown).toEqual(whole)
    answers.push(grown === null ? 'null' : grown === chain ? 'same' : 'ext')
    chain = whole
  }
  return answers
}

describe('extendChain', () => {
  it('grows a plain chain one hop at a time, exactly as buildChain reads it', () => {
    expect(feed(hops(30))).toEqual(Array(30).fill('ext'))
  })

  it('reads a game bracket the same way: the enter, the game\'s moves, the exit', () => {
    const base = hops(2)
    const P2 = hexAt(at(2n))
    const arena: Position = { x: (5n << 40n) + 300n, y: (7n << 40n) + 20n, z: (9n << 40n) + 3n }
    const enter = enterVirtualEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: base[2].id, c: P2, inGame: arena, height: 8, game: GAME, plane })
    const move = virtualEvent({ pubkey: pk, createdAt: 1_021, genesisId: spawn.id, previousId: enter.id, name: 'move', c: hexAt(arena), inGame: { ...arena, x: arena.x + 5n }, plane })
    const exit = exitVirtualEvent({ pubkey: pk, createdAt: 1_022, genesisId: spawn.id, previousId: move.id, entryId: enter.id, c: hexAt({ ...arena, x: arena.x + 5n }), restore: at(2n), plane })
    const after = hopEvent({ pubkey: pk, createdAt: 1_023, genesisId: spawn.id, previousId: exit.id, c: P2, to: at(3n), plane })
    const answers = feed([...base, enter, move, exit, after])
    expect(answers.slice(2)).toEqual(['ext', 'ext', 'ext', 'ext'])
  })

  it('reads an action this client does not recognize as buildChain does (skipped, still a link)', () => {
    const base = hops(2)
    const wave = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: base[2].id, name: 'wave', c: hexAt(at(2n)), C: at(2n), plane })
    const next = hopEvent({ pubkey: pk, createdAt: 1_021, genesisId: spawn.id, previousId: wave.id, c: hexAt(at(2n)), to: at(3n), plane })
    expect(feed([...base, wave, next]).slice(2)).toEqual(['ext', 'ext'])
  })

  it('leaves the chain as it is for an event of another chain', () => {
    const base = hops(3)
    const stray = actionEvent({ pubkey: pk, createdAt: 1_020, genesisId: 'f'.repeat(64), previousId: base[3].id, name: 'hop' })
    expect(feed([...base, stray]).at(-1)).toBe('same')
  })

  it('answers null for a respawn: it can be the newest spawn', () => {
    const respawn = finalizeEvent(spawnTemplate(pk, 2_000), sk) as NostrEvent
    expect(feed([...hops(3), respawn]).at(-1)).toBe('null')
  })

  it('answers null for a second event naming a row that already has a next one: a fork, and the chain is dead', () => {
    const base = hops(4)
    const rival = hopEvent({ pubkey: pk, createdAt: 1_030, genesisId: spawn.id, previousId: base[2].id, c: hexAt(at(2n)), to: at(9n), plane })
    expect(feed([...base, rival]).at(-1)).toBe('null')
    expect(buildChain([...base, rival])[0].fork).toBeDefined()
  })

  it('answers null when an event already here follows the new one: the walk goes on through it', () => {
    const base = hops(3)
    const [a, b] = hops(2, 1_020, base).slice(-2)
    // b arrived first, naming a, which arrives next. extendChain declines b
    // too (it names no row it knows), and must decline a.
    const answers = feed([...base, b, a])
    expect(answers.slice(-2)).toEqual(['null', 'null'])
    expect(buildChain([...base, b, a]).length).toBe(base.length + 2)
  })

  it('answers null on a chain that is already broken, and for a row that breaks', () => {
    const base = hops(2)
    // Sector tags that disagree with its C: a break (spec §10).
    const bad = hopEvent({ pubkey: pk, createdAt: 1_020, genesisId: spawn.id, previousId: base[2].id, c: hexAt(at(2n)), to: at(3n), plane })
    bad.tags = bad.tags.map((t) => (t[0] === 'X' ? ['X', '1'] : t))
    bad.id = nextId()
    const after = hopEvent({ pubkey: pk, createdAt: 1_021, genesisId: spawn.id, previousId: bad.id, c: hexAt(at(3n)), to: at(4n), plane })
    expect(buildChain([...base, bad]).at(-1)?.breaks).toBeTruthy()
    expect(feed([...base, bad, after]).slice(-2)).toEqual(['null', 'null'])
  })

  it('answers null for anything but an action, and for an empty chain', () => {
    expect(extendChain([], [], hops(1)[1])).toBeNull()
    const note = { ...hops(1)[1], kind: 1, id: nextId() }
    expect(extendChain(buildChain(hops(1)), hops(1), note)).toBeNull()
  })
})
