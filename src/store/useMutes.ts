/**
 * useMutes.ts - who and what this identity has muted or blocked (NIP-51 kind
 * 10000, lib/muteList.ts), and the one way to change it.
 *
 * Reading. On every identity, the newest kind 10000 is asked of the general
 * relays, the configured relays and the person's own write relays (NIP-65),
 * and laid beside the copy kept on this device. The private half is opened
 * only when the event differs from the kept one, so a signer that prompts
 * for a decrypt is asked once per change, not once per load. When it cannot
 * be opened, the last private entries read on this device keep filtering
 * (stale beats showing a blocked person again) and `locked` says so; RETRY
 * asks the signer again.
 *
 * Writing. Every edit fetches the newest list again, opens it whole and
 * merges into it (lib/muteList applyEdit), so another client's entries,
 * public or private, survive, whatever their shape. It is refused, and
 * nothing is signed, when too few of the relays that hold lists answered
 * (lib/muteList fetchRefusal) or when the private half cannot be opened: a
 * list rebuilt from less than the whole would replace the person's mutes
 * everywhere. Edits run one at a time. Only an explicit tap calls an edit;
 * nothing here publishes on its own.
 *
 * Filtering. `muted` is the set the screens hide by (lib/muteList
 * hidesThing); the identity's own pubkey is never in it. It is the same
 * object until what it names changes, so a refresh that finds nothing new
 * re-derives nothing.
 */

import { create } from 'zustand'
import { verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from '../lib/events'
import type { RelayAnswer } from '../lib/relayOutcome'
import {
  MUTE_LIST_KIND,
  MuteListUnreadable,
  NOTHING_MUTED,
  WORDS,
  applyEdit,
  fetchRefusal,
  isHex64,
  listTemplate,
  mutedBy,
  newestList,
  openPrivate,
  schemeOf,
  writeRelaysOf,
  type MuteEdit,
  type Scheme,
  type Muted,
  type SelfCrypto,
  type Tag,
} from '../lib/muteList'
import { GENERAL_RELAYS } from '../lib/contacts'
import { RELAY_LIST_KIND } from '../lib/inbox'
import { onResume, publishMany, queryEachAt, relaySet, type PublishResult } from '../lib/relay'
import { DEFAULT_RELAY } from './useRelays'
import { useCyberspace } from './useCyberspace'

/** How long a list fetch waits on each relay. */
const FETCH_MS = 6000
/** A person is reading the signer's prompt. */
const SIGN_PATIENCE_MS = 120_000

/** What the store needs from the outside world; replaced in tests (setMuteDeps). */
export interface MuteDeps {
  /** Every relay's answer to "this person's kind 10000 (and 10002)", and the write relays their 10002 names. */
  fetch: (pubkey: string) => Promise<{ answers: RelayAnswer[]; writeRelays: string[] }>
  publish: (event: NostrEvent, writeRelays: string[]) => Promise<PublishResult>
  sign: (template: Parameters<ReturnType<typeof useCyberspace.getState>['signEvent']>[0]) => Promise<NostrEvent>
  crypto: () => SelfCrypto
  self: () => string
  now: () => number
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  /** The general relays (where lists live) and the canonical relay (whose answer proves nothing): fetchRefusal. */
  general: readonly string[]
  canonical: string
}

function norm(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

/** The general relays and every configured one, once each. */
function baseRelays(): string[] {
  const out: string[] = []
  for (const r of [...GENERAL_RELAYS, ...relaySet()]) if (!out.some((x) => norm(x) === norm(r))) out.push(r)
  return out
}

const liveDeps: MuteDeps = {
  fetch: async (pubkey) => {
    const base = baseRelays()
    const first = await queryEachAt(base, { kinds: [MUTE_LIST_KIND, RELAY_LIST_KIND], authors: [pubkey] }, FETCH_MS)
    const relayLists = first.flatMap((a) => a.events).filter((e) => e.kind === RELAY_LIST_KIND && e.pubkey === pubkey)
    const newestRelayList = relayLists.sort((a, b) => b.created_at - a.created_at)[0]
    const writeRelays = writeRelaysOf(newestRelayList)
    const extra = writeRelays.filter((w) => !base.some((b) => norm(b) === norm(w)))
    const second = extra.length ? await queryEachAt(extra, { kinds: [MUTE_LIST_KIND], authors: [pubkey] }, FETCH_MS) : []
    return { answers: [...first, ...second], writeRelays }
  },
  publish: (event, writeRelays) => {
    const to = baseRelays()
    for (const w of writeRelays) if (!to.some((x) => norm(x) === norm(w))) to.push(w)
    return publishMany(to, event)
  },
  sign: (template) => useCyberspace.getState().signEvent(template, SIGN_PATIENCE_MS),
  crypto: () => useCyberspace.getState().selfCrypto(),
  self: () => useCyberspace.getState().identity.pubkey,
  now: () => Math.floor(Date.now() / 1000),
  storage: typeof localStorage !== 'undefined' ? localStorage : null,
  general: GENERAL_RELAYS,
  canonical: DEFAULT_RELAY,
}

let deps: MuteDeps = liveDeps

/** Tests only: swap the relays, signer and storage. Returns the previous deps. */
export function setMuteDeps(next: Partial<MuteDeps> | null): MuteDeps {
  const prev = deps
  deps = next ? { ...liveDeps, ...next } : liveDeps
  return prev
}

/** What this device keeps of a person's list: the event, and its private half once opened. */
interface Kept {
  event: NostrEvent | null
  /** The private half of `event`, every entry as written, or null when it has not been opened. */
  privateTags: Tag[] | null
  /** The last private half that WAS opened, from this event or an older one: what filters while the newest is locked. */
  lastPrivate: Tag[]
}

const keyFor = (pubkey: string): string => `onosendai:mutes:${pubkey}`
const EMPTY: Kept = { event: null, privateTags: null, lastPrivate: [] }

/** This device's copy. Its event must be this person's list and carry a valid signature, since an edit may start from it. */
function loadKept(pubkey: string): Kept {
  try {
    const raw = deps.storage?.getItem(keyFor(pubkey))
    if (!raw) return EMPTY
    const v = JSON.parse(raw) as Partial<Kept>
    const e = v.event
    const event = e && e.pubkey === pubkey && e.kind === MUTE_LIST_KIND && verifyEvent({ ...e } as Parameters<typeof verifyEvent>[0]) ? e : null
    return { event, privateTags: event && Array.isArray(v.privateTags) ? v.privateTags : null, lastPrivate: Array.isArray(v.lastPrivate) ? v.lastPrivate : [] }
  } catch {
    return EMPTY
  }
}

function saveKept(pubkey: string, kept: Kept): void {
  try { deps.storage?.setItem(keyFor(pubkey), JSON.stringify(kept)) } catch { /* private mode, quota */ }
}

/**
 * Keeps `next` only when it is still the newest: a decrypt or a publish
 * awaited meanwhile may have let another write land first (review of #464,
 * S1: a refresh's late answer rolled an edit back). Returns what is kept.
 */
function keepIfNewest(pubkey: string, next: Kept): Kept {
  const now = loadKept(pubkey)
  if (now.event && next.event && now.event.id !== next.event.id && newestList([now.event, next.event], pubkey) !== next.event) return now
  if (now.event && next.event && now.event.id === next.event.id && now.privateTags !== null && next.privateTags === null) return now
  saveKept(pubkey, next)
  return next
}

export type EditResult = { ok: true; changed: boolean } | { ok: false; reason: string }

interface MutesState {
  /** Whose list this is. */
  pubkey: string | null
  event: NostrEvent | null
  publicTags: Tag[]
  /** The private half as last opened (the newest event's, unless `locked`). */
  privateTags: Tag[]
  /** The newest list's private half could not be opened on this device. */
  locked: boolean
  /** The relays have been asked at least once for this identity, and answered or not. */
  loaded: boolean
  /** An edit is being fetched, signed or published, or is waiting its turn. */
  busy: boolean
  /** Pubkeys and item ids to hide; never the identity's own pubkey. */
  muted: Muted
  /** Ask the relays for the newest list (on identity change and on resume); `retry` asks the signer again for a locked private half. */
  refresh: (opts?: { retry?: boolean }) => Promise<void>
  block: (pubkey: string) => Promise<EditResult>
  unblock: (pubkey: string) => Promise<EditResult>
  muteItem: (id: string) => Promise<EditResult>
  unmuteItem: (id: string) => Promise<EditResult>
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

/** Errors become one sentence for a toast. */
function reasonOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** The edits, one after another, so two quick taps never write over each other. */
let queue: Promise<unknown> = Promise.resolve()
/** How many edits are running or waiting: `busy` holds for all of them. */
let pending = 0
/** Counts loads, so an answer for an earlier identity or an earlier ask is dropped. */
let loadSeq = 0

export const useMutes = create<MutesState>((set, get) => {
  /** The state for a kept list, with `muted` the same object when it names the same things. */
  function stateFrom(pubkey: string, kept: Kept): Pick<MutesState, 'pubkey' | 'event' | 'publicTags' | 'privateTags' | 'locked' | 'muted'> {
    const publicTags = kept.event?.tags ?? []
    const locked = !!kept.event && schemeOf(kept.event.content) !== 'none' && kept.privateTags === null
    const privateTags = kept.privateTags ?? kept.lastPrivate
    const next = mutedBy([...publicTags, ...privateTags], pubkey)
    const prev = get().muted
    const muted = get().pubkey === pubkey && sameSet(prev.pubkeys, next.pubkeys) && sameSet(prev.items, next.items) ? prev : next
    return { pubkey, event: kept.event, publicTags, privateTags, locked, muted }
  }

  /** Lay a newer event beside what is kept, opening its private half if it has one. */
  async function adopt(pubkey: string, fetched: NostrEvent | null, seq: number, retry: boolean): Promise<void> {
    const kept = loadKept(pubkey)
    const newest = newestList([kept.event, fetched], pubkey)
    const lockedNow = !!newest && newest.id === kept.event?.id && kept.privateTags === null && schemeOf(newest.content) !== 'none'
    if (!newest || (newest.id === kept.event?.id && !(lockedNow && retry))) {
      if (seq === loadSeq) set(stateFrom(pubkey, kept))
      return
    }
    let privateTags: Tag[] | null = null
    try { privateTags = (await openPrivate(newest.content, deps.crypto())).tags } catch { privateTags = null }
    if (deps.self() !== pubkey) return
    // An older open is kept as the stand-in while this one is locked.
    const latest = loadKept(pubkey)
    const saved = keepIfNewest(pubkey, { event: newest, privateTags, lastPrivate: privateTags ?? latest.privateTags ?? latest.lastPrivate })
    if (get().pubkey === pubkey) set(stateFrom(pubkey, saved))
  }

  async function edit(edit: MuteEdit): Promise<EditResult> {
    const run = async (): Promise<EditResult> => {
      const me = deps.self()
      const value = edit.tag[1].trim().toLowerCase()
      // Only a real id or pubkey is an entry anything can hide by (review of #464, B2).
      if (!isHex64(value)) return { ok: false, reason: edit.tag[0] === 'e' ? WORDS.notAnItem : 'That is not a pubkey. Nothing was changed.' }
      if (edit.tag[0] === 'p' && edit.op === 'add' && value === me) return { ok: false, reason: 'You cannot block yourself.' }
      try {
        let fetched: { answers: RelayAnswer[]; writeRelays: string[] }
        try { fetched = await deps.fetch(me) } catch { return { ok: false, reason: WORDS.noAnswer } }
        const fromRelays = newestList(fetched.answers.flatMap((a) => a.events), me)
        const refusal = fetchRefusal(fetched.answers, { writeRelays: fetched.writeRelays, general: deps.general, canonical: deps.canonical, found: !!fromRelays })
        if (refusal) return { ok: false, reason: refusal }
        // The newest of what the relays hold and what this device last saw:
        // a relay that lost the list must not make it look empty.
        const kept = loadKept(me)
        const base = newestList([kept.event, fromRelays], me)
        const crypto = deps.crypto()
        let current: { publicTags: Tag[]; privateTags: Tag[]; scheme: Scheme }
        if (base && base.id === kept.event?.id && kept.privateTags !== null) {
          current = { publicTags: base.tags, privateTags: kept.privateTags, scheme: schemeOf(base.content) }
        } else if (base) {
          const opened = await openPrivate(base.content, crypto)
          current = { publicTags: base.tags, privateTags: opened.tags, scheme: opened.scheme }
        } else {
          current = { publicTags: [], privateTags: [], scheme: 'none' }
        }
        const next = applyEdit(current, edit)
        if (deps.self() !== me) return { ok: false, reason: 'The identity changed, so nothing was written.' }
        if (!next.changed) {
          // Nothing to write, but the newest list is now known and open: keep it.
          if (base) {
            const saved = keepIfNewest(me, { event: base, privateTags: current.privateTags, lastPrivate: current.privateTags })
            if (get().pubkey === me) set(stateFrom(me, saved))
          }
          return { ok: true, changed: false }
        }
        const template = await listTemplate(next, { event: base, scheme: current.scheme }, crypto, deps.now())
        const signed = await deps.sign(template)
        if (signed.pubkey !== me || deps.self() !== me) return { ok: false, reason: 'The identity changed, so nothing was written.' }
        const result = await deps.publish(signed, fetched.writeRelays)
        if (!result.ok) return { ok: false, reason: `No relay took your mute list (${result.reason}). Nothing changed.` }
        const saved = keepIfNewest(me, { event: signed, privateTags: next.privateTags, lastPrivate: next.privateTags })
        if (get().pubkey === me) set(stateFrom(me, saved))
        return { ok: true, changed: true }
      } catch (err) {
        if (err instanceof MuteListUnreadable) return { ok: false, reason: err.message }
        return { ok: false, reason: reasonOf(err, 'The signer did not sign your mute list. Nothing changed.') }
      }
    }
    pending++
    set({ busy: true })
    const p = queue.then(run, run).finally(() => {
      pending--
      if (pending === 0) set({ busy: false })
    })
    queue = p.catch(() => undefined)
    return p
  }

  return {
    pubkey: null,
    event: null,
    publicTags: [],
    privateTags: [],
    locked: false,
    loaded: false,
    busy: false,
    muted: NOTHING_MUTED,

    refresh: async (opts = {}) => {
      const me = deps.self()
      const seq = ++loadSeq
      if (get().pubkey !== me) set({ ...stateFrom(me, loadKept(me)), loaded: false })
      let fetched: NostrEvent | null = null
      try {
        const { answers } = await deps.fetch(me)
        fetched = newestList(answers.flatMap((a) => a.events), me)
      } catch { /* relays down: the kept copy stands */ }
      if (seq !== loadSeq || deps.self() !== me) return
      await adopt(me, fetched, seq, !!opts.retry)
      if (seq === loadSeq && deps.self() === me) set({ loaded: true })
    },

    block: (pubkey) => edit({ op: 'add', tag: ['p', pubkey], private: true }),
    unblock: (pubkey) => edit({ op: 'remove', tag: ['p', pubkey] }),
    muteItem: (id) => edit({ op: 'add', tag: ['e', id], private: true }),
    unmuteItem: (id) => edit({ op: 'remove', tag: ['e', id] }),
  }
})

let started = false

/** Loads the list for every identity, and again whenever the tab or the network comes back. */
export function startMutes(): void {
  if (started) return
  started = true
  void useMutes.getState().refresh()
  useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey !== prev.identity.pubkey) void useMutes.getState().refresh()
  })
  onResume(() => { void useMutes.getState().refresh() })
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __mutes: typeof useMutes }).__mutes = useMutes
}
