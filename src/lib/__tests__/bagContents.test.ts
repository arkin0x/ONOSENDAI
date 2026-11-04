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
    expect(c).toEqual({ shard: 2, message: 2, key: 1, chest: 1, cashu: 1, nft: 0, audio: 0, door: 0 })
  })

  it('counts the nonfungible.cash claim links in messages, each once, and never a look-alike', () => {
    const two = `${LINK} and ${LINK2} and ${LINK} again`
    const c = bagContents([ev(1, two), ev(1, `see ${LINK.split('#')[0]}`), ev(1, `${TOKEN} ${LINK}`)])
    expect(c).toMatchObject({ message: 3, cashu: 1, nft: 3 })
  })

  it('does not count a link inside another URL\'s path or query (spec 7.7)', () => {
    expect(bagContents([ev(1, `https://a.example/?b=1;${LINK}`)])).toMatchObject({ message: 1, nft: 0 })
    expect(bagContents([ev(1, `${LINK},${LINK2}`)])).toMatchObject({ message: 1, nft: 2 })
    expect(bagContentsTags([ev(1, `https://a.example/?b=1;${LINK}`)], { contents: true, money: false })).toEqual([['contents', 'message', '1']])
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
    expect(readBagContents([['contents', 'shard', '3'], ['contents', 'cashu', '1']])).toEqual({ money: true, moneyAlone: false, nft: false, counts: { shard: '3', cashu: '1' } })
    expect(readBagContents([['contents', 'cashu']])).toEqual({ money: true, moneyAlone: true, nft: false, counts: null })
    expect(readBagContents([['contents', 'gold', '5'], ['contents', 'shard', '-2']])).toEqual({ money: false, moneyAlone: false, nft: false, counts: null })
    expect(readBagContents([['contents', 'message', '1'], ['contents', 'nft', '2']])).toEqual({ money: false, moneyAlone: false, nft: true, counts: { message: '1', nft: '2' } })
    expect(readBagContents([['contents', 'nft']]).nft).toBe(false)
    expect(readBagContents([['contents', 'nft', '0']]).nft).toBe(false)
  })
  // Spec 7.7 "Reading contents": a row whose count is there but is not a positive integer is ignored.
  it('reads money only from a counted cashu row or the cashu row with no count', () => {
    for (const count of ['0', '00', '-1', 'x', '', ' 1', '1.5', 'NaN', 'Infinity']) {
      expect(readBagContents([['contents', 'cashu', count]]), JSON.stringify(count)).toEqual({ money: false, moneyAlone: false, nft: false, counts: null })
    }
    expect(readBagContents([['contents', 'cashu', '0'], ['contents', 'shard', '2']]).money).toBe(false)
    // The money-alone form still says money, alone or beside counted rows of other kinds.
    expect(readBagContents([['contents', 'cashu']])).toMatchObject({ money: true, moneyAlone: true })
    expect(readBagContents([['contents', 'shard', '2'], ['contents', 'cashu']])).toEqual({ money: true, moneyAlone: true, nft: false, counts: { shard: '2' } })
    expect(readBagContents([['contents', 'cashu', '1']])).toMatchObject({ money: true, moneyAlone: false })
  })

  it('reads a count of any size, exactly as written', () => {
    const huge = '9'.repeat(400)
    expect(readBagContents([['contents', 'shard', '1000000']]).counts).toEqual({ shard: '1000000' })
    expect(readBagContents([['contents', 'message', '9007199254740993']]).counts).toEqual({ message: '9007199254740993' })
    expect(readBagContents([['contents', 'nft', huge]])).toEqual({ money: false, moneyAlone: false, nft: true, counts: { nft: huge } })
    expect(readBagContents([['contents', 'cashu', '1000000']]).money).toBe(true)
  })

  it('ignores a count with a sign, a leading zero, an exponent or anything else a decimal count is not', () => {
    for (const count of ['03', '+3', '1e2', '0x3', '3.0', '3 ', '\u0663', '1_000']) {
      expect(readBagContents([['contents', 'shard', count]]).counts, JSON.stringify(count)).toBeNull()
      expect(readBagContents([['contents', 'nft', count]]).nft, JSON.stringify(count)).toBe(false)
    }
    // A count that is not a string at all is not a decimal string.
    expect(readBagContents([['contents', 'shard', 3 as unknown as string]]).counts).toBeNull()
  })

  it('a bare row says nothing for any kind but cashu', () => {
    for (const kind of ['shard', 'message', 'key', 'chest', 'nft']) expect(readBagContents([['contents', kind]])).toEqual({ money: false, moneyAlone: false, nft: false, counts: null })
  })

  it('carries into a bag\'s settings, so a rewrite keeps the choice', () => {
    const bag = { ...ev(33330), tags: [['d', 'x'], ['contents', 'shard', '1']] }
    expect(bagSettingsOf(bag, 3)).toMatchObject({ contents: true, money: false })
    const settingsOf = (rows: string[][]) => bagSettingsOf({ ...ev(33330), tags: [['d', 'x'], ...rows] }, 3)
    expect(settingsOf([['contents', 'shard', '1000000']])).toMatchObject({ contents: true, money: false })
    expect(settingsOf([['contents', 'shard', '03']])).toMatchObject({ contents: false, money: false })
    expect(settingsOf([['contents', 'cashu', '0']])).toMatchObject({ contents: false, money: false })
    expect(settingsOf([['contents', 'cashu']])).toMatchObject({ contents: false, money: true })
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
