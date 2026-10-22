/**
 * tvSegments.test.ts: a quote always finishes printing inside its shot, and a
 * sealed one never shows how long it was.
 */
import { describe, expect, it } from 'vitest'
import { itemLength, QUOTE_MAX } from '../../lib/tv/director'
import { STATIC_MS } from '../../scene/TvScreenEffect'
import { TYPE_S, contentsWords, quoteOf, redaction, segmentDoing, typePace } from '../TvSegments'

const comment = (text: string | null) => ({ kind: 'comment' as const, id: 'ab'.repeat(32), pubkey: 'p', at: 1, text, on: 'move' as const, about: null })

describe('the news desk', () => {
  it('cuts a long quote with an ellipsis', () => {
    const q = quoteOf(comment('x'.repeat(444)))
    expect(q.length).toBe(QUOTE_MAX + 1)
    expect(q.endsWith('…')).toBe(true)
  })

  it('finishes printing a second and a half before the shot ends, at any length', () => {
    for (const n of [5, 60, 200, 444]) {
      const item = comment('y'.repeat(n))
      const q = quoteOf(item)
      const pace = typePace(q.length, itemLength(item))
      expect(pace).toBeLessThanOrEqual(TYPE_S)
      expect(STATIC_MS / 1000 + 0.8 + q.length * pace).toBeLessThanOrEqual(itemLength(item) - 1.5 + 1e-9)
    }
  })

  it('prints a sealed quote as redaction of one length, whatever was written', () => {
    expect(quoteOf(comment(null))).toBe(redaction('ab'.repeat(32)))
    expect(quoteOf(comment(null)).replace(/[█ ]/g, '')).toBe('')
  })
})

describe('a bag on the chiron', () => {
  const bag = { kind: 'bag' as const, id: 'b'.repeat(64), pubkey: 'p', at: 1, hint: null, height: 3 }
  it('says what is inside when its author published that', () => {
    expect(contentsWords({ shard: 3, message: 1, cashu: 1 })).toBe('3 SHARDS · 1 MESSAGE · 1 CASHU TOKEN')
    expect(segmentDoing({ ...bag, money: true, counts: { shard: 3, message: 1, cashu: 1 } })).toBe('SEALED A BAG · 3 SHARDS · 1 MESSAGE · 1 CASHU TOKEN')
  })
  it('says money is inside when only that was published, and nothing more when nothing was', () => {
    expect(segmentDoing({ ...bag, money: true, counts: null })).toBe('SEALED A BAG · CASHU INSIDE')
    expect(segmentDoing({ ...bag, money: false, counts: null })).toBe('SEALED A BAG')
  })

  it('counts NFTs on the chiron, after cashu tokens', () => {
    expect(contentsWords({ message: 2, cashu: 1, nft: 1 })).toBe('2 MESSAGES · 1 CASHU TOKEN · 1 NFT')
    expect(contentsWords({ message: 2, nft: 2 })).toBe('2 MESSAGES · 2 NFTS')
    expect(segmentDoing({ ...bag, money: false, nft: true, counts: { message: 1, nft: 1 } })).toBe('SEALED A BAG · 1 MESSAGE · 1 NFT')
  })
})
