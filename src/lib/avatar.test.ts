import { describe, expect, it } from 'vitest'
import { AVATAR_KIND, avatarFromEvent, avatarScale, avatarTemplate } from './avatar'
import { newShard, ticksOf } from './shards'

const built = () => {
  const s = newShard('me')
  s.name = 'Arches'
  s.vertices = [{ p: [0, 0, 0], c: [0, 0.9, 1] }, { p: [1, 0, 0], c: [0, 0.9, 1] }, { p: [0, 1, 0], c: [0, 0.9, 1] }]
  s.faces = [[0, 1, 2]]
  s.mode = 'solid'
  return s
}

describe('avatar events (kind 33331)', () => {
  it('writes the shard as an addressable event and reads it back', () => {
    const shard = built()
    const t = avatarTemplate(shard, 1700000000)
    expect(t.kind).toBe(AVATAR_KIND)
    expect(t.tags).toEqual([['d', 'avatar'], ['name', 'Arches']])
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
    expect(avatarFromEvent({ kind: 3330, pubkey: 'x', tags: [['d', 'avatar']], content: '{}' })).toBeNull()
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
