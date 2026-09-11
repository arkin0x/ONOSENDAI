/**
 * The STASH row's coin decision, rendered through the hook itself. Rendered
 * to a string so the first render is what is checked: what the row shows
 * before the mint has answered, which is the render that decides pen or coin.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { cashuStateLabel, useCashu, type CashuView } from './useCashu'

const V3 = 'cashuA' + btoa(JSON.stringify({ token: [{ mint: 'https://mint.example', proofs: [{ id: '00ad', amount: 16, secret: 'a', C: '02aa' }, { id: '00ad', amount: 5, secret: 'b', C: '02bb' }] }], unit: 'sat' }))

function view(text: string | null): CashuView {
  let out: CashuView | null = null
  renderToString(createElement(() => { out = useCashu(text); return null }))
  return out!
}

describe('useCashu', () => {
  it('a message carrying a token is a coin, and says what it holds', () => {
    const v = view(`for the drinks ${V3}`)
    expect(v.found).toBe(true)
    expect(v.token?.amount).toBe(21)
    expect(cashuStateLabel(v.state)).toBe('CHECKING')
  })
  it('a token this reader cannot decode is still a coin, marked UNREADABLE', () => {
    const v = view(`for the drinks ${V3.slice(0, 40)}`)
    expect(v.found).toBe(true)
    expect(v.token).toBeNull()
    expect(cashuStateLabel(v.state)).toBe('UNREADABLE')
  })
  it('a plain message is not a coin', () => {
    const v = view('just a note')
    expect(v.found).toBe(false)
    expect(v.token).toBeNull()
  })
  it('no text is not a coin', () => {
    expect(view(null).found).toBe(false)
  })
})
