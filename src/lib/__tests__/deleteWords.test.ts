/**
 * deleteWords.test.ts: the words on the DELETE and REMOVE FROM CHEST
 * confirmation in the shard modal name the thing, say what happens in two
 * lines at most, and never choke on a thing with no name.
 */
import { describe, expect, it } from 'vitest'
import { MESSAGE_NAME_CHARS, deleteWords, itemLabel, messageName, removeWords, type NamedItem } from '../deleteWords'

const shard = (name: string): NamedItem => ({ type: 'shard', shard: { name } as NamedItem['shard'] })
const message = (text: string): NamedItem => ({ type: 'message', text })
const key = (name: string): NamedItem => ({ type: 'key', keyItem: { name } as NamedItem['keyItem'] })
const chest = (name: string): NamedItem => ({ type: 'chest', chest: { name } as NamedItem['chest'] })

describe('itemLabel', () => {
  it('names each kind of thing', () => {
    expect(itemLabel(shard('Giraffe'))).toBe('the shard Giraffe')
    expect(itemLabel(key('Door'))).toBe('the key Door')
    expect(itemLabel(chest('Door'))).toBe('the chest Door')
    expect(itemLabel(message('Hello there'))).toBe('the message “Hello there”')
  })
  it('falls back to "this <kind>" when nothing names it', () => {
    expect(itemLabel({ type: 'shard' })).toBe('this shard')
    expect(itemLabel(shard(''))).toBe('this shard')
    expect(itemLabel({ type: 'key' })).toBe('this key')
    expect(itemLabel({ type: 'chest' })).toBe('this chest')
    expect(itemLabel(message(''))).toBe('this message')
    expect(itemLabel({ type: 'message' })).toBe('this message')
  })
})

describe('messageName', () => {
  it('keeps a short message whole and cuts a long one at the limit with an ellipsis', () => {
    expect(messageName('Hello there')).toBe('Hello there')
    const long = 'a'.repeat(MESSAGE_NAME_CHARS + 20)
    const name = messageName(long)
    expect(name).toBe(`${'a'.repeat(MESSAGE_NAME_CHARS)}…`)
    expect(name.length).toBe(MESSAGE_NAME_CHARS + 1)
  })
  it('puts a message on one line and drops a space the cut would leave hanging', () => {
    expect(messageName('one\n\n  two   three')).toBe('one two three')
    const spaced = `${'b'.repeat(MESSAGE_NAME_CHARS - 1)} after`
    expect(messageName(spaced)).toBe(`${'b'.repeat(MESSAGE_NAME_CHARS - 1)}…`)
  })
  it('leaves a Cashu token out, so a token-only message has no name', () => {
    const token = `cashuB${'A'.repeat(80)}`
    expect(messageName(`take this ${token}`)).toBe('take this')
    expect(messageName(token)).toBe('')
  })
})

describe('deleteWords', () => {
  it('asks about the named thing and says what deleteInstance does in two lines', () => {
    const w = deleteWords(shard('Giraffe'))
    expect(w.title).toBe('Delete the shard Giraffe?')
    expect(w.lines.length).toBeLessThanOrEqual(2)
    expect(w.lines.join(' ')).toMatch(/rewritten without it/)
    expect(w.lines.join(' ')).toMatch(/deleted when this was the last thing of yours/)
    expect(w.lines.join(' ')).toMatch(/Copies others already took stay with them/)
    expect(w.lines.join(' ')).toMatch(/cannot be undone/)
  })
  it('names a message by its first words', () => {
    expect(deleteWords(message('Meet me at the arches at dawn, bring the key and the map')).title)
      .toBe('Delete the message “Meet me at the arches at dawn, bring the…”?')
  })
})

describe('removeWords', () => {
  it('names the thing and its chest, and says the chest and the rest of it stay', () => {
    const w = removeWords(shard('Giraffe'), 'Door')
    expect(w.title).toBe('Take the shard Giraffe out of the chest Door?')
    expect(w.lines.length).toBeLessThanOrEqual(2)
    expect(w.lines.join(' ')).toMatch(/sealed again without it/)
    expect(w.lines.join(' ')).toMatch(/everything else in it stay/)
  })
  it('still asks when the chest has no name to give', () => {
    expect(removeWords(key('Door'), null).title).toBe('Take the key Door out of its chest?')
    expect(removeWords(key('Door'), '').title).toBe('Take the key Door out of its chest?')
  })
})

describe('no em dashes', () => {
  it('none of the words carry one', () => {
    const all = [deleteWords(shard('x')), removeWords(shard('x'), 'y')].flatMap((w) => [w.title, ...w.lines]).join(' ')
    expect(all).not.toMatch(/—/)
  })
})
