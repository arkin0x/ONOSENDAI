import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { v2 as nip44 } from 'nostr-tools/nip44'
import * as nip04 from 'nostr-tools/nip04'
import { MUTE_LIST_KIND, WORDS, type SelfCrypto } from '../../lib/muteList'
import type { NostrEvent } from '../../lib/events'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { hides, setMuteDeps, useMutes, type MuteDeps } from '../useMutes'

const sk = generateSecretKey()
const me = getPublicKey(sk)
const ck = nip44.utils.getConversationKey(sk, me)
const fullCrypto: SelfCrypto = {
  nip44Decrypt: async (p) => nip44.decrypt(p, ck),
  nip44Encrypt: async (p) => nip44.encrypt(p, ck),
  nip04Decrypt: async (p) => nip04.decrypt(sk, me, p),
  nip04Encrypt: async (p) => nip04.encrypt(sk, me, p),
}
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const ITEM = 'e'.repeat(64)

/** A list as another client would have written it, signed with the person's key. */
function otherClientList(publicTags: string[][], privateTags: string[][] | null, createdAt = 1_000, scheme: 'nip44' | 'nip04' = 'nip44'): NostrEvent {
  const content = privateTags === null ? '' : scheme === 'nip04' ? nip04.encrypt(sk, me, JSON.stringify(privateTags)) : nip44.encrypt(JSON.stringify(privateTags), ck)
  return finalizeEvent({ kind: MUTE_LIST_KIND, created_at: createdAt, tags: [...publicTags, ['client', 'Amethyst']], content }, sk) as unknown as NostrEvent
}

const answered = (url: string, events: NostrEvent[] = []): RelayAnswer => ({ url, outcome: 'answered', events })
const silent = (url: string): RelayAnswer => ({ url, outcome: 'unreachable', reason: 'no answer in time', events: [] })

interface Harness {
  answers: RelayAnswer[]
  writeRelays: string[]
  published: NostrEvent[]
  signed: number
  crypto: SelfCrypto
}

let h: Harness
const mem = new Map<string, string>()

function install(): void {
  const deps: Partial<MuteDeps> = {
    fetch: async () => ({ answers: h.answers, writeRelays: h.writeRelays }),
    publish: async (ev) => { h.published.push(ev); return { ok: true } },
    sign: async (t) => { h.signed++; return finalizeEvent(t, sk) as unknown as NostrEvent },
    crypto: () => h.crypto,
    self: () => me,
    now: () => 500,
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v) } },
  }
  setMuteDeps(deps)
}

/** The private half of what was published. */
function privateOf(ev: NostrEvent): string[][] {
  return ev.content ? JSON.parse(ev.content.includes('?iv=') ? nip04.decrypt(sk, me, ev.content) : nip44.decrypt(ev.content, ck)) : []
}

beforeEach(() => {
  mem.clear()
  h = { answers: [answered('wss://relay.damus.io')], writeRelays: [], published: [], signed: 0, crypto: fullCrypto }
  install()
  useMutes.setState({ pubkey: null, event: null, publicTags: [], privateTags: [], locked: false, loaded: false, busy: false, muted: { pubkeys: new Set(), items: new Set() } })
})

afterAll(() => { setMuteDeps(null) })

describe('writing merges into the newest list', () => {
  it('keeps another client\'s public and private entries when blocking', async () => {
    const theirs = otherClientList([['p', A], ['t', 'politics'], ['word', 'spoiler']], [['p', B], ['word', 'secret'], ['e', 'f'.repeat(64)]])
    h.answers = [answered('wss://relay.damus.io', [theirs])]
    const res = await useMutes.getState().block(C)
    expect(res).toEqual({ ok: true, changed: true })
    const out = h.published[0]
    expect(out.kind).toBe(MUTE_LIST_KIND)
    expect(out.tags).toEqual([['p', A], ['t', 'politics'], ['word', 'spoiler']])
    expect(privateOf(out)).toEqual([['p', B], ['word', 'secret'], ['e', 'f'.repeat(64)], ['p', C]])
    expect(out.created_at).toBeGreaterThan(theirs.created_at)
  })

  it('keeps a NIP-04 private half in NIP-04', async () => {
    const theirs = otherClientList([], [['p', B]], 1_000, 'nip04')
    h.answers = [answered('wss://relay.damus.io', [theirs])]
    await useMutes.getState().muteItem(ITEM)
    expect(h.published[0].content).toContain('?iv=')
    expect(privateOf(h.published[0])).toEqual([['p', B], ['e', ITEM]])
  })

  it('takes the newest across relays and this device', async () => {
    const older = otherClientList([['p', A]], null, 100)
    const newer = otherClientList([['p', B]], null, 200)
    h.answers = [answered('wss://relay.damus.io', [older]), answered('wss://nos.lol', [newer])]
    await useMutes.getState().block(C)
    expect(h.published[0].tags).toEqual([['p', B]])
    // A relay later answering with only the older copy must not roll it back.
    h.answers = [answered('wss://relay.damus.io', [older])]
    await useMutes.getState().unblock(B)
    expect(h.published[1].tags).toEqual([])
    expect(privateOf(h.published[1])).toEqual([['p', C]])
  })

  it('unblocks an entry another client wrote in public', async () => {
    h.answers = [answered('wss://relay.damus.io', [otherClientList([['p', A], ['t', 'x']], [['p', B]])])]
    await useMutes.getState().unblock(A)
    expect(h.published[0].tags).toEqual([['t', 'x']])
    expect(privateOf(h.published[0])).toEqual([['p', B]])
  })

  it('writes nothing when the entry is already there', async () => {
    h.answers = [answered('wss://relay.damus.io', [otherClientList([['p', A]], null)])]
    expect(await useMutes.getState().block(A)).toEqual({ ok: true, changed: false })
    expect(h.signed).toBe(0)
  })

  it('runs two quick taps one after the other, the second on top of the first', async () => {
    let last: NostrEvent | null = null
    setMuteDeps({
      fetch: async () => ({ answers: [answered('wss://relay.damus.io', last ? [last] : [])], writeRelays: [] }),
      publish: async (ev) => { last = ev; h.published.push(ev); return { ok: true } },
      sign: async (t) => finalizeEvent(t, sk) as unknown as NostrEvent,
      crypto: () => fullCrypto,
      self: () => me,
      now: () => 500,
      storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v) } },
    })
    await Promise.all([useMutes.getState().block(A), useMutes.getState().block(B)])
    expect(privateOf(h.published[1])).toEqual([['p', A], ['p', B]])
    install()
  })

  it('refuses to block yourself', async () => {
    expect(await useMutes.getState().block(me)).toMatchObject({ ok: false })
    expect(h.signed).toBe(0)
  })
})

describe('writing refuses rather than risk wiping the list', () => {
  it('when no relay answered', async () => {
    h.answers = [silent('wss://relay.damus.io'), silent('wss://nos.lol')]
    expect(await useMutes.getState().block(C)).toEqual({ ok: false, reason: WORDS.noAnswer })
    expect(h.signed).toBe(0)
    expect(h.published).toEqual([])
  })

  it('when the fetch itself fails', async () => {
    setMuteDeps({ ...{ fetch: async () => { throw new Error('offline') } }, sign: async () => { h.signed++; throw new Error('no') }, self: () => me, storage: { getItem: () => null, setItem: () => {} } })
    expect((await useMutes.getState().block(C)).ok).toBe(false)
    expect(h.signed).toBe(0)
    install()
  })

  it('when the person\'s own write relays did not answer', async () => {
    h.answers = [answered('wss://relay.damus.io'), silent('wss://my.relay')]
    h.writeRelays = ['wss://my.relay']
    expect(await useMutes.getState().block(C)).toEqual({ ok: false, reason: WORDS.outboxSilent })
    expect(h.signed).toBe(0)
  })

  it('when the private half cannot be opened', async () => {
    h.answers = [answered('wss://relay.damus.io', [otherClientList([['p', A]], [['p', B]])])]
    h.crypto = { nip44Encrypt: fullCrypto.nip44Encrypt }
    expect(await useMutes.getState().block(C)).toEqual({ ok: false, reason: WORDS.noDecrypt })
    h.crypto = { ...fullCrypto, nip44Decrypt: async () => { throw new Error('denied') } }
    expect(await useMutes.getState().block(C)).toEqual({ ok: false, reason: WORDS.cannotOpen })
    expect(h.signed).toBe(0)
  })

  it('when a private entry cannot be encrypted', async () => {
    h.crypto = { nip44Decrypt: fullCrypto.nip44Decrypt }
    expect(await useMutes.getState().block(C)).toEqual({ ok: false, reason: WORDS.noEncrypt })
    expect(h.signed).toBe(0)
  })

  it('when no relay took it, and the list on screen stays as it was', async () => {
    setMuteDeps({ fetch: async () => ({ answers: h.answers, writeRelays: [] }), publish: async () => ({ ok: false, reason: 'blocked: nope' }), sign: async (t) => finalizeEvent(t, sk) as unknown as NostrEvent, crypto: () => fullCrypto, self: () => me, now: () => 500, storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v) } } })
    const res = await useMutes.getState().block(C)
    expect(res.ok).toBe(false)
    expect(useMutes.getState().muted.pubkeys.has(C)).toBe(false)
    install()
  })
})

describe('reading', () => {
  it('filters by both halves and opens the private half once per event', async () => {
    const decrypt = vi.fn(fullCrypto.nip44Decrypt!)
    h.crypto = { ...fullCrypto, nip44Decrypt: decrypt }
    h.answers = [answered('wss://relay.damus.io', [otherClientList([['p', A]], [['p', B], ['e', ITEM]])])]
    await useMutes.getState().refresh()
    await useMutes.getState().refresh()
    const s = useMutes.getState()
    expect([...s.muted.pubkeys].sort()).toEqual([A, B])
    expect(s.muted.items.has(ITEM)).toBe(true)
    expect(s.locked).toBe(false)
    expect(s.loaded).toBe(true)
    expect(decrypt).toHaveBeenCalledTimes(1)
  })

  it('keeps filtering with the last private half it read when a newer one will not open', async () => {
    h.answers = [answered('wss://relay.damus.io', [otherClientList([], [['p', B]], 100)])]
    await useMutes.getState().refresh()
    h.answers = [answered('wss://relay.damus.io', [otherClientList([], [['p', B], ['p', C]], 200)])]
    h.crypto = { ...fullCrypto, nip44Decrypt: async () => { throw new Error('denied') } }
    await useMutes.getState().refresh()
    const s = useMutes.getState()
    expect(s.locked).toBe(true)
    expect(s.muted.pubkeys.has(B)).toBe(true)
  })

  it('keeps the list it has when the relays are down', async () => {
    h.answers = [answered('wss://relay.damus.io', [otherClientList([['p', A]], null)])]
    await useMutes.getState().refresh()
    h.answers = [silent('wss://relay.damus.io')]
    await useMutes.getState().refresh()
    expect(useMutes.getState().muted.pubkeys.has(A)).toBe(true)
  })

  it('never hides your own things, even if your list names you', async () => {
    h.answers = [answered('wss://relay.damus.io', [otherClientList([['p', me], ['p', A]], null)])]
    await useMutes.getState().refresh()
    const m = useMutes.getState().muted
    expect(m.pubkeys.has(me)).toBe(false)
    expect(hides(m, me, null, me)).toBe(false)
    expect(hides(m, A, null, me)).toBe(true)
    expect(hides(m, B, ITEM, me)).toBe(false)
  })
})
