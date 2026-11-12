/**
 * chainStop.test.ts: where your chain stops, by the relay's rules, app-wide
 * (the owner's ruling of 2026-11-12). The owner's real chain (spawn through
 * 2026-09-04) stops at its version 1 sidestep: the chip says 2026-09-04 and
 * offers RESPAWN. A clean chain, and one whose version 1 hops are all on the
 * 5.13 list, say nothing. A hop above the relay's ceiling is said without a
 * RESPAWN. While the list loads, nothing is said at all. And a long chain is
 * read once, then only its new rows.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildChain, type ActionEvent, type NostrEvent } from '../events'
import { loadV1HopList } from '../v1HopList'
import { chainStopOf, needsRespawn, resetChainStops, respawnPointOf, setV1HopListForTests } from '../chainStop'
import { relayStopWords, stopDay } from '../chainBreak'
import { RELAY_MAX_HOP_HEIGHT } from '../relayPlacement'
import owner from './vectors/owner-chain-e8ed3798-through-2026-09-04.json'

const OWNER = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const EVENT_22 = 'daf160627616b019dff4d1363e510b09bde200894b1aba8eb1bc9e5e9b2bce64'
const V1_SIDESTEP = 'd334293bb26271aead7efa4b814d1564f192485cf0698dc618fbe31923f30355'
const ownerChain = buildChain(owner as NostrEvent[], OWNER)

/** A stand-in row: only the fields the scan reads. */
function move(id: string, type: string, extra: Partial<ActionEvent> = {}): ActionEvent {
  return { id, type, coordHex: id.padEnd(64, '0'), role: 'base', createdAt: 1_790_000_000, ...extra } as unknown as ActionEvent
}
const V2 = { mn: '0'.repeat(16), mp: 'ab' }
const at = (x: bigint): ActionEvent['position'] => ({ x, y: 0n, z: 0n })

beforeEach(() => resetChainStops())

describe("the owner's chain", () => {
  it('stops at the version 1 sidestep of 2026-09-04: CHAIN STOPS AT 2026-09-04, with a respawn, and an apology (valid when signed)', async () => {
    setV1HopListForTests(await loadV1HopList())
    const stop = chainStopOf(ownerChain)
    expect(stop?.source).toBe('relay')
    if (stop?.source !== 'relay') return
    expect(stop.stop).toMatchObject({ index: 23, kind: 'broken', rule: 'v1-sidestep' })
    expect(stop.stop.action.id).toBe(V1_SIDESTEP)
    expect(stop.stop.lastValid?.id).toBe(EVENT_22)
    expect(stopDay(stop.stop)).toBe('2026-09-04')
    const w = relayStopWords(stop.stop)
    expect(w.chip).toBe('CHAIN STOPS AT 2026-09-04')
    expect(w.chipMeta).toBe('TAP FOR WHY AND RESPAWN')
    expect(w.sorry).toBe('It was valid when you signed it. The rules changed on 2026-09-07. Sorry.')
    expect(needsRespawn(stop)).toBe(true)
    expect(respawnPointOf(ownerChain)?.id).toBe(EVENT_22)
  })

  it('while the 5.13 list loads: undefined, never a verdict the list would take back', () => {
    expect(chainStopOf(ownerChain)).toBeUndefined()
    expect(respawnPointOf(ownerChain)).toBeNull()
  })

  it('the list arriving finishes the same scan from the hop it waited at', async () => {
    expect(chainStopOf(ownerChain)).toBeUndefined()
    setV1HopListForTests(await loadV1HopList())
    const stop = chainStopOf(ownerChain)
    expect(stop?.source === 'relay' && stop.stop.index).toBe(23)
  })

  it('its version 1 hops are all on the 5.13 list: up to the sidestep, the chain is fine', async () => {
    setV1HopListForTests(await loadV1HopList())
    expect(chainStopOf(ownerChain.slice(0, 23), 'cut')).toBeNull()
  })
})

describe('chainStopOf', () => {
  const spawn = move('c0', 'spawn')

  it('a clean chain: nothing', () => {
    expect(chainStopOf([spawn, move('c1a', 'hop', V2), move('c1b', 'sidestep', { mn: '1'.repeat(16) }), move('c1c', 'hyperjump', { mn: '2'.repeat(16) })])).toBeNull()
  })

  it('a version 1 hop on the 5.13 list is fine; one not on it stops the chain', () => {
    setV1HopListForTests(new Set(['c2listed']))
    expect(chainStopOf([spawn, move('c2listed', 'hop'), move('c2b', 'hop', V2)])).toBeNull()
    const stop = chainStopOf([spawn, move('c2listed', 'hop'), move('c2unlisted', 'hop')])
    expect(stop?.source === 'relay' && stop.stop).toMatchObject({ index: 2, kind: 'broken', rule: 'v1-hop' })
  })

  it('a hop with one of mn and mp, a sidestep or a ride with no mn on no list: each stops it', () => {
    setV1HopListForTests(new Set())
    expect(chainStopOf([spawn, move('c3a', 'hop', { mn: '0'.repeat(16) })], 'a')).toMatchObject({ source: 'relay', stop: { rule: 'partial-hop' } })
    expect(chainStopOf([spawn, move('c3b', 'sidestep')], 'b')).toMatchObject({ source: 'relay', stop: { rule: 'v1-sidestep' } })
    expect(chainStopOf([spawn, move('c3c', 'hyperjump')], 'c')).toMatchObject({ source: 'relay', stop: { rule: 'v1-ride' } })
  })

  it(`a hop above h${RELAY_MAX_HOP_HEIGHT}: said, the relay's ceiling, and no respawn`, () => {
    const chain = [move('c4s', 'spawn', { position: at(0n) }), move('c4a', 'hop', { ...V2, position: at(1n << 30n), createdAt: 1_793_000_000 })]
    const stop = chainStopOf(chain)
    expect(stop?.source === 'relay' && stop.stop.kind).toBe('tall')
    expect(needsRespawn(stop)).toBe(false)
    expect(respawnPointOf(chain)).toBeNull()
    if (stop?.source !== 'relay') return
    const w = relayStopWords(stop.stop)
    expect(w.chip).toBe(`RELAY CHECKS HOPS UP TO H${RELAY_MAX_HOP_HEIGHT}`)
    expect(w.chipMeta).toBe('IT READS YOUR CHAIN UP TO 2026-09-21 · NO RESPAWN NEEDED')
    expect(w.chipMeta).not.toMatch(/TAP FOR/)
  })

  it('a structural break after a tall hop still asks for a respawn: the break wins', () => {
    const chain = [move('c5s', 'spawn', { position: at(0n) }), move('c5a', 'hop', { ...V2, position: at(1n << 30n) }), move('c5b', 'hop', { ...V2, position: at(1n << 30n), breaks: 'starts elsewhere' })]
    expect(chainStopOf(chain)?.source).toBe('rules')
    expect(respawnPointOf(chain)?.id).toBe('c5a')
  })

  it('a rejected proof before a structural break is the stop', () => {
    const chain = [spawn, move('c6a', 'sidestep'), move('c6b', 'hop', { ...V2, breaks: 'starts elsewhere' })]
    expect(chainStopOf(chain)).toMatchObject({ source: 'relay', stop: { index: 1 } })
  })

  it('a structural break with the list still loading is said at once', () => {
    const chain = [spawn, move('c7a', 'hop'), move('c7b', 'hop', { ...V2, breaks: 'starts elsewhere' })]
    expect(chainStopOf(chain)?.source).toBe('rules')
  })

  it('the spectated chain is kept apart from your own', () => {
    const mine = [spawn, move('c8a', 'hop', V2)]
    const theirs = [spawn, move('c8b', 'sidestep')]
    expect(chainStopOf(mine)).toBeNull()
    expect(chainStopOf(theirs, 'spectate')?.source).toBe('relay')
    expect(chainStopOf(mine)).toBeNull()
  })
})

describe('a long chain on a phone: read once, then only what is new', () => {
  /** n version 2 hops, one gibson each, with a counter on every read of a row's type. */
  function longChain(n: number, reads: { type: number }): ActionEvent[] {
    const rows: ActionEvent[] = [move('l0', 'spawn', { position: at(0n) })]
    for (let i = 1; i < n; i++) {
      const row = move(`l${i}`, 'hop', { ...V2, position: at(BigInt(i)) }) as ActionEvent & { type: string }
      Object.defineProperty(row, 'type', { get: () => { reads.type++; return 'hop' } })
      rows.push(row)
    }
    return rows
  }

  it('3,000 rows: the first read walks them, a render reads nothing, a new move reads one row', () => {
    const reads = { type: 0 }
    const chain = longChain(3000, reads)
    let t = performance.now()
    expect(chainStopOf(chain)).toBeNull()
    const firstMs = performance.now() - t
    expect(reads.type).toBe(2999)

    reads.type = 0
    t = performance.now()
    for (let i = 0; i < 1000; i++) chainStopOf(chain)
    const sameMs = (performance.now() - t) / 1000
    expect(reads.type).toBe(0)

    const grown = chain.concat([move('l3000', 'hop', { ...V2, position: at(3000n) })])
    reads.type = 0
    t = performance.now()
    expect(chainStopOf(grown)).toBeNull()
    const appendMs = performance.now() - t
    expect(reads.type).toBe(0) // the new row is a plain stand-in; none of the 3,000 before it was read

    const stopped = grown.concat([move('l3001', 'sidestep')])
    expect(chainStopOf(stopped)).toMatchObject({ source: 'relay', stop: { index: 3001 } })
    reads.type = 0
    expect(chainStopOf(stopped.concat([move('l3002', 'hop', V2)]))).toMatchObject({ source: 'relay', stop: { index: 3001 } })
    expect(reads.type).toBe(0)

    console.info(`chainStop 3,000 rows: first read ${firstMs.toFixed(2)} ms, unchanged ${(sameMs * 1000).toFixed(1)} µs, one appended ${appendMs.toFixed(3)} ms`)
    expect(appendMs).toBeLessThan(firstMs + 1)
  })
})
