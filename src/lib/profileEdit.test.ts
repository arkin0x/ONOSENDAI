import { describe, expect, it } from 'vitest'
import { fieldsOf, mergeProfile, newest, parseContent, profileProblems, profileTemplate } from './profileEdit'
import type { NostrEvent } from './events'

const ev = (over: Partial<NostrEvent>): NostrEvent => ({ id: '0'.repeat(64), pubkey: 'ab'.repeat(32), created_at: 1, kind: 0, tags: [], content: '{}', sig: '', ...over })

describe('parseContent and fieldsOf', () => {
  it('reads an object and keeps only string fields it knows', () => {
    const c = parseContent('{"name":"case","picture":"https://x/p.png","bot":false,"lud06":"lnurl1…","about":42}')
    expect(fieldsOf(c)).toEqual({ name: 'case', picture: 'https://x/p.png' })
  })
  it('is null for anything that is not an object', () => {
    expect(parseContent('[1]')).toBeNull()
    expect(parseContent('nope')).toBeNull()
    expect(fieldsOf(null)).toEqual({})
  })
})

describe('mergeProfile', () => {
  const existing = { name: 'case', about: 'old', lud06: 'lnurl1abc', bot: false, nip05: 'case@example.com' }
  it('lays the edits over the existing object and keeps every field it does not know', () => {
    const next = mergeProfile(existing, { about: ' new ', picture: 'https://x/p.png' })
    expect(next).toEqual({ name: 'case', about: 'new', picture: 'https://x/p.png', lud06: 'lnurl1abc', bot: false, nip05: 'case@example.com' })
  })
  it('an emptied field is removed, not written as an empty string', () => {
    expect(mergeProfile(existing, { nip05: '' })).not.toHaveProperty('nip05')
    expect(mergeProfile(existing, { nip05: '   ' })).not.toHaveProperty('nip05')
  })
  it('a field not in the edits is untouched even when the edits are empty', () => {
    expect(mergeProfile(existing, {})).toEqual(existing)
    expect(mergeProfile(null, { name: 'x' })).toEqual({ name: 'x' })
  })
})

describe('profileTemplate', () => {
  it('is a kind 0 carrying the previous tags and a created_at past the previous event', () => {
    const prev = ev({ created_at: 1_800_000_100, tags: [['i', 'github:case', 'proof']] })
    const t = profileTemplate({ name: 'case' }, 1_800_000_000, prev)
    expect(t.kind).toBe(0)
    expect(t.tags).toEqual(prev.tags)
    expect(t.created_at).toBe(1_800_000_101)
    expect(JSON.parse(t.content)).toEqual({ name: 'case' })
  })
  it('uses now when there is nothing to replace or now is already later', () => {
    expect(profileTemplate({}, 1_800_000_000, null).created_at).toBe(1_800_000_000)
    expect(profileTemplate({}, 1_800_000_000, ev({ created_at: 5 })).created_at).toBe(1_800_000_000)
  })
})

describe('newest', () => {
  it('picks the latest created_at of the right author and kind, lowest id on a tie', () => {
    const list = [
      ev({ id: 'b'.repeat(64), created_at: 10 }),
      ev({ id: 'a'.repeat(64), created_at: 10 }),
      ev({ id: 'c'.repeat(64), created_at: 9 }),
      ev({ id: 'd'.repeat(64), created_at: 99, pubkey: 'cd'.repeat(32) }),
      ev({ id: 'e'.repeat(64), created_at: 99, kind: 10063 }),
    ]
    expect(newest(list, 'ab'.repeat(32), 0)?.id).toBe('a'.repeat(64))
    expect(newest(list, 'ab'.repeat(32), 10063)?.id).toBe('e'.repeat(64))
    expect(newest([], 'ab'.repeat(32), 0)).toBeNull()
  })
})

describe('profileProblems', () => {
  it('wants full URLs and address-shaped identifiers, and says nothing about empty fields', () => {
    expect(profileProblems({})).toEqual([])
    expect(profileProblems({ picture: 'p.png' })).toEqual(['Picture must be a full URL, starting with https://.'])
    expect(profileProblems({ nip05: 'case' })).toHaveLength(1)
    expect(profileProblems({ nip05: '_@example.com', lud16: 'me@getalby.com', website: 'https://onosendai.tech' })).toEqual([])
  })
})
