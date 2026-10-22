/**
 * dwell.ts: no one holds Cyberspace TV for long (arkinox, 2026-10-22: "if a
 * single npub is onscreen for more than 1 minute, we should move on to
 * something else. I had an npub on screen for like 8 minutes and it was just
 * moving one by one by one gibson").
 *
 * The director cuts a long trip into shots of MAX_SHOT_S, but when nobody
 * else was out at the time, those shots of the one avatar play back to back.
 * So TV counts how long the same pubkey has been on screen without a break:
 * its trips and its segments, one after another. Past the limit it moves on
 * to the next shot of anyone else the tape has, cutting the shot on screen
 * short, and that pubkey rests: its shots are passed over until the rest is
 * up. With no one else to show (the tape caught up, or nobody else for a
 * long way ahead), it plays on: a lone avatar is better than a still picture.
 *
 * The limits are in one place (dwellLimits), the same on the site and on the
 * stream for now; screen time, not tape time, since TV skips dead air.
 */

import type { Shot } from './director'

/** How long one pubkey may hold the screen without a break, seconds. */
export const DWELL_MAX_S = 60
/** How long it then rests, seconds of screen time: its shots are passed over meanwhile. */
export const DWELL_REST_S = 10 * 60
/** Shots of resting pubkeys held while the tape is read ahead for someone else; past this many, the resting play on. */
export const DWELL_HELD_MAX = 200

/** The limits, for the site's TV or the stream (lib/tv/broadcast): the one place to make them differ. */
export function dwellLimits(_broadcast: boolean): { maxMs: number; restMs: number } {
  return { maxMs: DWELL_MAX_S * 1000, restMs: DWELL_REST_S * 1000 }
}

/** Whether a shot takes screen time: an arrival or a reaction is a line on the ticker. */
export function onAir(shot: Shot): boolean {
  return shot.kind !== 'arrival' && shot.kind !== 'reaction'
}

/** What to do next: play the shot at `index` (the ones before it are passed), wait for more of the tape, or nothing is left. */
export type DwellPick = { play: number } | { wait: true } | { none: true }

export class Dwell {
  private subject: string | null = null
  private since = 0
  private rests = new Map<string, number>()

  constructor(private limits: { maxMs: number; restMs: number } = dwellLimits(false)) {}

  /**
   * A shot comes on screen, `pubkey`'s; null for a break (a commercial, a new
   * tape), which ends anyone's run. One that had its time rests from now, when
   * TV moves away from it: playing on alone, with no one else to show, used
   * none of its rest.
   */
  onScreen(pubkey: string | null, now: number): void {
    if (this.subject !== null && pubkey !== this.subject && now - this.since >= this.limits.maxMs) this.rests.set(this.subject, now + this.limits.restMs)
    if (pubkey !== this.subject || pubkey === null) this.since = now
    this.subject = pubkey
  }

  /** Whose run it is, and since when (ms), for tests. */
  get run(): { pubkey: string | null; since: number } {
    return { pubkey: this.subject, since: this.since }
  }

  /** Whether `pubkey` is resting at `now`. */
  resting(pubkey: string, now: number): boolean {
    const until = this.rests.get(pubkey)
    if (until === undefined) return false
    if (now < until) return true
    this.rests.delete(pubkey)
    return false
  }

  /**
   * Whether the pubkey on screen has had its time: it starts resting then
   * (again, if it played on with no one else to show). True from then on,
   * until someone else comes on.
   */
  over(now: number): boolean {
    if (this.subject === null || now - this.since < this.limits.maxMs) return false
    if (!this.resting(this.subject, now)) this.rests.set(this.subject, now + this.limits.restMs)
    return true
  }

  /**
   * How many of `queue` can play now, for how far ahead to read: all but the
   * resting's shots. None while every shot with screen time is a resting
   * one's, however many ticker lines wait with them: TV is waiting on the
   * tape for someone else then, and must read on (review of #447: six
   * arrivals held the read-ahead off, and the picture with it, until the
   * rest ran out). With DWELL_HELD_MAX of theirs held, as good as full: the
   * resting play on rather than the tape being read on and on.
   */
  playable(queue: Shot[], now: number): number {
    let n = 0
    let held = 0
    let free = 0
    for (const s of queue) {
      if (!onAir(s)) n++
      else if (this.resting(s.pubkey, now)) held++
      else { n++; free++ }
    }
    if (held >= DWELL_HELD_MAX) return Infinity
    return held > 0 && free === 0 ? 0 : n
  }

  /** `pubkey` rests no more: a shot cued on purpose (useTv cueItem, cueBeats) plays whoever it is. */
  free(pubkey: string): void {
    this.rests.delete(pubkey)
  }

  /** Whether `queue` has a shot that can go on now, someone's not resting. */
  someoneElse(queue: Shot[], now: number): boolean {
    return queue.some((s) => onAir(s) && !this.resting(s.pubkey, now))
  }

  /**
   * The next shot to put on: the first in `queue` with screen time whose
   * pubkey is not resting. When all of them are resting: wait while `more`
   * of the tape can be read and fewer than DWELL_HELD_MAX are held, else
   * play the first anyway.
   */
  pick(queue: Shot[], now: number, more: boolean): DwellPick {
    let first = -1
    let held = 0
    for (let i = 0; i < queue.length; i++) {
      const s = queue[i]
      if (!onAir(s)) continue
      if (!this.resting(s.pubkey, now)) return { play: i }
      if (first < 0) first = i
      held++
    }
    if (first < 0) return { none: true }
    return more && held < DWELL_HELD_MAX ? { wait: true } : { play: first }
  }
}
