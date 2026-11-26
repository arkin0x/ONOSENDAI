/**
 * sealedAt.test.ts: time as a block ("Sealed at block 975,410 · 2 days
 * ago"): the block reckoned back from the newest one known at ten minutes a
 * block, and plain time alone before a block is known.
 */
import { describe, expect, it } from 'vitest'
import { BLOCK_SECONDS, blockWords, sealedBlock, sealedWords } from '../sealedAt'

const NOW = 1_800_000_000

describe('sealed at a block', () => {
  it('reckons the block back from the tip at ten minutes a block', () => {
    expect(BLOCK_SECONDS).toBe(600)
    expect(sealedBlock(NOW, 975_420, NOW)).toBe(975_420)
    expect(sealedBlock(NOW - 7200, 975_420, NOW)).toBe(975_408)
    expect(sealedBlock(NOW - 599, 975_420, NOW)).toBe(975_420)
    // A clock a little behind the event is not a block in the future.
    expect(sealedBlock(NOW + 900, 975_420, NOW)).toBe(975_420)
  })

  it('knows no block without a tip or a time', () => {
    expect(sealedBlock(NOW, null, NOW)).toBeNull()
    expect(sealedBlock(undefined, 975_420, NOW)).toBeNull()
  })

  it('says it in plain words', () => {
    expect(blockWords(975410)).toBe('975,410')
    expect(sealedWords(NOW - 7200, 975_420, NOW)).toBe('Sealed at block 975,408 · 2 h ago')
    expect(sealedWords(NOW - 7200, null, NOW)).toBe('Sealed 2 h ago')
    expect(sealedWords(undefined, 975_420, NOW)).toBe('')
    expect(sealedWords(NOW - 7200, 975_420, NOW)).not.toMatch(/—/)
  })
})
