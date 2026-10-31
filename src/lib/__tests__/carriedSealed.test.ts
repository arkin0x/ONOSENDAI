/**
 * carriedSealed.test.ts: what came to you sealed stays out of what you publish
 * (review of #544; DECK-0003 §1.10). A model taken from a bag or a chest carries its
 * parts re-keyed to you, for hiding again, with a local mark. A PUBLISH or an avatar
 * sends it without them unless you said otherwise.
 */
import { describe, expect, it } from 'vitest'
import { newShard, normalizeStored, toPayload, type ShardModel } from 'sno-core/shards'
import { carriesSealedParts, rekeyCarried, takeIntoKeeping, withoutCarried } from '../carried'

const HIDER = 'a'.repeat(64)
const ME = 'b'.repeat(64)
const PUBLIC = `33331:${'c'.repeat(64)}:public`

function carrying(): ShardModel {
  const piece = `33331:${HIDER}:piece`
  return {
    ...newShard('Statue'),
    author: HIDER,
    refs: [['a', piece], ['a', PUBLIC, 'wss://r.test']],
    parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }, { ref: 1, at: [120, 0, 0], turn: [0, 0, 0], step: 0 }],
    objects: { [piece]: { v: 2, name: 'Piece' } },
  }
}

describe('taken from a bag', () => {
  it('is re-keyed and marked; your own table keeps its keys, and is marked too', () => {
    const out = takeIntoKeeping(carrying(), ME)
    expect(carriesSealedParts(out)).toBe(true)
    expect(Object.keys(out.objects!)[0].startsWith(`33331:${ME}:`)).toBe(true)
    const mine = { ...carrying(), author: ME, objects: { [`33331:${ME}:piece`]: {} } }
    expect(rekeyCarried(mine, ME)).toBe(mine)
    expect(carriesSealedParts(takeIntoKeeping(mine, ME))).toBe(true)
  })

  it('a model carrying nothing is not marked', () => {
    expect(carriesSealedParts(takeIntoKeeping(newShard('Plain'), ME))).toBe(false)
  })

  it('the mark never reaches the wire, and survives the workshop’s storage', () => {
    const out = takeIntoKeeping(carrying(), ME)
    expect(JSON.stringify(toPayload(out))).not.toContain('takenFromBag')
    expect(carriesSealedParts(normalizeStored(JSON.parse(JSON.stringify(out))))).toBe(true)
  })
})

describe('going out in public', () => {
  it('leaves the table and the placements that drew on it; a public object stays, renumbered', () => {
    const out = withoutCarried(takeIntoKeeping(carrying(), ME))
    expect(out.objects).toBeUndefined()
    expect(out.refs).toEqual([['a', PUBLIC, 'wss://r.test']])
    expect(out.parts).toEqual([{ ref: 0, at: [120, 0, 0], turn: [0, 0, 0], step: 0 }])
    expect(JSON.stringify(toPayload(out))).not.toContain('piece')
    expect(carriesSealedParts(out)).toBe(false)
  })

  it('touches nothing unmarked: your own build carrying your own pieces', () => {
    const own = { ...carrying(), author: ME }
    expect(withoutCarried(own)).toBe(own)
  })
})
