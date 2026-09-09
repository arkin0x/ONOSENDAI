import { describe, expect, it } from 'vitest'
import { facingPair } from './facing'

const chain = ['spawn', 'a', 'b', 'c', 'd']

describe('which move the avatar faces', () => {
  it('at the head, the last move', () => {
    expect(facingPair(chain, null)).toEqual(['c', 'd'])
  })

  it('while scrubbing, the move that arrived at the link on show', () => {
    expect(facingPair(chain, 2)).toEqual(['a', 'b'])
    expect(facingPair(chain, 1)).toEqual(['spawn', 'a'])
  })

  it('at the spawn, the first move out', () => {
    expect(facingPair(chain, 0)).toEqual(['spawn', 'a'])
  })

  it('past the end it is the head; a chain of one faces nothing', () => {
    expect(facingPair(chain, 99)).toEqual(['c', 'd'])
    expect(facingPair(['spawn'], null)).toBeNull()
    expect(facingPair(['spawn'], 0)).toBeNull()
  })
})
