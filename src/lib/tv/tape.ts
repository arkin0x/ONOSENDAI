/**
 * tape.ts: reading Cyberspace's history forward, for Cyberspace TV.
 *
 * Relays answer "the newest N before this time", and a tape has to be played
 * oldest first, so the history is read in windows of time, each asked for
 * whole: a window that comes back full is halved and asked again, an empty
 * one is doubled for the next, so a busy afternoon is read in minutes and a
 * quiet week in one question. Dead air is skipped by the same doubling: the
 * reader never waits on it, it just asks for a longer stretch.
 */

import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { ACTION_KIND, parseAction, type NostrEvent } from '../events'
import type { Filter } from 'nostr-tools'
import type { Beat } from './director'

/**
 * The first second of Cyberspace v2 on the relays: the earliest v2 spawn on
 * cyberspace.nostr1.com, 2026-08-23 03:26:47 UTC (measured 2026-10-18).
 * Everything before it is v1 tape, whose kind 3333 carried a
 * `["version", "1"]` tag and actions of its own (drift, noop).
 */
export const V2_EPOCH = 1787455607

/** Most events asked for in one window. */
export const WINDOW_LIMIT = 2000
/** The first window, and the bounds a window is kept within, in seconds. */
export const FIRST_WINDOW_S = 30 * 60
export const MIN_WINDOW_S = 30
export const MAX_WINDOW_S = 14 * 24 * 60 * 60

export type Ask = (filter: Filter) => Promise<NostrEvent[]>

/** A movement event as a beat, or null for anything that is not one. */
export function beatOf(ev: NostrEvent): Beat | null {
  if (ev.kind !== ACTION_KIND) return null
  // v1 is another tape: its own actions, its own space.
  if (ev.tags.some((t) => t[0] === 'version')) return null
  const action = parseAction(ev)
  // A game's own actions move nobody in cyberspace (§8.11): not on the tape.
  if (!action || action.type === 'other' || action.role === 'broken') return null
  let from = { position: action.position, plane: action.plane as number }
  if (action.prevCoordHex) {
    try {
      const c = coordToXyz(hexToCoord(action.prevCoordHex))
      from = { position: { x: c.x, y: c.y, z: c.z }, plane: c.plane }
    } catch { /* an unreadable c: it starts where it lands */ }
  }
  return { id: ev.id, pubkey: ev.pubkey, at: ev.created_at, action, from }
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
  private span = FIRST_WINDOW_S
  private seen = new Set<string>()

  constructor(from: number, private ask: Ask, private now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.readTo = from
  }

  get caughtUp(): boolean {
    return this.readTo >= this.now()
  }

  async next(): Promise<Beat[]> {
    for (;;) {
      const since = this.readTo
      const until = Math.min(this.now(), since + this.span - 1)
      if (until < since) return []
      const events = await this.ask({ kinds: [ACTION_KIND], since, until, limit: WINDOW_LIMIT })
      if (events.length >= WINDOW_LIMIT && this.span > MIN_WINDOW_S) {
        // Full: the relay may have left some out. Ask for half the time.
        this.span = Math.max(MIN_WINDOW_S, Math.floor(this.span / 2))
        continue
      }
      this.readTo = until + 1
      if (events.length < WINDOW_LIMIT / 8) this.span = Math.min(MAX_WINDOW_S, this.span * 2)
      const beats: Beat[] = []
      for (const ev of events) {
        if (this.seen.has(ev.id)) continue
        this.seen.add(ev.id)
        const b = beatOf(ev)
        if (b) beats.push(b)
      }
      return beats.sort(bySigning)
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
    const events = (await ask({ kinds: [ACTION_KIND], since: t, until: t + START_LOOK_S, limit: 200 }))
      .filter((e) => beatOf(e) !== null)
    if (events.length === 0) continue
    return events[Math.floor(rand() * events.length)].created_at
  }
  return null
}
