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
import { MUTE_LIST_KIND, WORDS, hidesThing, type SelfCrypto } from '../../lib/muteList'
import type { NostrEvent } from '../../lib/events'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { setMuteDeps, useMutes, type MuteDeps } from '../useMutes'

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
const GENERAL = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']
const CANON = 'wss://canon.example'

/** A list as another client would have written it, signed with the person's key. */
function otherClientList(publicTags: string[][], privateTags: unknown[] | null, createdAt = 1_000, scheme: 'nip44' | 'nip04' = 'nip44'): NostrEvent {
  const content = privateTags === null ? '' : scheme === 'nip04' ? nip04.encrypt(sk, me, JSON.stringify(privateTags)) : nip44.encrypt(JSON.stringify(privateTags), ck)
  return finalizeEvent({ kind: MUTE_LIST_KIND, created_at: createdAt, tags: [...publicTags, ['client', 'Amethyst']], content }, sk) as unknown as NostrEvent
}

const answered = (url: string, events: NostrEvent[] = []): RelayAnswer => ({ url, outcome: 'answered', events })
const silent = (url: string): RelayAnswer => ({ url, outcome: 'unreachable', reason: 'no answer in time', events: [] })
/** Every general relay answered; the first holds `events`. */
const allAnswer = (events: NostrEvent[] = []): RelayAnswer[] => GENERAL.map((u, i) => answered(u, i === 0 ? events : []))

interface Harness {
  answers: RelayAnswer[]
  writeRelays: string[]
  published: NostrEvent[]
  signed: number
  crypto: SelfCrypto
  now: number
}

let h: Harness
const mem = new Map<string, string>()
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } }

function deps(over: Partial<MuteDeps> = {}): Partial<MuteDeps> {
  return {
    fetch: async () => ({ answers: h.answers, writeRelays: h.writeRelays }),
    publish: async (ev) => { h.published.push(ev); return { ok: true } },
    sign: async (t) => { h.signed++; return finalizeEvent(t, sk) as unknown as NostrEvent },
    crypto: () => h.crypto,
    self: () => me,
    now: () => h.now,
    storage,
    general: GENERAL,
    canonical: CANON,
    ...over,
  }
}

/** The private half of what was published. */
function privateOf(ev: NostrEvent): unknown[] {
  return ev.content ? JSON.parse(ev.content.includes('?iv=') ? nip04.decrypt(sk, me, ev.content) : nip44.decrypt(ev.content, ck)) : []
}

beforeEach(() => {
  mem.clear()
  h = { answers: allAnswer(), writeRelays: [], published: [], signed: 0, crypto: fullCrypto, now: 500 }
  setMuteDeps(deps())
  useMutes.setState({ pubkey: null, event: null, publicTags: [], privateTags: [], locked: false, loaded: false, busy: false, muted: { pubkeys: new Set(), items: new Set() } })
})

afterAll(() => { setMuteDeps(null) })

describe('writing merges into the newest list', () => {
  it('keeps another client\'s public and private entries when blocking', async () => {
    const theirs = otherClientList([['p', A], ['t', 'politics'], ['word', 'spoiler']], [['p', B], ['word', 'secret'], ['e', 'f'.repeat(64)]])
    h.answers = allAnswer([theirs])
    const res = await useMutes.getState().block(C)
    expect(res).toEqual({ ok: true, changed: true })
    const out = h.published[0]
    expect(out.kind).toBe(MUTE_LIST_KIND)
    expect(out.tags).toEqual([['p', A], ['t', 'politics'], ['word', 'spoiler']])
    expect(privateOf(out)).toEqual([['p', B], ['word', 'secret'], ['e', 'f'.repeat(64)], ['p', C]])
    expect(out.created_at).toBeGreaterThan(theirs.created_at)
  })

  it('keeps private entries this app cannot read, exactly as written', async () => {
    const odd = [['p', 'd'.repeat(64), null], ['p', B], { note: 1 }]
    h.answers = allAnswer([otherClientList([], odd)])
    await useMutes.getState().block(C)
    expect(privateOf(h.published[0])).toEqual([...odd, ['p', C]])
  })

  it('keeps a NIP-04 private half in NIP-04', async () => {
    h.answers = allAnswer([otherClientList([], [['p', B]], 1_000, 'nip04')])
    await useMutes.getState().muteItem(ITEM)
    expect(h.published[0].content).toContain('?iv=')
    expect(privateOf(h.published[0])).toEqual([['p', B], ['e', ITEM]])
  })

  it('takes the newest across relays and this device', async () => {
    const older = otherClientList([['p', A]], null, 100)
    const newer = otherClientList([['p', B]], null, 200)
    h.answers = [answered(GENERAL[0], [older]), answered(GENERAL[1], [newer]), silent(GENERAL[2])]
    await useMutes.getState().block(C)
    expect(h.published[0].tags).toEqual([['p', B]])
    // A relay later answering with only the older copy must not roll it back.
    h.answers = allAnswer([older])
    await useMutes.getState().unblock(B)
    expect(h.published[1].tags).toEqual([])
    expect(privateOf(h.published[1])).toEqual([['p', C]])
  })

  it('unblocks an entry another client wrote in public', async () => {
    h.answers = allAnswer([otherClientList([['p', A], ['t', 'x']], [['p', B]])])
    await useMutes.getState().unblock(A)
    expect(h.published[0].tags).toEqual([['t', 'x']])
    expect(privateOf(h.published[0])).toEqual([['p', B]])
  })

  it('writes nothing when the entry is already there', async () => {
    h.answers = allAnswer([otherClientList([['p', A]], null)])
    expect(await useMutes.getState().block(A)).toEqual({ ok: true, changed: false })
    expect(h.signed).toBe(0)
  })

  it('runs two quick taps one after the other, the second on top of the first, busy throughout', async () => {
    let last: NostrEvent | null = null
    const busy: boolean[] = []
    const unsub = useMutes.subscribe((s) => busy.push(s.busy))
    setMuteDeps(deps({
      fetch: async () => ({ answers: allAnswer(last ? [last] : []), writeRelays: [] }),
      publish: async (ev) => { last = ev; h.published.push(ev); return { ok: true } },
    }))
    await Promise.all([useMutes.getState().block(A), useMutes.getState().block(B)])
    unsub()
    expect(privateOf(h.published[1])).toEqual([['p', A], ['p', B]])
    // busy went true once and false once, never flickering between the two edits.
    expect(busy.filter((b, i) => i === 0 || b !== busy[i - 1])).toEqual([true, false])
  })

  it('refuses to block yourself, and an item id that is not one', async () => {
    expect(await useMutes.getState().block(me)).toMatchObject({ ok: false })
    expect(await useMutes.getState().muteItem('lookup/entry')).toEqual({ ok: false, reason: WORDS.notAnItem })
    expect(h.signed).toBe(0)
  })
})

describe('writing refuses rather than risk wiping the list', () => {
  it('when no relay answered', async () => {
    h.answers = GENERAL.map(silent)
    expect(await useMutes.getState().block(C)).toEqual({ ok: false, reason: WORDS.noAnswer })
    expect(h.signed).toBe(0)
    expect(h.published).toEqual([])
  })

  it('when only the canonical relay answered, on a fresh device (review of #464, B1)', async () => {
    h.answers = [answered(CANON), ...GENERAL.map(silent)]
    expect(await useMutes.getState().block(C)).toEqual({ ok: false, reason: WORDS.noAnswer })
    expect(h.signed).toBe(0)
  })

  it('when a relay holding the list is silent and nothing came back (stale device copy, review of #464, B1)', async () => {
    // This device kept an older list; another client added B on a relay that is silent now.
    h.answers = allAnswer([otherClientList([['p', A]], null, 100)])
    await useMutes.getState().refresh()
    h.answers = [answered(GENERAL[0]), answered(GENERAL[1]), silent(GENERAL[2])]
    expect(await useMutes.getState().block(C)).toEqual({ ok: false, reason: WORDS.generalSilent })
    expect(h.signed).toBe(0)
  })

  it('when the fetch itself fails', async () => {
    setMuteDeps(deps({ fetch: async () => { throw new Error('offline') } }))
    expect((await useMutes.getState().block(C)).ok).toBe(false)
    expect(h.signed).toBe(0)
  })

  it('when too few of the person\'s own write relays answered', async () => {
    h.answers = [...allAnswer([otherClientList([['p', A]], null)]), silent('wss://my.relay')]
    h.writeRelays = ['wss://my.relay']
    expect(await useMutes.getState().block(C)).toEqual({ ok: false, reason: WORDS.outboxSilent })
    expect(h.signed).toBe(0)
  })

  it('when the private half cannot be opened', async () => {
    h.answers = allAnswer([otherClientList([['p', A]], [['p', B]])])
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
    setMuteDeps(deps({ publish: async () => ({ ok: false, reason: 'blocked: nope' }) }))
    const res = await useMutes.getState().block(C)
    expect(res.ok).toBe(false)
    expect(useMutes.getState().muted.pubkeys.has(C)).toBe(false)
  })
})

describe('reading', () => {
  it('filters by both halves and opens the private half once per event', async () => {
    const decrypt = vi.fn(fullCrypto.nip44Decrypt!)
    h.crypto = { ...fullCrypto, nip44Decrypt: decrypt }
    h.answers = allAnswer([otherClientList([['p', A]], [['p', B], ['e', ITEM]])])
    await useMutes.getState().refresh()
    const first = useMutes.getState().muted
    await useMutes.getState().refresh()
    const s = useMutes.getState()
    expect([...s.muted.pubkeys].sort()).toEqual([A, B])
    expect(s.muted.items.has(ITEM)).toBe(true)
    expect(s.locked).toBe(false)
    expect(s.loaded).toBe(true)
    expect(decrypt).toHaveBeenCalledTimes(1)
    // Nothing new: the same object, so nothing keyed on it re-derives (review of #464, S7).
    expect(s.muted).toBe(first)
  })

  it('keeps filtering with the last private half it read when a newer one will not open, and RETRY opens it', async () => {
    h.answers = allAnswer([otherClientList([], [['p', B]], 100)])
    await useMutes.getState().refresh()
    h.answers = allAnswer([otherClientList([], [['p', B], ['p', C]], 200)])
    h.crypto = { ...fullCrypto, nip44Decrypt: async () => { throw new Error('denied') } }
    await useMutes.getState().refresh()
    expect(useMutes.getState().locked).toBe(true)
    expect(useMutes.getState().muted.pubkeys.has(B)).toBe(true)
    // A plain refresh does not ask again (no prompt on every resume); RETRY does (review of #464, S3).
    h.crypto = fullCrypto
    await useMutes.getState().refresh()
    expect(useMutes.getState().locked).toBe(true)
    await useMutes.getState().refresh({ retry: true })
    expect(useMutes.getState().locked).toBe(false)
    expect(useMutes.getState().muted.pubkeys.has(C)).toBe(true)
  })

  it('a refresh answering late never rolls an edit back (review of #464, S1)', async () => {
    const x1 = otherClientList([], [['p', B]], 100)
    h.answers = allAnswer([x1])
    // The refresh's decrypt is held while BLOCK C goes out.
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    let calls = 0
    h.crypto = { ...fullCrypto, nip44Decrypt: async (p) => { if (calls++ === 0) await held; return fullCrypto.nip44Decrypt!(p) } }
    const refreshing = useMutes.getState().refresh()
    await new Promise((r) => setTimeout(r, 0))
    expect(await useMutes.getState().block(C)).toEqual({ ok: true, changed: true })
    release()
    await refreshing
    expect(useMutes.getState().muted.pubkeys.has(C)).toBe(true)
    // The next edit, with relays still returning only x1, keeps the block of C.
    await useMutes.getState().muteItem(ITEM)
    expect(privateOf(h.published[1])).toEqual([['p', B], ['p', C], ['e', ITEM]])
  })

  it('keeps the list it has when the relays are down', async () => {
    h.answers = allAnswer([otherClientList([['p', A]], null)])
    await useMutes.getState().refresh()
    h.answers = GENERAL.map(silent)
    await useMutes.getState().refresh()
    expect(useMutes.getState().muted.pubkeys.has(A)).toBe(true)
  })

  it('ignores a device copy whose signature does not verify', async () => {
    const forged = { ...otherClientList([['p', A]], null), sig: '0'.repeat(128) }
    mem.set(`onosendai:mutes:${me}`, JSON.stringify({ event: forged, privateTags: [], lastPrivate: [] }))
    h.answers = allAnswer()
    await useMutes.getState().refresh()
    expect(useMutes.getState().muted.pubkeys.has(A)).toBe(false)
  })

  it('never hides your own things, even if your list names you', async () => {
    h.answers = allAnswer([otherClientList([['p', me], ['p', A]], null)])
    await useMutes.getState().refresh()
    const m = useMutes.getState().muted
    expect(m.pubkeys.has(me)).toBe(false)
    expect(hidesThing(m, { authors: [me] }, me)).toBe(false)
    expect(hidesThing(m, { authors: [A] }, me)).toBe(true)
  })
})
