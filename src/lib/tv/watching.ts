/**
 * watching.ts: how many are watching Cyberspace TV now (arkinox, 2026-10-19:
 * "Can we add a little "X watching" to the right of Cyberspace TV in the
 * bottom left?"; the count by an anonymous ping, his pick).
 *
 * Each set that is on, in a tab in front, sends a ping every PING_EVERY_MS:
 * an ephemeral event (kind 23334), so relays pass it to whoever is listening
 * and keep nothing. It is signed by a key made for that tab and kept only in
 * memory, never the viewer's own, so a ping says that someone is watching,
 * never who. Every set counts the keys it has heard from within SEEN_FOR_MS,
 * itself always among them: alone, it says 1 WATCHING.
 *
 * Nothing here talks to a relay; store/useTvWatching does.
 */
import type { EventTemplate, NostrEvent } from 'nostr-tools'

/** The ping's kind: ephemeral (20000 to 29999), beside chat's 23330 (kinds.md). */
export const WATCHING_KIND = 23334
/** How often a set that is on says so, ms. */
export const PING_EVERY_MS = 30_000
/** How long a ping counts, ms: three pings' worth, so one lost on the way does not drop a viewer. */
export const SEEN_FOR_MS = 90_000
/** A ping dated further than this from now, s, is not counted: a replay, or a clock far off. */
export const SKEW_S = 120
/** Keys remembered at most: a flood of made-up keys cannot grow it without end. */
export const MAX_HEARD = 10_000

/** The ping: no content, no tags but what says what it is. */
export function pingTemplate(nowS: number): EventTemplate {
  return { kind: WATCHING_KIND, created_at: nowS, tags: [['t', 'cyberspace-tv']], content: '' }
}

/** Who has been heard, and when: the count of those heard lately. */
export class Watchers {
  private heard = new Map<string, number>()

  /** A ping arrived at `nowMs`; whether it counts. The relay pool has checked its signature. */
  hear(ev: Pick<NostrEvent, 'kind' | 'pubkey' | 'created_at'>, nowMs: number): boolean {
    if (ev.kind !== WATCHING_KIND) return false
    if (Math.abs(ev.created_at - nowMs / 1000) > SKEW_S) return false
    this.heard.delete(ev.pubkey)
    this.heard.set(ev.pubkey, nowMs)
    // The oldest first in a Map's order: drop from the front past the cap.
    while (this.heard.size > MAX_HEARD) this.heard.delete(this.heard.keys().next().value!)
    return true
  }

  /** How many are watching at `nowMs`: those heard within SEEN_FOR_MS, and `self`. */
  count(nowMs: number, self: string | null): number {
    for (const [pk, at] of this.heard) {
      if (nowMs - at <= SEEN_FOR_MS) break
      this.heard.delete(pk)
    }
    const others = this.heard.size - (self !== null && this.heard.has(self) ? 1 : 0)
    return others + (self !== null ? 1 : 0)
  }

  clear(): void {
    this.heard.clear()
  }
}

/** The words beside the bug. */
export function watchingWords(n: number): string {
  return `${n.toLocaleString('en-US')} WATCHING`
}
