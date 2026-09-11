import { describe, expect, it } from 'vitest'
import { composeVerdict, type CashuView } from './useCashu'

const token = { mint: 'https://mint.minibits.cash/Bitcoin', unit: 'sat', memo: null, amount: 21, proofs: [{ amount: 21, secret: 's' }], version: 4 as const }
const view = (v: Partial<CashuView>): CashuView => ({ found: false, token: null, state: 'unknown', ...v })

describe('placing a composed message', () => {
  it('waits while the text is still moving, whatever it holds', () => {
    expect(composeVerdict(false, view({})).ready).toBe(false)
    expect(composeVerdict(false, view({ found: true, token, state: 'unclaimed' })).ready).toBe(false)
  })

  it('is ready at once for a message without a token, with nothing to say', () => {
    expect(composeVerdict(true, view({}))).toEqual({ ready: true, note: null, tone: 'dim' })
  })

  it('refuses a token that will not decode and says so', () => {
    const v = composeVerdict(true, view({ found: true, token: null, state: 'unreadable' }))
    expect(v.ready).toBe(false)
    expect(v.tone).toBe('warn')
    expect(v.note).toMatch(/will not decode/)
  })

  it('waits for the mint, then goes by its answer', () => {
    expect(composeVerdict(true, view({ found: true, token, state: 'checking' })).ready).toBe(false)
    const ok = composeVerdict(true, view({ found: true, token, state: 'unclaimed' }))
    expect(ok).toEqual({ ready: true, tone: 'ok', note: '21 sat, unclaimed at mint.minibits.cash.' })
    expect(composeVerdict(true, view({ found: true, token, state: 'redeemed' }))).toMatchObject({ ready: false, tone: 'warn' })
    expect(composeVerdict(true, view({ found: true, token, state: 'pending' }))).toMatchObject({ ready: false, tone: 'warn' })
  })

  it('lets an unverifiable token through with a warning', () => {
    const v = composeVerdict(true, view({ found: true, token, state: 'unknown' }))
    expect(v.ready).toBe(true)
    expect(v.tone).toBe('warn')
    expect(v.note).toMatch(/could not be reached/)
  })
})
