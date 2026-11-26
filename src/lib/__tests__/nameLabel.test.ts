/**
 * nameLabel.test.ts: a person is named the same way over every thing in the
 * world (owner, 2026-11-27: "npub display not in line with other modes"):
 * "you", their display name, or a short npub in its own lower case, never an
 * npub in capitals.
 */
import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'
import { looksLikeNpub, nameLabel, shortNpub } from '../nameLabel'

const A = 'a1'.repeat(32)
const ME = 'b2'.repeat(32)
const npubA = nip19.npubEncode(A)

describe('a name over a thing', () => {
  it('is "you" for your own', () => {
    expect(nameLabel(ME, ME, 'arkinox')).toBe('you')
  })

  it('is the display name when the profile has one', () => {
    expect(nameLabel(A, ME, 'Molly')).toBe('Molly')
    expect(nameLabel(A, ME, '  case ')).toBe('case')
  })

  it('is a short npub in lower case with no profile, an empty name, or a name that is only an npub in any case', () => {
    const short = `${npubA.slice(0, 10)}…${npubA.slice(-4)}`
    expect(shortNpub(A)).toBe(short)
    expect(nameLabel(A, ME)).toBe(short)
    expect(nameLabel(A, ME, '')).toBe(short)
    expect(nameLabel(A, ME, `${npubA.slice(0, 12).toUpperCase()}…${npubA.slice(-4).toUpperCase()}`)).toBe(short)
    expect(nameLabel(A, ME, npubA)).toBe(short)
    expect(short).toBe(short.toLowerCase())
  })

  it('tells an npub-like name from a real one', () => {
    expect(looksLikeNpub('NPUB1MMX8UN4…RZ2S')).toBe(true)
    expect(looksLikeNpub('npub1abc')).toBe(true)
    expect(looksLikeNpub('npub fan')).toBe(false)
    expect(looksLikeNpub('Molly')).toBe(false)
  })

  it('never puts a dash or a symbol before it', () => {
    for (const n of [nameLabel(A, ME), nameLabel(A, ME, 'Molly'), nameLabel(ME, ME)]) expect(n).not.toMatch(/^[—–\-⚷]/)
  })
})
