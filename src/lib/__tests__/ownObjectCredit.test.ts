/** OPEN IN WORKSHOP on your own remix keeps its upstream credit (review of snocrash #35, 2026-10-15). */
import { describe, expect, it } from 'vitest'
import { ownObjectCredit } from '../published'

const me = 'a'.repeat(64)
const them = 'b'.repeat(64)

describe('the credit your own object carries back into the workshop', () => {
  it('keeps the original author a remix of yours was published with, relay included', () => {
    expect(ownObjectCredit([['d', 'x'], ['q', `33331:${them}:orig`, 'wss://r.example'], ['p', them]], me))
      .toEqual({ address: `33331:${them}:orig`, relay: 'wss://r.example' })
  })
  it('is nothing for an original of yours, or a credit to yourself', () => {
    expect(ownObjectCredit([['d', 'x']], me)).toBeUndefined()
    expect(ownObjectCredit([['q', `33331:${me}:older`]], me)).toBeUndefined()
  })
})
