/**
 * tape.ts: reading Cyberspace's history forward, for Cyberspace TV.
 *
 * Relays answer "the newest N before this time", and a tape has to be played
 * oldest first, so the history is read in windows of time, each asked for
 * whole: a window that comes back full is halved and asked again, an empty
 * one is doubled for the next, so a busy afternoon is read in minutes and a
 * quiet week in one question. Dead air is skipped by the same doubling: the
 * reader never waits on it, it just asks for a longer stretch.
 *
 * Each relay's answer is judged on its own (as lib/secrets/rescan.ts does):
 * a relay caps how many events one filter returns at a number of its own and
 * says nothing, so an answer of CAP_SUSPECT or more from any relay counts as
 * full. A window no relay answered is not read at all, and is asked again:
 * it is never taken for an empty stretch of history (review of #370).
 */

import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { ACTION_KIND, parseAction, type NostrEvent } from '../events'
import type { Filter } from 'nostr-tools'
import { mergeAnswers, type RelayAnswer } from '../relayOutcome'
import { HIDDEN_KIND, OBJECT_KIND } from '../hidden'
import { parseHint } from '../hint'
import { COMMENT_KIND, PLACEHOLDER, parseComment } from '../comments'
import type { Beat, TapeItem } from './director'

/**
 * The first second of Cyberspace v2 on the relays: the earliest v2 spawn on
 * cyberspace.nostr1.com, 2026-08-23 03:26:47 UTC (measured 2026-10-18).
 * Everything before it is v1 tape, whose kind 3333 carried a
 * `["version", "1"]` tag and actions of its own (drift, noop).
 */
export const V2_EPOCH = 1787455607

/** Most events asked for in one window. */
export const WINDOW_LIMIT = 500
/**
 * An answer this long from one relay may be its cap rather than everything
 * it has (rescan.ts CAP_SUSPECT): the window is halved and asked again.
 */
export const CAP_SUSPECT = 100
/** The first window, and the bounds a window is kept within, in seconds. */
export const FIRST_WINDOW_S = 30 * 60
export const MIN_WINDOW_S = 30
export const MAX_WINDOW_S = 14 * 24 * 60 * 60

/** One question to every relay, each relay's answer kept (lib/relay queryEach). */
export type Ask = (filter: Filter) => Promise<RelayAnswer[]>

/** No relay answered: the question has to be asked again. */
export class TapeUnanswered extends Error {
  constructor() { super('no relay answered') }
}

/** The events of a question's answers, and whether any relay's answer may have been cut off. Throws when no relay answered. */
export function readAnswers(answers: RelayAnswer[]): { events: NostrEvent[]; full: boolean } {
  const answered = answers.filter((a) => a.outcome === 'answered')
  if (answered.length === 0) throw new TapeUnanswered()
  return { events: mergeAnswers(answers), full: answers.some((a) => a.events.length >= CAP_SUSPECT) }
}

/** Most pages read backwards for one whole-kind question (stats). */
export const MAX_PAGES = 50

/**
 * Every event a filter matches, paged backwards in time with `until` while
 * any relay's answer may have been cut off.
 */
export async function askAll(ask: Ask, filter: Filter): Promise<NostrEvent[]> {
  const byId = new Map<string, NostrEvent>()
  let until = filter.until
  for (let page = 0; page < MAX_PAGES; page++) {
    const { events, full } = readAnswers(await ask({ ...filter, limit: WINDOW_LIMIT, ...(until !== undefined ? { until } : {}) }))
    let fresh = 0
    for (const e of events) if (!byId.has(e.id)) { byId.set(e.id, e); fresh++ }
    if (!full || fresh === 0 || events.length === 0) break
    until = Math.min(...events.map((e) => e.created_at))
  }
  return [...byId.values()]
}

/** A movement event as a beat, or null for anything that is not one. */
export function beatOf(ev: NostrEvent): Beat | null {
  if (ev.kind !== ACTION_KIND) return null
  // v1 is another tape: its own actions, its own space.
  if (ev.tags.some((t) => t[0] === 'version')) return null
  const action = parseAction(ev)
  // A game's own actions move nobody in cyberspace (§8.11): not on the tape.
  if (!action || action.type === 'other' || action.role === 'broken') return null
  let from = { position: action.position, plane: action.plane as number }
  // An exit's `c` is where the game left off, which is the game's business
  // and not a place in cyberspace (events.ts parseAction): it starts where it lands.
  if (action.prevCoordHex && action.role !== 'exit') {
    try {
      const c = coordToXyz(hexToCoord(action.prevCoordHex))
      from = { position: { x: c.x, y: c.y, z: c.z }, plane: c.plane }
    } catch { /* an unreadable c: it starts where it lands */ }
  }
  return { id: ev.id, pubkey: ev.pubkey, at: ev.created_at, action, from }
}

/**
 * The kinds a comment on the tape answers: a move (kind 3333, public words)
 * or a bag (33330, words sealed to its region). The relay holds comments of
 * every other app as well (2026-10-18: 23 on moves and 19 on bags of 855),
 * which are not cyberspace's to show.
 */
export const COMMENTED_KINDS = [String(ACTION_KIND), String(HIDDEN_KIND)]

/** A bag, a public object or a cyberspace comment as a tape item; null for anything else. */
export function itemOf(ev: NostrEvent): TapeItem | null {
  const base = { id: ev.id, pubkey: ev.pubkey, at: ev.created_at }
  if (ev.kind === HIDDEN_KIND) {
    const h = Number(ev.tags.find((t) => t[0] === 'h')?.[1])
    const height = Number.isInteger(h) && h >= 0 && h <= 85 ? h : null
    return { kind: 'bag', ...base, height, hint: parseHint(ev.tags, height ?? 0) }
  }
  if (ev.kind === OBJECT_KIND) {
    // A sealed object (hidden by reference, or for sale) is not public.
    if (ev.tags.some((t) => t[0] === 'encrypted')) return null
    const d = ev.tags.find((t) => t[0] === 'd')?.[1]
    if (!d || d === 'avatar') return null
    return { kind: 'object', ...base, event: ev }
  }
  if (ev.kind === COMMENT_KIND) {
    const k = ev.tags.find((t) => t[0] === 'K')?.[1]
    if (!k || !COMMENTED_KINDS.includes(k)) return null
    const c = parseComment(ev)
    if (!c) return null
    const sealed = c.ciphertext !== null || c.preview === PLACEHOLDER
    const about = ev.tags.find((t) => t[0] === 'P')?.[1] ?? null
    return { kind: 'comment', ...base, on: k === String(ACTION_KIND) ? 'move' : 'bag', text: sealed ? null : c.preview, about }
  }
  return null
}

/** Signing order, ties by id, so two readers of the same tape agree. */
export function bySigning(a: { at: number; id: string }, b: { at: number; id: string }): number {
  return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * Reads the tape forward from `from`. Each `next()` reads one window and
 * gives its beats in signing order, plus how far the tape has now been read;
 * `readTo` reaching `now` means the tape has caught up with the present.
 */
export class TapeReader {
  /** Every second before this has been read. */
  readTo: number
  /**
   * The tape reached the present. Latched: a tape ends where it caught up,
   * rather than polling the live edge every second after (review of #370).
   */
  caughtUp = false
  private span = FIRST_WINDOW_S

  private kinds: number[]

  /** `withItems` false reads moves only. */
  constructor(from: number, private ask: Ask, private now: () => number = () => Math.floor(Date.now() / 1000), private withItems = true) {
    this.readTo = from
    this.kinds = withItems ? [ACTION_KIND, HIDDEN_KIND, OBJECT_KIND] : [ACTION_KIND]
  }

  /** The next window's beats. Throws TapeUnanswered, without moving on, when no relay answered. */
  async next(): Promise<Beat[]> {
    return (await this.read()).beats
  }

  /**
   * The next window: its moves as beats and its bags, objects and comments
   * as items, each in signing order. Two questions per window, the second
   * for comments on cyberspace's kinds only. Throws TapeUnanswered, without
   * moving on, when no relay answered either.
   */
  async read(): Promise<{ beats: Beat[]; items: TapeItem[] }> {
    if (this.caughtUp) return { beats: [], items: [] }
    for (;;) {
      const since = this.readTo
      const now = this.now()
      const until = Math.min(now, since + this.span - 1)
      if (until < since) { this.caughtUp = true; return { beats: [], items: [] } }
      const [things, comments] = await Promise.all([
        this.ask({ kinds: this.kinds, since, until, limit: WINDOW_LIMIT }),
        this.withItems ? this.ask({ kinds: [COMMENT_KIND], '#K': COMMENTED_KINDS, since, until, limit: WINDOW_LIMIT }) : Promise.resolve(null),
      ])
      const a = readAnswers(things)
      const b = comments ? readAnswers(comments) : { events: [], full: false }
      const events = [...a.events, ...b.events]
      const full = a.full || b.full
      if (full && this.span > MIN_WINDOW_S) {
        // Full: the relay may have left some out. Ask for half the time.
        this.span = Math.max(MIN_WINDOW_S, Math.floor(this.span / 2))
        continue
      }
      this.readTo = until + 1
      if (until >= now) this.caughtUp = true
      if (events.length < CAP_SUSPECT / 4) this.span = Math.min(MAX_WINDOW_S, this.span * 2)
      const beats: Beat[] = []
      const items: TapeItem[] = []
      // Windows never overlap, so no event comes back twice.
      for (const ev of events) {
        const beat = beatOf(ev)
        if (beat) { beats.push(beat); continue }
        const item = this.withItems ? itemOf(ev) : null
        if (item) items.push(item)
      }
      return { beats: beats.sort(bySigning), items: items.sort(bySigning) }
    }
  }
}

/** How long after a random moment to look for the event the tape starts on. */
export const START_LOOK_S = 6 * 60 * 60

/**
 * Where a tape starts: a random event (ruled 2026-10-18), found by picking a
 * random moment between `first` and now, reading the events after it, and
 * taking one of those at random. A random moment alone would usually land in
 * dead air. A few tries, then the earliest event after the last moment tried.
 */
export async function randomStart(first: number, ask: Ask, now = Math.floor(Date.now() / 1000), rand: () => number = Math.random): Promise<number | null> {
  for (let tries = 0; tries < 6; tries++) {
    const t = Math.floor(first + rand() * Math.max(1, now - first))
    const events = readAnswers(await ask({ kinds: [ACTION_KIND], since: t, until: t + START_LOOK_S, limit: WINDOW_LIMIT })).events
      .filter((e) => beatOf(e) !== null)
    if (events.length === 0) continue
    return events[Math.floor(rand() * events.length)].created_at
  }
  return null
}
