/**
 * bagContents.test.ts: a bag's contents and money hints are worked out from
 * what is inside each time it is sealed, so they are never stale (arkinox,
 * 2026-10-18), and read back as they were written. Money is said only
 * with its own switch on (arkinox, 2026-11-15: "money off by default"):
 * contents on and money off leaves cashu out entirely. NFT claim links go
 * with money (owner ruling 2026-11-16, spec 7.7 Claimable kinds): whoever
 * finds one can claim it, so it is left out the same way.
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
    expect(c).toEqual({ shard: 2, message: 2, key: 1, chest: 1, cashu: 1, nft: 0, audio: 0, door: 0, seed: 0, dna: 0, blueprint: 0 })
  })

  it('counts seeds and the DNAs hidden with them, after door (DECK-0008 §8.2)', () => {
    expect(bagContents([ev(3351), ev(3351), ev(3350)])).toMatchObject({ seed: 2, dna: 1 })
    expect(bagContentsTags([ev(3330), ev(3351), ev(3350)], { contents: true, money: false })).toEqual([['contents', 'shard', '1'], ['contents', 'seed', '1'], ['contents', 'dna', '1']])
    expect(readBagContents([['contents', 'seed', '2'], ['contents', 'dna', '1']]).counts).toEqual({ seed: '2', dna: '1' })
  })

  it('counts the nonfungible.cash claim links in messages, each once, and never a look-alike', () => {
    const two = `${LINK} and ${LINK2} and ${LINK} again`
    const c = bagContents([ev(1, two), ev(1, `see ${LINK.split('#')[0]}`), ev(1, `${TOKEN} ${LINK}`)])
    expect(c).toMatchObject({ message: 3, cashu: 1, nft: 3 })
  })

  it('does not count a link inside another URL\'s path or query (spec 7.7)', () => {
    expect(bagContents([ev(1, `https://a.example/?b=1;${LINK}`)])).toMatchObject({ message: 1, nft: 0 })
    expect(bagContents([ev(1, `${LINK},${LINK2}`)])).toMatchObject({ message: 1, nft: 2 })
    expect(bagContentsTags([ev(1, `https://a.example/?b=1;${LINK}`)], { contents: true, money: true })).toEqual([['contents', 'message', '1']])
  })
})

describe('bagContentsTags', () => {
  const inners = [ev(3330), ev(3330), ev(3330), ev(1, TOKEN)]
  it('writes nothing unless asked', () => {
    expect(bagContentsTags(inners, DEFAULT_BAG_SETTINGS)).toEqual([])
  })
  it('with contents and money off, every kind inside but cashu, and no row says money', () => {
    expect(bagContentsTags(inners, { contents: true, money: false })).toEqual([['contents', 'shard', '3'], ['contents', 'message', '1']])
  })
  it('with contents and money on, cashu counted beside the rest', () => {
    expect(bagContentsTags(inners, { contents: true, money: true })).toEqual([['contents', 'shard', '3'], ['contents', 'message', '1'], ['contents', 'cashu', '1']])
  })
  it('money off: a bag with tokens says exactly what the same bag without them says, so no count or total gives money away', () => {
    const plain = [ev(3330), ev(3330), ev(3330), ev(1, 'no token here')]
    const rich = [ev(3330), ev(3330), ev(3330), ev(1, `for you ${TOKEN}`)]
    expect(bagContents(rich).cashu).toBeGreaterThan(0)
    expect(bagContentsTags(rich, { contents: true, money: false })).toEqual(bagContentsTags(plain, { contents: true, money: false }))
    expect(bagContentsTags(rich, { contents: false, money: false })).toEqual([])
    // Every row is a kind and its own count: nothing sums the kinds.
    for (const t of bagContentsTags(rich, { contents: true, money: false })) expect(t[1]).not.toBe('cashu')
  })
  it('with money alone, only that money is inside, and only while it is', () => {
    expect(bagContentsTags(inners, { contents: false, money: true })).toEqual([['contents', 'cashu']])
    expect(bagContentsTags([ev(3330), ev(1, 'no token here')], { contents: false, money: true })).toEqual([])
  })
  it('with contents, an nft count after cashu, as the cashu count is written', () => {
    expect(bagContentsTags([...inners, ev(1, `for you ${LINK}`)], { contents: true, money: true })).toEqual([['contents', 'shard', '3'], ['contents', 'message', '2'], ['contents', 'cashu', '1'], ['contents', 'nft', '1']])
  })
  it('an NFT is claimable (spec 7.7): with the switch off it is left out of the contents, count and all', () => {
    expect(bagContentsTags([...inners, ev(1, `for you ${LINK}`)], { contents: true, money: false })).toEqual([['contents', 'shard', '3'], ['contents', 'message', '2']])
  })
  it('switch off: a bag with an NFT says exactly what the same bag without it says', () => {
    const plain = [ev(3330), ev(1, 'hi'), ev(1, 'no link here')]
    const nft = [ev(3330), ev(1, 'hi'), ev(1, `for you ${LINK} and ${LINK2}`)]
    const both = [ev(3330), ev(1, `${TOKEN} hi`), ev(1, `for you ${LINK}`)]
    expect(bagContents(nft).nft).toBe(2)
    for (const contents of [false, true]) {
      const off = { contents, money: false }
      expect(bagContentsTags(nft, off), JSON.stringify(off)).toEqual(bagContentsTags(plain, off))
      expect(bagContentsTags(both, off), JSON.stringify(off)).toEqual(bagContentsTags(plain, off))
      // No row names a claimable kind, with a count or without.
      for (const t of [...bagContentsTags(nft, off), ...bagContentsTags(both, off)]) expect(['cashu', 'nft']).not.toContain(t[1])
    }
  })
  it('switch on with contents: the NFT count beside the rest', () => {
    expect(bagContentsTags([ev(3330), ev(1, `for you ${LINK} and ${LINK2}`)], { contents: true, money: true })).toEqual([['contents', 'shard', '1'], ['contents', 'message', '1'], ['contents', 'nft', '2']])
  })
  it('switch on alone: that an NFT is inside, with no count, as money is (spec 7.7 Claimable alone)', () => {
    expect(bagContentsTags([ev(1, LINK), ev(1, LINK2)], { contents: false, money: true })).toEqual([['contents', 'nft']])
    expect(bagContentsTags([ev(1, `${TOKEN} ${LINK}`)], { contents: false, money: true })).toEqual([['contents', 'cashu'], ['contents', 'nft']])
    expect(bagContentsTags([ev(1, TOKEN)], { contents: false, money: true })).toEqual([['contents', 'cashu']])
  })
})

describe('readBagContents', () => {
  it('reads back what was written, and a bag that says nothing as nothing', () => {
    expect(readBagContents([['contents', 'shard', '3'], ['contents', 'cashu', '1']])).toEqual({ money: true, moneyAlone: false, nft: false, nftAlone: false, counts: { shard: '3', cashu: '1' } })
    expect(readBagContents([['contents', 'cashu']])).toEqual({ money: true, moneyAlone: true, nft: false, nftAlone: false, counts: null })
    expect(readBagContents([['contents', 'gold', '5'], ['contents', 'shard', '-2']])).toEqual({ money: false, moneyAlone: false, nft: false, nftAlone: false, counts: null })
    expect(readBagContents([['contents', 'message', '1'], ['contents', 'nft', '2']])).toEqual({ money: false, moneyAlone: false, nft: true, nftAlone: false, counts: { message: '1', nft: '2' } })
    // The nft row with no count says an NFT is inside (spec 7.7 Claimable alone).
    expect(readBagContents([['contents', 'nft']])).toEqual({ money: false, moneyAlone: false, nft: true, nftAlone: true, counts: null })
    expect(readBagContents([['contents', 'nft', '0']]).nft).toBe(false)
  })
  // Spec 7.7 "Reading contents": a row whose count is there but is not a positive integer is ignored.
  it('reads money only from a counted cashu row or the cashu row with no count', () => {
    for (const count of ['0', '00', '-1', 'x', '', ' 1', '1.5', 'NaN', 'Infinity']) {
      expect(readBagContents([['contents', 'cashu', count]]), JSON.stringify(count)).toEqual({ money: false, moneyAlone: false, nft: false, nftAlone: false, counts: null })
    }
    expect(readBagContents([['contents', 'cashu', '0'], ['contents', 'shard', '2']]).money).toBe(false)
    // The money-alone form still says money, alone or beside counted rows of other kinds.
    expect(readBagContents([['contents', 'cashu']])).toMatchObject({ money: true, moneyAlone: true })
    expect(readBagContents([['contents', 'shard', '2'], ['contents', 'cashu']])).toEqual({ money: true, moneyAlone: true, nft: false, nftAlone: false, counts: { shard: '2' } })
    expect(readBagContents([['contents', 'cashu', '1']])).toMatchObject({ money: true, moneyAlone: false })
  })

  it('reads a count of any size, exactly as written', () => {
    const huge = '9'.repeat(400)
    expect(readBagContents([['contents', 'shard', '1000000']]).counts).toEqual({ shard: '1000000' })
    expect(readBagContents([['contents', 'message', '9007199254740993']]).counts).toEqual({ message: '9007199254740993' })
    expect(readBagContents([['contents', 'nft', huge]])).toEqual({ money: false, moneyAlone: false, nft: true, nftAlone: false, counts: { nft: huge } })
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

  it('a bare row says nothing for any kind but the claimable ones', () => {
    for (const kind of ['shard', 'message', 'key', 'chest', 'audio', 'door', 'seed', 'dna', 'blueprint']) expect(readBagContents([['contents', kind]])).toEqual({ money: false, moneyAlone: false, nft: false, nftAlone: false, counts: null })
  })

  it('carries into a bag\'s settings, so a rewrite keeps the choice', () => {
    const NONE = { cashu: 0, nft: 0 }
    const bag = { ...ev(33330), tags: [['d', 'x'], ['contents', 'shard', '1']] }
    expect(bagSettingsOf(bag, 3, NONE)).toMatchObject({ contents: true, money: false })
    const settingsOf = (rows: string[][]) => bagSettingsOf({ ...ev(33330), tags: [['d', 'x'], ...rows] }, 3, { cashu: 1, nft: 0 })
    expect(settingsOf([['contents', 'shard', '1000000']])).toMatchObject({ contents: true, money: false })
    expect(settingsOf([['contents', 'shard', '03']])).toMatchObject({ contents: false, money: false })
    expect(settingsOf([['contents', 'cashu', '0']])).toMatchObject({ contents: false, money: false })
    expect(settingsOf([['contents', 'cashu']])).toMatchObject({ contents: false, money: true })
    // A counted cashu row says money was turned on, so a rewrite that is not a hide keeps it.
    expect(settingsOf([['contents', 'message', '1'], ['contents', 'cashu', '1']])).toMatchObject({ contents: true, money: true })
    expect(settingsOf([['contents', 'message', '1']])).toMatchObject({ contents: true, money: false })
  })

  it('reads the switch ON only where the bag says every claimable kind it holds, so a rewrite never adds one', () => {
    const settingsOf = (rows: string[][], holds: { cashu: number; nft: number }) => bagSettingsOf({ ...ev(33330), tags: [['d', 'x'], ...rows] }, 3, holds).money
    // An NFT said, nothing else claimable inside: ON, kept on a rewrite.
    expect(settingsOf([['contents', 'message', '1'], ['contents', 'nft', '1']], { cashu: 0, nft: 1 })).toBe(true)
    expect(settingsOf([['contents', 'nft']], { cashu: 0, nft: 1 })).toBe(true)
    // A bag written before NFTs joined the switch: its NFT counted with the contents, a token kept quiet. OFF, so a rewrite does not count the token.
    expect(settingsOf([['contents', 'message', '1'], ['contents', 'nft', '1']], { cashu: 1, nft: 1 })).toBe(false)
    // Money said alone, an NFT never said: OFF, so a rewrite does not say the NFT.
    expect(settingsOf([['contents', 'cashu']], { cashu: 1, nft: 1 })).toBe(false)
    // Both said: ON.
    expect(settingsOf([['contents', 'cashu', '1'], ['contents', 'nft', '1']], { cashu: 1, nft: 1 })).toBe(true)
    expect(settingsOf([['contents', 'cashu'], ['contents', 'nft']], { cashu: 1, nft: 1 })).toBe(true)
    // Nothing claimable said: OFF whatever is inside.
    expect(settingsOf([['contents', 'message', '1']], { cashu: 0, nft: 0 })).toBe(false)
  })

  it('round trips: each switch pair reads back as written, for money, NFTs and both', () => {
    for (const inners of [[ev(3330), ev(1, TOKEN)], [ev(3330), ev(1, LINK)], [ev(3330), ev(1, `${TOKEN} ${LINK}`)]]) {
      const holds = bagContents(inners)
      for (const contents of [false, true]) {
        for (const money of [false, true]) {
          const bag = { ...ev(33330), tags: [['d', 'x'], ...bagContentsTags(inners, { contents, money })] }
          expect(bagSettingsOf(bag, 3, holds), JSON.stringify({ contents, money, holds })).toMatchObject({ contents, money })
        }
      }
    }
  })
})

describe('turning contents off', () => {
  it('does not leave the bag announcing money nobody chose (review of #378)', () => {
    const inners = [ev(3330), ev(1, TOKEN)]
    // Published with contents on and money off: no cashu row at all.
    const published = { ...ev(33330), tags: [['d', 'x'], ...bagContentsTags(inners, { contents: true, money: false })] }
    expect(published.tags.some((t) => t[1] === 'cashu')).toBe(false)
    const current = bagSettingsOf(published, 3, bagContents(inners))
    expect(current).toMatchObject({ contents: true, money: false })
    // The hider turns contents off; money was never chosen.
    const seed = current
    const chosen = { ...seed, contents: false }
    const next = resolveBagSettings(chosen, seed, current, 3)
    expect(next).toMatchObject({ contents: false, money: false })
    expect(bagContentsTags(inners, next)).toEqual([])
  })
})
