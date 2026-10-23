import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { v2 as nip44 } from 'nostr-tools/nip44'
import * as nip04 from 'nostr-tools/nip04'
import {
  MUTE_LIST_KIND,
  MuteListUnreadable,
  WORDS,
  applyEdit,
  fetchRefusal,
  listTemplate,
  mutedBy,
  newestList,
  openPrivate,
  parsePrivate,
  pruneThread,
  readList,
  schemeOf,
  writeRelaysOf,
  type SelfCrypto,
} from '../muteList'
import type { NostrEvent } from '../events'
import type { RelayAnswer } from '../relayOutcome'

const sk = generateSecretKey()
const me = getPublicKey(sk)
const ck = nip44.utils.getConversationKey(sk, me)
const crypto: SelfCrypto = {
  nip44Decrypt: async (p) => nip44.decrypt(p, ck),
  nip44Encrypt: async (p) => nip44.encrypt(p, ck),
  nip04Decrypt: async (p) => nip04.decrypt(sk, me, p),
  nip04Encrypt: async (p) => nip04.encrypt(sk, me, p),
}
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const ITEM = 'e'.repeat(64)

function list(over: Partial<NostrEvent> = {}): NostrEvent {
  return { id: '1'.repeat(64), pubkey: me, created_at: 100, kind: MUTE_LIST_KIND, tags: [], content: '', sig: '', ...over }
}

describe('the private half', () => {
  it('tells NIP-04 from NIP-44 by the iv', () => {
    expect(schemeOf('')).toBe('none')
    expect(schemeOf('abc?iv=def')).toBe('nip04')
    expect(schemeOf('AgVz...')).toBe('nip44')
  })

  it('opens NIP-44 and NIP-04 halves with their own scheme', async () => {
    const tags = [['p', A], ['word', 'spoiler']]
    expect(await openPrivate(nip44.encrypt(JSON.stringify(tags), ck), crypto)).toEqual({ tags, scheme: 'nip44' })
    expect(await openPrivate(nip04.encrypt(sk, me, JSON.stringify(tags)), crypto)).toEqual({ tags, scheme: 'nip04' })
  })

  it('refuses when the signer cannot decrypt, or the payload does not open, or is not a list', async () => {
    const sealed = nip44.encrypt('[]', ck)
    await expect(openPrivate(sealed, {})).rejects.toThrow(WORDS.noDecrypt)
    await expect(openPrivate(sealed, { nip44Decrypt: async () => { throw new Error('bad mac') } })).rejects.toBeInstanceOf(MuteListUnreadable)
    await expect(openPrivate(nip44.encrypt('{"p":1}', ck), crypto)).rejects.toThrow(WORDS.malformed)
    expect(() => parsePrivate('not json')).toThrow(MuteListUnreadable)
    expect(() => parsePrivate('{"a":1}')).toThrow(MuteListUnreadable)
  })

  it('passes a signer-on-another-account error through as it is', async () => {
    const err = Object.assign(new Error('other account'), { name: 'SignerAccountMismatch' })
    await expect(openPrivate(nip44.encrypt('[]', ck), { nip44Decrypt: async () => { throw err } })).rejects.toBe(err)
  })
})

describe('entries this app cannot read', () => {
  it('are kept as written through an edit, and never crash the reading', async () => {
    const odd = [['p', A, null], { note: 1 }, 'x', ['p', B], [7, 'y']] as unknown as string[][]
    const opened = await openPrivate(nip44.encrypt(JSON.stringify(odd), ck), crypto)
    expect(opened.tags).toEqual(odd)
    expect([...mutedBy(opened.tags, me).pubkeys]).toEqual([A, B])
    const next = applyEdit({ publicTags: [], privateTags: opened.tags }, { op: 'add', tag: ['p', C], private: true })
    expect(next.privateTags).toEqual([...odd, ['p', C]])
    expect(applyEdit({ publicTags: [], privateTags: opened.tags }, { op: 'remove', tag: ['p', B] }).privateTags).toEqual([['p', A, null], { note: 1 }, 'x', [7, 'y']])
  })
})

describe('what is muted', () => {
  it('reads p and e from both halves and never names yourself', () => {
    const m = mutedBy([['p', A], ['p', me], ['e', ITEM], ['t', 'x'], ['word', 'y'], ['p', 'short']], me)
    expect([...m.pubkeys]).toEqual([A])
    expect([...m.items]).toEqual([ITEM])
  })
})

describe('an edit', () => {
  const base = { publicTags: [['p', A], ['t', 'politics'], ['word', 'spoiler'], ['alt', 'mute list']], privateTags: [['p', B], ['word', 'secret'], ['x-future', 'kept']] }

  it('appends a new private block and keeps every other tag where it was', () => {
    const next = applyEdit(base, { op: 'add', tag: ['p', C], private: true })
    expect(next.changed).toBe(true)
    expect(next.publicTags).toEqual(base.publicTags)
    expect(next.privateTags).toEqual([...base.privateTags, ['p', C]])
  })

  it('changes nothing for an entry already in either half, and does not move it', () => {
    expect(applyEdit(base, { op: 'add', tag: ['p', A], private: true }).changed).toBe(false)
    expect(applyEdit(base, { op: 'add', tag: ['p', B.toUpperCase()], private: true }).changed).toBe(false)
  })

  it('removes an entry from both halves, public ones written by another client too', () => {
    const both = { publicTags: [['p', A, 'wss://hint'], ['t', 'x']], privateTags: [['p', A], ['p', B]] }
    const next = applyEdit(both, { op: 'remove', tag: ['p', A] })
    expect(next).toEqual({ publicTags: [['t', 'x']], privateTags: [['p', B]], changed: true })
    expect(applyEdit(both, { op: 'remove', tag: ['p', C] }).changed).toBe(false)
  })

  it('does not change the list it was given', () => {
    const copy = JSON.parse(JSON.stringify(base))
    applyEdit(base, { op: 'add', tag: ['e', ITEM], private: true })
    expect(base).toEqual(copy)
  })
})

describe('the next event', () => {
  it('seals the private half again with the scheme it came in, and NIP-44 for a new one', async () => {
    const prev04 = list({ content: nip04.encrypt(sk, me, '[]') })
    const t04 = await listTemplate({ publicTags: [], privateTags: [['p', A]] }, { event: prev04, scheme: 'nip04' }, crypto, 50)
    expect(schemeOf(t04.content)).toBe('nip04')
    expect(JSON.parse(nip04.decrypt(sk, me, t04.content))).toEqual([['p', A]])
    const tNew = await listTemplate({ publicTags: [], privateTags: [['p', A]] }, { event: null, scheme: 'none' }, crypto, 50)
    expect(schemeOf(tNew.content)).toBe('nip44')
    expect(JSON.parse(nip44.decrypt(tNew.content, ck))).toEqual([['p', A]])
  })

  it('is newer than the copy it replaces, drops another client tag, and leaves content empty with no private entries', async () => {
    const t = await listTemplate({ publicTags: [['p', A], ['client', 'Amethyst']], privateTags: [] }, { event: list({ created_at: 900 }), scheme: 'nip44' }, crypto, 50)
    expect(t).toEqual({ kind: MUTE_LIST_KIND, created_at: 901, tags: [['p', A]], content: '' })
  })

  it('refuses a private entry when the signer cannot encrypt', async () => {
    await expect(listTemplate({ publicTags: [], privateTags: [['p', A]] }, { event: null, scheme: 'none' }, {}, 1)).rejects.toThrow(WORDS.noEncrypt)
  })

  it('round-trips through readList', async () => {
    const t = await listTemplate({ publicTags: [['p', A]], privateTags: [['p', B]] }, { event: null, scheme: 'none' }, crypto, 7)
    const read = await readList(list({ ...t }), crypto)
    expect(read.publicTags).toEqual([['p', A]])
    expect(read.privateTags).toEqual([['p', B]])
  })
})

describe('choosing and trusting a fetch', () => {
  const ans = (url: string, outcome: RelayAnswer['outcome']): RelayAnswer =>
    outcome === 'answered' ? { url, outcome, events: [] } : { url, outcome, reason: 'x', events: [] }

  it('takes the newest list of this author only', () => {
    const old = list({ id: '2'.repeat(64), created_at: 1 })
    const fresh = list({ id: '3'.repeat(64), created_at: 2 })
    const theirs = list({ id: '4'.repeat(64), created_at: 9, pubkey: A })
    expect(newestList([old, fresh, theirs, null], me)?.id).toBe(fresh.id)
  })

  it('reads write relays from a kind 10002', () => {
    expect(writeRelaysOf({ tags: [['r', 'wss://w/'], ['r', 'wss://r', 'read'], ['r', 'wss://both'], ['r', 'ws://plain']] })).toEqual(['wss://w', 'wss://both'])
  })

  const G = ['wss://g1', 'wss://g2', 'wss://g3']
  const CANON = 'wss://canon'
  const ctx = (over: Partial<Parameters<typeof fetchRefusal>[1]> = {}) => ({ writeRelays: [], general: G, canonical: CANON, found: true, ...over })

  it('refuses when no relay answered, and the canonical relay alone does not count', () => {
    expect(fetchRefusal([ans('wss://g1', 'unreachable'), ans('wss://g2', 'refused')], ctx())).toBe(WORDS.noAnswer)
    expect(fetchRefusal([], ctx())).toBe(WORDS.noAnswer)
    expect(fetchRefusal([ans(CANON + '/', 'answered'), ans('wss://g1', 'unreachable')], ctx({ found: false }))).toBe(WORDS.noAnswer)
  })

  it('with no write relays, needs two general relays, or all of them when no list was returned', () => {
    expect(fetchRefusal([ans('wss://g1', 'answered'), ans('wss://g2', 'unreachable'), ans('wss://g3', 'unreachable')], ctx())).toBe(WORDS.generalSilent)
    expect(fetchRefusal([ans('wss://g1', 'answered'), ans('wss://g2', 'answered'), ans('wss://g3', 'unreachable')], ctx())).toBeNull()
    expect(fetchRefusal([ans('wss://g1', 'answered'), ans('wss://g2', 'answered'), ans('wss://g3', 'unreachable')], ctx({ found: false }))).toBe(WORDS.generalSilent)
    expect(fetchRefusal(G.map((u) => ans(u, 'answered')), ctx({ found: false }))).toBeNull()
  })

  it('with write relays, needs most of them, or all of them when no list was returned', () => {
    const w = ['wss://w1', 'wss://w2/', 'wss://w3']
    const some = [ans('wss://g1', 'answered'), ans('wss://g2', 'answered'), ans('wss://w1', 'answered'), ans('wss://w2', 'unreachable'), ans('wss://w3', 'unreachable')]
    expect(fetchRefusal(some, ctx({ writeRelays: w }))).toBe(WORDS.outboxSilent)
    const most = [ans('wss://W1', 'answered'), ans('wss://w2', 'answered'), ans('wss://w3', 'unreachable')]
    expect(fetchRefusal(most, ctx({ writeRelays: w }))).toBeNull()
    expect(fetchRefusal(most, ctx({ writeRelays: w, found: false }))).toBe(WORDS.outboxSilent)
  })

  it('counts the canonical relay when it is one of the person\'s own write relays (review of #464, round 2)', () => {
    // Their list lives on the canonical relay, which is silent: one general relay saying "nothing" is not enough.
    expect(fetchRefusal([ans(CANON, 'unreachable'), ans('wss://g1', 'answered')], ctx({ writeRelays: [CANON + '/'], found: false }))).toBe(WORDS.outboxSilent)
    expect(fetchRefusal([ans(CANON, 'unreachable'), ans('wss://g1', 'answered'), ans('wss://g2', 'answered')], ctx({ writeRelays: ['WSS://Canon.Example/'], found: true }))).toBe(WORDS.outboxSilent)
    // With a second write relay and no list found, both must answer.
    expect(fetchRefusal([ans(CANON, 'unreachable'), ans('wss://w2', 'answered')], ctx({ writeRelays: [CANON, 'wss://w2'], found: false }))).toBe(WORDS.outboxSilent)
    // Once it answers, it counts.
    expect(fetchRefusal([ans(CANON, 'answered'), ans('wss://w2', 'answered')], ctx({ writeRelays: [CANON, 'wss://w2'], found: false }))).toBeNull()
    // No relay to hear from at all is never enough.
    expect(fetchRefusal([ans('wss://x', 'answered')], ctx({ general: [CANON] }))).toBe(WORDS.noAnswer)
  })
})

describe('a thread less what is muted', () => {
  type C = { id: string; pubkey: string; replies: C[] }
  const c = (id: string, pubkey: string, replies: C[] = []): C => ({ id, pubkey, replies })
  const m = { pubkeys: new Set([B]), items: new Set<string>() }
  it('drops a blocked comment and the others under it, and lifts your replies into its place', () => {
    const roots = [c('1', A, [c('2', B, [c('3', me, [c('4', A)]), c('5', A)])]), c('6', B)]
    expect(pruneThread(roots, m, me)).toEqual([c('1', A, [c('3', me, [c('4', A)])])])
  })
  it('is the same list when nothing is muted', () => {
    const roots = [c('1', B)]
    expect(pruneThread(roots, { pubkeys: new Set(), items: new Set() }, me)).toBe(roots)
  })
})
