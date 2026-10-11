/**
 * Mentions in local chat (arkinox, 2026-10-11): "@Name" in the composer goes
 * out as NIP-27 nostr:npub text plus a p tag per person, and comes back as
 * @Name, with lines that mention you marked.
 */
import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { chatInnerTemplate } from '../hidden'
import {
  activeMention, buildCandidates, encodeMentions, filterCandidates, insertMention, mentionTags, mentionsMe,
  MAX_MENTIONS, pTagged, referencedPubkeys, segments,
} from '../mentions'

const pk = (c: string): string => c.repeat(64)
const at = { x: 1n, y: 2n, z: 3n }

describe('typing a mention', () => {
  it('finds the @ at the caret, only at a word start, and not past a space', () => {
    expect(activeMention('hi @xo', 6)).toEqual({ start: 3, query: 'xo' })
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' })
    expect(activeMention('mail a@b', 8)).toBeNull()
    expect(activeMention('hi @xor there', 13)).toBeNull()
  })

  it('inserts @Name and a space, caret after it', () => {
    expect(insertMention('hey @xo how', 4, 7, 'XOR')).toEqual({ text: 'hey @XOR how', caret: 9 })
  })
})

describe('the picker', () => {
  const xor = pk('a'), alice = pk('b'), bob = pk('c'), me = pk('d')
  const names: Record<string, string> = { [xor]: 'XOR', [alice]: 'alice', [bob]: 'Bob', [me]: 'arkinox' }
  const bots: Record<string, boolean> = { [bob]: true }
  const all = buildCandidates([bob, alice, me, xor], [xor], (p) => ({ bot: bots[p] }), (p) => names[p])

  it('offers presence plus my agents, my agents first, me never, bots badged', () => {
    const list = filterCandidates(all, '', me)
    expect(list.map((c) => c.label)).toEqual(['XOR', 'alice', 'Bob'])
    expect(list[0]).toMatchObject({ mine: true, bot: true })
    expect(list.find((c) => c.label === 'Bob')).toMatchObject({ mine: false, bot: true })
    expect(list.find((c) => c.label === 'alice')?.bot).toBe(false)
  })

  it('filters as you type, ignoring case', () => {
    expect(filterCandidates(all, 'b', me).map((c) => c.label)).toEqual(['Bob'])
    expect(filterCandidates(all, 'X', me).map((c) => c.label)).toEqual(['XOR'])
    expect(filterCandidates(all, 'zzz', me)).toEqual([])
  })
})

describe('on the wire', () => {
  it('turns each picked @Name into nostr:npub and names each person once, in order', () => {
    const a = pk('a'), b = pk('b')
    const out = encodeMentions('@XOR ping @Al and @XOR again', [{ pubkey: b, label: 'Al' }, { pubkey: a, label: 'XOR' }])
    expect(out.text).toBe(`nostr:${nip19.npubEncode(a)} ping nostr:${nip19.npubEncode(b)} and nostr:${nip19.npubEncode(a)} again`)
    expect(out.pubkeys).toEqual([a, b])
  })

  it('replaces the longer label first and leaves an unpicked or deleted @ alone', () => {
    const out = encodeMentions('@Alice and @Bob', [{ pubkey: pk('1'), label: 'Al' }, { pubkey: pk('2'), label: 'Alice' }, { pubkey: pk('3'), label: 'Carol' }])
    expect(out.text).toBe(`nostr:${nip19.npubEncode(pk('2'))} and @Bob`)
    expect(out.pubkeys).toEqual([pk('2')])
  })

  it('tags at most MAX_MENTIONS people, deduplicated, valid hex only', () => {
    const many = ['1', '2', '3', '4', '5', '6'].map(pk)
    expect(mentionTags([...many, many[0], 'nope'])).toEqual(many.slice(0, MAX_MENTIONS).map((p) => ['p', p]))
  })

  it('the inner chat event carries the npub text and a p tag per mention after d and C', () => {
    const xor = getPublicKey(generateSecretKey())
    const wire = encodeMentions('@XOR hello', [{ pubkey: xor, label: 'XOR' }])
    const ev = finalizeEvent(chatInnerTemplate(wire.text, at, 0, 1_700_000_000, 'aa'.repeat(32), wire.pubkeys), generateSecretKey())
    expect(ev.content).toBe(`nostr:${nip19.npubEncode(xor)} hello`)
    expect(ev.tags.map((t) => t[0])).toEqual(['d', 'C', 'p'])
    expect(ev.tags[2]).toEqual(['p', xor])
    expect(pTagged(ev.tags)).toEqual([xor])
  })

  it('a line with no mentions is exactly what it was before', () => {
    const t = chatInnerTemplate('just talking', at, 0, 1, 'aa'.repeat(32))
    expect(t.tags.map((x) => x[0])).toEqual(['d', 'C'])
    expect(t.content).toBe('just talking')
  })
})

describe('reading a line', () => {
  const xor = pk('a')
  const npub = nip19.npubEncode(xor)

  it('splits out npub and nprofile references; junk stays text', () => {
    const nprofile = nip19.nprofileEncode({ pubkey: pk('b') })
    expect(segments(`hi nostr:${npub}, and nostr:${nprofile} nostr:npub1zzz`)).toEqual([
      { text: 'hi ' }, { pubkey: xor, npub }, { text: ', and ' }, { pubkey: pk('b'), npub: nip19.npubEncode(pk('b')) }, { text: ' nostr:npub1zzz' },
    ])
    expect(referencedPubkeys(`nostr:${npub} nostr:${npub}`)).toEqual([xor])
  })

  it('knows a line that mentions me, by p tag or by text, and never my own', () => {
    const me = pk('e')
    expect(mentionsMe({ text: 'hello', mentions: [me], from: xor }, me)).toBe(true)
    expect(mentionsMe({ text: `hi nostr:${nip19.npubEncode(me)}`, from: xor }, me)).toBe(true)
    expect(mentionsMe({ text: `hi nostr:${npub}`, mentions: [xor], from: pk('f') }, me)).toBe(false)
    expect(mentionsMe({ text: `nostr:${nip19.npubEncode(me)}`, mentions: [me], from: me }, me)).toBe(false)
  })
})
