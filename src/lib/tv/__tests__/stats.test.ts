/**
 * stats.test.ts: the ticker's numbers are as of the moment on tape.
 */
import { describe, expect, it } from 'vitest'
import { chainLengthAt, countTo } from '../stats'

describe('countTo', () => {
  it('counts the times at or before t', () => {
    expect(countTo([], 5)).toBe(0)
    expect(countTo([1, 2, 2, 5, 9], 2)).toBe(3)
    expect(countTo([1, 2, 2, 5, 9], 0)).toBe(0)
    expect(countTo([1, 2, 2, 5, 9], 100)).toBe(5)
  })
})

describe('chainLengthAt', () => {
  it('counts from the latest spawn at or before t, the spawn included', () => {
    const c = { spawns: [10, 100], actions: [10, 20, 30, 100, 110, 120] }
    expect(chainLengthAt(c, 5)).toBe(0)
    expect(chainLengthAt(c, 25)).toBe(2)
    expect(chainLengthAt(c, 99)).toBe(3)
    // A respawn starts a new chain.
    expect(chainLengthAt(c, 115)).toBe(2)
  })
})
