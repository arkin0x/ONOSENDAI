/**
 * runLevel.test.ts - which world shards DRONE RUN draws (runLevel.ts
 * drawnWorld): every one but the entry marker, the world's first item
 * standing exactly at the entry point.
 */

import { describe, expect, it } from 'vitest'
import { DRONE_RUN_GAME } from '../../../lib/games/droneRun/game'
import { worldFromLevel } from '../../../lib/games/droneRun/level/levelWorld'
import { placeholderField } from '../../../lib/games/droneRun/level/placeholderField'
import { drawnWorld } from '../runLevel'

const field = placeholderField()
const world = worldFromLevel(DRONE_RUN_GAME, 'test', field.level, field.payloads)

describe('drawnWorld', () => {
  it('leaves out the entry marker of a level\'s world, and only it', () => {
    const drawn = drawnWorld(world.shards, world.entry)
    expect(world.shards[0].key).toBe('test:entry')
    expect(drawn.length).toBe(world.shards.length - 1)
    expect(drawn.some((w) => w.key === 'test:entry')).toBe(false)
    expect(drawn).toEqual(world.shards.slice(1))
  })

  it('keeps the first item when it does not stand at the entry point', () => {
    const away = { ...world.entry, z: world.entry.z + 1n }
    expect(drawnWorld(world.shards, away)).toEqual(world.shards)
  })

  it('keeps everything with no entry point, and a piece at the entry that is not first', () => {
    expect(drawnWorld(world.shards, null)).toEqual(world.shards)
    const rest = world.shards.slice(1)
    const moved = [rest[0], { ...rest[1], at: world.entry }, ...rest.slice(2)]
    expect(drawnWorld(moved, world.entry)).toEqual(moved)
  })

  it('never changes the world it is handed', () => {
    const before = [...world.shards]
    drawnWorld(world.shards, world.entry)
    expect(world.shards).toEqual(before)
  })
})
