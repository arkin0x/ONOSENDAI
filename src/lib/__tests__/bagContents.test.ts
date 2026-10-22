/**
 * bagContents.test.ts: a bag's contents and money hints are worked out from
 * what is inside each time it is sealed, so they are never stale (arkinox,
 * 2026-10-18), and read back as they were written.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_BAG_SETTINGS, bagContents, bagContentsTags, bagSettingsOf, readBagContents, resolveBagSettings, type BagEntry } from '../hidden'
import type { NostrEvent } from '../events'

const TOKEN = 'cashuBo2FteBtodHRwczovL21pbnQubWluaWJpdHMuY2FzaC9CaXRjb2luYXVjc2F0YXSBomFpSABQBVDwSUFGYXCBpGFhAmFzeEAzZjNlYTU2YTk3ZjE3MDAxMjZkZjVlZDNlNDNmYjU2NjAzMmQ0YWQyNTNkNmNiODEyZGI0N2E1OTA0MjZmNDVjYWNYIQKr8zhNlxrJ0lMVMXKkXy9Ww7GjPU2LaH3sz5Y1HlgLv2Fko2FlWCCa5DHXKlbV8GLuXtnZsc2vJ8fsoTHpp6W3t3q0B2-ZomFzWCCTJGYFX4d0fwWhP6rgrgIX1xZpCCr0K0jj4Z3vKYIhR2FyWCBqvA'

const ev = (kind: number, content = ''): NostrEvent => ({ id: String(kind).padStart(64, '0'), pubkey: 'p', created_at: 1, kind, tags: [], content, sig: '' })
const ref: BagEntry = ['a', '33331:p:x', '', 'c']
const LINK = `https://nonfungible.cash/claim/${'6f'.repeat(16)}#${'A'.repeat(43)}`
const LINK2 = `https://nonfungible.cash/claim/${'0a'.repeat(16)}#${'B'.repeat(42)}w`

describe('bagContents', () => {
  it('counts shards (in the bag or by reference), messages, keys, chests and cashu tokens', () => {
    const c = bagContents([ev(3330), ref, ev(1, `here ${TOKEN}`), ev(1, 'hi'), ev(3340), ev(3341)])
    expect(c).toEqual({ shard: 2, message: 2, key: 1, chest: 1, cashu: 1, nft: 0 })
  })

  it('counts the nonfungible.cash claim links in messages, each once, and never a look-alike', () => {
    const two = `${LINK} and ${LINK2} and ${LINK} again`
    const c = bagContents([ev(1, two), ev(1, `see ${LINK.split('#')[0]}`), ev(1, `${TOKEN} ${LINK}`)])
    expect(c).toMatchObject({ message: 3, cashu: 1, nft: 3 })
  })
})

describe('bagContentsTags', () => {
  const inners = [ev(3330), ev(3330), ev(3330), ev(1, TOKEN)]
  it('writes nothing unless asked', () => {
    expect(bagContentsTags(inners, DEFAULT_BAG_SETTINGS)).toEqual([])
  })
  it('with contents, a count for every kind inside, cashu included', () => {
    expect(bagContentsTags(inners, { contents: true, money: false })).toEqual([['contents', 'shard', '3'], ['contents', 'message', '1'], ['contents', 'cashu', '1']])
  })
  it('with money alone, only that money is inside, and only while it is', () => {
    expect(bagContentsTags(inners, { contents: false, money: true })).toEqual([['contents', 'cashu']])
    expect(bagContentsTags([ev(3330), ev(1, 'no token here')], { contents: false, money: true })).toEqual([])
  })
  it('with contents, an nft count after cashu, as the cashu count is written', () => {
    expect(bagContentsTags([...inners, ev(1, `for you ${LINK}`)], { contents: true, money: false })).toEqual([['contents', 'shard', '3'], ['contents', 'message', '2'], ['contents', 'cashu', '1'], ['contents', 'nft', '1']])
  })
  it('money alone never says an NFT is inside, and an NFT is not money', () => {
    expect(bagContentsTags([ev(1, LINK)], { contents: false, money: true })).toEqual([])
    expect(bagContentsTags([ev(1, `${TOKEN} ${LINK}`)], { contents: false, money: true })).toEqual([['contents', 'cashu']])
  })
})

describe('readBagContents', () => {
  it('reads back what was written, and a bag that says nothing as nothing', () => {
    expect(readBagContents([['contents', 'shard', '3'], ['contents', 'cashu', '1']])).toEqual({ money: true, moneyAlone: false, nft: false, counts: { shard: 3, cashu: 1 } })
    expect(readBagContents([['contents', 'cashu']])).toEqual({ money: true, moneyAlone: true, nft: false, counts: null })
    expect(readBagContents([['contents', 'gold', '5'], ['contents', 'shard', '-2']])).toEqual({ money: false, moneyAlone: false, nft: false, counts: null })
    expect(readBagContents([['contents', 'message', '1'], ['contents', 'nft', '2']])).toEqual({ money: false, moneyAlone: false, nft: true, counts: { message: 1, nft: 2 } })
    expect(readBagContents([['contents', 'nft']]).nft).toBe(false)
    expect(readBagContents([['contents', 'nft', '0']]).nft).toBe(false)
  })
  it('carries into a bag\'s settings, so a rewrite keeps the choice', () => {
    const bag = { ...ev(33330), tags: [['d', 'x'], ['contents', 'shard', '1']] }
    expect(bagSettingsOf(bag, 3)).toMatchObject({ contents: true, money: false })
  })
})

describe('turning contents off', () => {
  it('does not leave the bag announcing money nobody chose (review of #378)', () => {
    const inners = [ev(3330), ev(1, TOKEN)]
    // Published with contents on: a counted cashu row among the others.
    const published = { ...ev(33330), tags: [['d', 'x'], ...bagContentsTags(inners, { contents: true, money: false })] }
    const current = bagSettingsOf(published, 3)
    expect(current).toMatchObject({ contents: true, money: false })
    // The hider turns contents off; money was never chosen.
    const seed = current
    const chosen = { ...seed, contents: false }
    const next = resolveBagSettings(chosen, seed, current, 3)
    expect(next).toMatchObject({ contents: false, money: false })
    expect(bagContentsTags(inners, next)).toEqual([])
  })
})
