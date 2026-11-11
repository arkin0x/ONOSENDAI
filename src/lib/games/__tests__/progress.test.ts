/**
 * progress.test.ts - the key door and the clock (lib/games/progress.ts):
 * TAKE only within reach and only once, OPEN only with the key and within
 * reach, the key used by the door, the door's looks swapped, the key's look
 * gone once taken, and the clock from the entry to the exit zone.
 */

import { describe, expect, it } from 'vitest'
import { newShard } from 'sno-core/shards'
import { clockMs, formatClearTime, offerAt, openDoor, reachExit, startProgress, takeKey, within, worldNow } from '../progress'
import { withConstrain } from '../../walkConstrain'
import type { WorldShard } from '../play'
import type { GameDef } from '../types'
import type { Position } from '../../space'

const P = (x: number, y: number, z: number): Position => ({ x: BigInt(x), y: BigInt(y), z: BigInt(z) })
const game: Pick<GameDef, 'key' | 'door' | 'exit'> = {
  key: { at: P(10, 10, 10) },
  door: { at: P(30, 0, 30) },
  exit: { lo: P(50, 1, 50), hi: P(52, 2, 52) },
}

describe('the key door', () => {
  it('offers TAKE by the key, OPEN or LOCKED by the door, and nothing elsewhere', () => {
    const pr = startProgress(0)
    expect(offerAt(game, pr, P(10, 11, 10))).toBe('take')
    expect(offerAt(game, pr, P(12, 13, 8))).toBe('take')
    expect(offerAt(game, pr, P(13, 11, 10))).toBeNull()
    expect(offerAt(game, pr, P(30, 1, 33))).toBe('locked')
    expect(offerAt(game, { ...pr, keyHeld: true }, P(30, 1, 33))).toBe('open')
    expect(offerAt(game, pr, P(30, 1, 34))).toBeNull()
    expect(within(P(10, 11, 10), game.key!.at, 0)).toBe(true)
  })

  it('takes the key once, within reach; opens the door with it and uses it', () => {
    const pr = startProgress(0)
    expect(takeKey(game, pr, P(20, 11, 20))).toBeNull()
    const held = takeKey(game, pr, P(10, 11, 11))!
    expect(held.keyHeld).toBe(true)
    expect(takeKey(game, held, P(10, 11, 11))).toBeNull()
    expect(openDoor(game, pr, P(30, 1, 31))).toBeNull()
    expect(openDoor(game, held, P(40, 1, 40))).toBeNull()
    const open = openDoor(game, held, P(30, 1, 31))!
    expect(open).toMatchObject({ keyHeld: false, doorOpen: true })
    // Once used, the key is not back where it lay, and the door offers nothing more.
    expect(offerAt(game, open, P(10, 11, 10))).toBeNull()
    expect(offerAt(game, open, P(30, 1, 31))).toBeNull()
  })

  it('draws the key until taken, and the door shut or open: the closed look holds a walker, the open look does not', () => {
    const shard = (name: string, c: 'all' | 'off') => withConstrain({ ...newShard(name), mode: 'solid' as const }, c)
    const w = (key: string, at: Position, c: 'all' | 'off'): WorldShard => ({ key, at, height: 6, shard: shard(key, c) })
    const world = [w('wall', P(0, 0, 0), 'all'), w('key', game.key!.at, 'off'), w('shut', game.door!.at, 'all'), w('open', game.door!.at, 'off')]
    const names = (pr: ReturnType<typeof startProgress>) => worldNow(game, world, pr).solid.map((s) => s.key)
    const pr = startProgress(0)
    expect(names(pr)).toEqual(['wall', 'key', 'shut'])
    expect(names({ ...pr, keyHeld: true })).toEqual(['wall', 'shut'])
    expect(names({ ...pr, doorOpen: true })).toEqual(['wall', 'open'])
  })
})

describe('the clock', () => {
  it('runs from the entry and stops once, at the exit zone', () => {
    const pr = startProgress(1000)
    expect(clockMs(pr, 4500)).toBe(3500)
    expect(reachExit(game, pr, P(49, 1, 50), 5000)).toBe(pr)
    const done = reachExit(game, pr, P(51, 2, 52), 62_300)
    expect(done.clearedMs).toBe(61_300)
    expect(clockMs(done, 99_999)).toBe(61_300)
    expect(reachExit(game, done, P(51, 1, 51), 70_000)).toBe(done)
    // Nothing more is offered once cleared.
    expect(offerAt(game, done, P(10, 11, 10))).toBeNull()
  })

  it('is shown as M:SS.t', () => {
    expect(formatClearTime(0)).toBe('0:00.0')
    expect(formatClearTime(61_349)).toBe('1:01.3')
    expect(formatClearTime(9 * 60_000 + 59_999)).toBe('9:59.9')
    expect(formatClearTime(-5)).toBe('0:00.0')
  })
})
