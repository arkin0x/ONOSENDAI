/**
 * The cashu card's words, state by state: what a reader is told about a
 * token's amount, whether it has been taken, and where it was minted.
 */
import { describe, expect, it } from 'vitest'
import { decodeCashuToken } from '../../lib/cashu'
import { cashuCardModel } from '../cashuCardModel'
import type { CashuView } from '../useCashu'

const V3 = 'cashuA' + btoa(JSON.stringify({ token: [{ mint: 'https://mint.example/Bitcoin', proofs: [{ id: '00ad', amount: 16, secret: 'a', C: '02aa' }, { id: '00ad', amount: 5, secret: 'b', C: '02bb' }] }], unit: 'sat', memo: 'for the drinks' }))
const NO_MEMO = 'cashuA' + btoa(JSON.stringify({ token: [{ mint: 'https://mint.example', proofs: [{ id: '00ad', amount: 1, secret: 'a', C: '02aa' }] }], unit: 'sat', memo: '   ' }))

const view = (state: CashuView['state'], token = V3): CashuView => ({ found: true, token: decodeCashuToken(token), state })

describe('cashuCardModel', () => {
  it('says what the token holds and where it was minted', () => {
    const card = cashuCardModel(view('unclaimed'))
    expect(card.amount).toBe('21 sats')
    expect(card.mint).toEqual({ host: 'mint.example', url: 'https://mint.example/Bitcoin' })
    expect(card.memo).toBe('for the drinks')
  })

  it('unclaimed: not taken yet, and the first to redeem it gets it', () => {
    const card = cashuCardModel(view('unclaimed'))
    expect(card.status).toBe('UNCLAIMED')
    expect(card.tone).toBe('unclaimed')
    expect(card.line).toMatch(/^Not taken yet\. mint\.example says nobody has redeemed/)
  })

  it('redeemed: says plainly that it is already taken', () => {
    const card = cashuCardModel(view('redeemed'))
    expect(card.status).toBe('REDEEMED')
    expect(card.tone).toBe('redeemed')
    expect(card.line).toMatch(/^Already taken\./)
    expect(card.line).toContain('nothing left in it to claim')
  })

  it('pending: the mint says it is being redeemed right now', () => {
    const card = cashuCardModel(view('pending'))
    expect(card.status).toBe('PENDING')
    expect(card.line).toContain('being redeemed right now')
  })

  it('checking: names the mint being asked while the request is in flight', () => {
    const card = cashuCardModel(view('checking'))
    expect(card.status).toBe('CHECKING')
    expect(card.line).toBe('Asking mint.example whether this token has been redeemed.')
  })

  it('a mint that cannot be reached is spelled out, not shown as MINT?', () => {
    const card = cashuCardModel(view('unknown'))
    expect(card.status).toBe('COULD NOT BE CHECKED')
    expect(card.tone).toBe('unknown')
    expect(card.line).toContain('mint.example could not be reached')
    expect(card.amount).toBe('21 sats')
  })

  it('a token that cannot be read is still a cashu token: no amount, no mint, and a line saying why', () => {
    const card = cashuCardModel({ found: true, token: null, state: 'unreadable' })
    expect(card.status).toBe('UNREADABLE')
    expect(card.tone).toBe('unreadable')
    expect(card.amount).toBeNull()
    expect(card.mint).toBeNull()
    expect(card.memo).toBeNull()
    expect(card.line).toMatch(/^This token could not be read\./)
    expect(card.line).toContain('COPY TOKEN still copies it')
  })

  it('a blank memo is no memo', () => {
    expect(cashuCardModel(view('unclaimed', NO_MEMO)).memo).toBeNull()
  })

  it('no sentence the card can say uses an em dash', () => {
    const states: CashuView['state'][] = ['checking', 'unclaimed', 'redeemed', 'pending', 'unknown']
    for (const s of states) expect(cashuCardModel(view(s)).line).not.toContain('\u2014')
    expect(cashuCardModel({ found: true, token: null, state: 'unreadable' }).line).not.toContain('\u2014')
  })
})
