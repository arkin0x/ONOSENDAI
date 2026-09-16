import { describe, expect, it } from 'vitest'
import { AVATAR_KIND, SPECTATOR_SCALE_MIN_EXP, avatarFromEvent, avatarScale, avatarTemplate, spectatorScale } from './avatar'
import { newShard, ticksOf } from 'sno-core/shards'

const built = () => {
  const s = newShard('me')
  s.name = 'Arches'
  s.vertices = [{ p: [0, 0, 0], c: [0, 0.9, 1] }, { p: [1, 0, 0], c: [0, 0.9, 1] }, { p: [0, 1, 0], c: [0, 0.9, 1] }]
  s.faces = [[0, 1, 2]]
  s.mode = 'solid'
  return s
}

describe('avatar events (kind 11333)', () => {
  it('writes the shard as a replaceable event and reads it back', () => {
    const shard = built()
    const t = avatarTemplate(shard, 1700000000)
    expect(t.kind).toBe(AVATAR_KIND)
    // No `d`: replaceable kinds have no second key (spec 8.10).
    expect(t.tags).toEqual([['name', 'Arches']])
    const back = avatarFromEvent({ ...t, pubkey: 'ab'.repeat(32) })!
    expect(back.name).toBe('Arches')
    expect(back.vertices.map((v) => ticksOf(v).join())).toEqual(shard.vertices.map((v) => ticksOf(v).join()))
    expect(back.faces).toEqual([[0, 1, 2]])
    expect(back.id).toBe('avatar:' + 'ab'.repeat(32))
  })
  it('an empty content means the dodecahedron, and other kinds are not avatars', () => {
    const none = avatarTemplate(null, 1)
    expect(none.content).toBe('')
    expect(avatarFromEvent({ ...none, pubkey: 'x' })).toBeNull()
    expect(avatarFromEvent({ kind: 3330, pubkey: 'x', tags: [], content: '{}' })).toBeNull()
    expect(avatarFromEvent({ kind: AVATAR_KIND, pubkey: 'x', tags: [], content: 'not json' })).toBeNull()
  })
  it('draws at true scale: a gibson on the bench is a cell, whatever the grid size', () => {
    const shard = built()
    shard.extent = 8
    expect(avatarScale(shard)).toBe(1)
    // A unit of four gibsons draws four cells wide per unit.
    shard.unit = 2
    expect(avatarScale(shard)).toBe(4)
  })
  it('shrinks a shard that would reach past four cells', () => {
    const shard = built()
    shard.vertices.push({ p: [16, 0, 0], c: [1, 1, 1] })
    expect(avatarScale(shard)).toBe(0.25)
  })
})

describe('spectatorScale', () => {
  it('changes nothing below the spectator range', () => {
    // The avatar filling its cell is right everywhere you can actually move:
    // the cell is the unit, so a marker that fills it says "here" exactly.
    for (const exp of [0, 1, 33, 60, 79, SPECTATOR_SCALE_MIN_EXP]) {
      expect(spectatorScale(exp)).toBe(1)
    }
  })

  it('halves with every step out above it, so the avatar holds its size in gibsons', () => {
    expect(spectatorScale(81)).toBe(1 / 2)
    expect(spectatorScale(82)).toBe(1 / 4)
    expect(spectatorScale(83)).toBe(1 / 8)
    expect(spectatorScale(84)).toBe(1 / 16)
  })

  it('leaves the avatar a thirty-second of cyberspace across at full zoom out', () => {
    // Cyberspace is 2^85 gibsons a side, so a cell at 2^84 is half of it per
    // axis: an eighth by volume, which is what an unscaled avatar was filling.
    const cellsAcrossCyberspace = 2 ** 85 / 2 ** 84
    const avatarCells = spectatorScale(84)
    expect(cellsAcrossCyberspace).toBe(2)
    expect(avatarCells / cellsAcrossCyberspace).toBe(1 / 32)
  })

  it('never reaches zero, so the avatar is always something', () => {
    expect(spectatorScale(84)).toBeGreaterThan(0)
  })
})
