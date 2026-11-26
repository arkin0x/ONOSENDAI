/**
 * messagesRead.test.ts: the rule behind the broken seal (owner, 2026-11-26:
 * "love the broken seal for read"): a message is read once its card has been
 * opened, your own are read, a moved message stays read by its lineage, and
 * a record read back is cleaned rather than trusted.
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_READ, READ_IDS_MAX, cleanRead, isRead, markRead, mergeRead, readId } from '../messagesRead'

describe('read messages', () => {
  it('a message is unread until its card is opened, read after, and your own always', () => {
    expect(isRead(EMPTY_READ, 'm1')).toBe(false)
    expect(isRead(EMPTY_READ, 'm1', true)).toBe(true)
    const r = markRead(EMPTY_READ, 'm1')
    expect(isRead(r, 'm1')).toBe(true)
    expect(isRead(r, 'm2')).toBe(false)
  })

  it('is known by its lineage, so a message its author moved stays read', () => {
    expect(readId({ key: 'new-id', lineage: 'line' })).toBe('line')
    expect(readId({ key: 'k' })).toBe('k')
    expect(readId({ key: 'k', lineage: '' })).toBe('k')
  })

  it('reading again changes nothing, so nothing is written', () => {
    const r = markRead(EMPTY_READ, 'm1')
    expect(markRead(r, 'm1')).toBe(r)
    const r2 = markRead(r, 'm2')
    expect(markRead(r2, 'm1')).toBe(r2)
    expect(markRead(r2, '')).toBe(r2)
  })

  it('keeps the newest READ_IDS_MAX, newest first', () => {
    let r = EMPTY_READ
    for (let i = 0; i < READ_IDS_MAX + 5; i++) r = markRead(r, `m${i}`)
    expect(r.ids).toHaveLength(READ_IDS_MAX)
    expect(r.ids[0]).toBe(`m${READ_IDS_MAX + 4}`)
    expect(isRead(r, 'm0')).toBe(false)
  })

  it('cleans what is read back and merges two records losing nothing', () => {
    expect(cleanRead(null)).toEqual(EMPTY_READ)
    expect(cleanRead({ ids: ['a', 3, 'a', '', 'b'] })).toEqual({ ids: ['a', 'b'] })
    expect(mergeRead({ ids: ['a', 'b'] }, { ids: ['c', 'a'] })).toEqual({ ids: ['c', 'a', 'b'] })
  })
})
