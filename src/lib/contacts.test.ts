import { describe, it, expect } from 'vitest'
import { parseContacts } from './contacts'
import { targetColor } from './targets'

const pk = (n: number): string => n.toString(16).padStart(64, '0')

describe('parseContacts', () => {
  it('reads p tags with optional petnames, once each, in order', () => {
    const out = parseContacts({
      id: '', pubkey: '', created_at: 0, kind: 3, content: '', sig: '',
      tags: [['p', pk(1), '', 'alice'], ['p', pk(2)], ['e', pk(3)], ['p', pk(1), '', 'dup'], ['p', 'nothex', '', 'x'], ['p', pk(4), 'wss://r', '  ']],
    })
    expect(out).toEqual([{ pubkey: pk(1), name: 'alice' }, { pubkey: pk(2), name: null }, { pubkey: pk(4), name: null }])
  })
})

describe('targetColor', () => {
  it('is a function of the pubkey alone', () => {
    expect(targetColor(pk(1))).toBe(targetColor(pk(1)))
    expect(targetColor('ffff' + '0'.repeat(60))).not.toBe(targetColor('0000' + '0'.repeat(60)))
    expect(targetColor(pk(7))).toMatch(/^hsl\(\d+ 90% 62%\)$/)
  })
})
