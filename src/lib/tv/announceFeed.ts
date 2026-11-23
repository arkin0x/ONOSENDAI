/**
 * announceFeed.ts: what carries Cyberspace TV's UPGRADE ANNOUNCEMENT
 * (owner rulings, 2026-11-12; onosendai/tv-upgrade-announcements-2026-11-11.md).
 *
 * One stored event per version: kind ANNOUNCE_KIND (addressable), `d` = the
 * simple version it announces (2.1, 2.2, ...: lib/version simpleVersion),
 * `content` = the words, `["t", ANNOUNCE_TAG]`, `["published_at", <unix s>]`
 * and an `alt`. Only ANNOUNCER_PUBKEY's are believed: the announcer key is a
 * key of its own, held by the coordinator alone (the announce script,
 * onosendai/tv-announce/announce.mjs), and the relay takes the kind from
 * anyone, so a forged one (any other author, a bad signature, a tag edited
 * after signing) is dropped here and never reaches the screen.
 *
 * A set plays a version once (remembered on the device, PLAYED_KEY), and
 * only while it is fresh (published within ANNOUNCE_FRESH_S); every version
 * of the last ANNOUNCE_WEEK_S counts for N UPDATES THIS WEEK, and the highest
 * of them lifts the marquee's ONOSENDAI VERSION when the page runs an older
 * build (the stream does not reload for an update; owner, 2026-11-12).
 *
 * Everything here is pure but the device memory; store/useTvAnnounce listens
 * and plays.
 */

import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from '../events'
import { verifiedFresh } from '../foundCache'
import { SIMPLE_VERSION_RE, compareVersions } from '../version'

/**
 * The announcement's kind: addressable, in Cyberspace's 3333x run, and
 * unused (checked 2026-11-12: no NIP, nothing in kinds.md or the spec decks,
 * and no events on damus, nos.lol, primal, nostr.band, nostr.wine, snort,
 * offchain.pub or relay.onosendai.tech; 33336 and 33337 are taken by other apps).
 */
export const ANNOUNCE_KIND = 33338

/** The announcer's public key (npub1sawgaw2k750pgkpkd2tqderxxtj37h4xvhzlc9vrvzsgjftpvlesmh030p): TV believes no other. */
export const ANNOUNCER_PUBKEY = '875c8eb956f51e1458366a9606e46632e51f5ea665c5fc158360a089256167f3'

/** The `t` every announcement carries. */
export const ANNOUNCE_TAG = 'onosendai-upgrade'

/** How far back the week reaches, seconds: what N UPDATES THIS WEEK counts, and what TV asks the relays for. */
export const ANNOUNCE_WEEK_S = 7 * 24 * 3600
/** How long an announcement plays on a set that has not shown it, seconds after it was published. Older ones count for the week only. */
export const ANNOUNCE_FRESH_S = 24 * 3600
/** How far ahead of this clock an announcement's time may be, seconds: a clock a little slow is not a forgery, much further is dropped. */
export const ANNOUNCE_SKEW_S = 10 * 60

/** Where a set remembers the versions it has played. */
export const PLAYED_KEY = 'onosendai:tvAnnouncePlayed'
/** How long a played version is remembered, seconds: past the week it can no longer play anyway. */
export const PLAYED_KEEP_S = 8 * 24 * 3600

/** An announcement read and believed. */
export interface HeardAnnouncement {
  /** Its `d`: the simple version it announces. */
  version: string
  text: string
  /** When it was published, unix s: its `published_at`, else its created_at. */
  at: number
  /** Its created_at, unix s: of two for one version, the newer is kept. */
  created: number
}

/** What TV asks the relays for: the announcer's announcements of the last week. */
export function announceFilter(nowS: number, announcer: string = ANNOUNCER_PUBKEY): Filter {
  return { kinds: [ANNOUNCE_KIND], authors: [announcer], since: Math.floor(nowS) - ANNOUNCE_WEEK_S }
}

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => Array.isArray(t) && t[0] === name)?.[1]
}

/**
 * An event read as an announcement, or null when it is not one TV believes:
 * not the kind, not the announcer, no `t`, a `d` that is not a simple
 * version, or a signature that does not verify over every field as it
 * arrived (checked last: it is the costly one). One dated ahead of this
 * clock is kept: AnnounceBook counts and plays it once the clock is within
 * ANNOUNCE_SKEW_S of it (a slow clock is not a forgery, and catches up).
 * `announcer` is ANNOUNCER_PUBKEY but in tests, which cannot sign as it.
 */
export function readAnnouncement(ev: NostrEvent, announcer: string = ANNOUNCER_PUBKEY): HeardAnnouncement | null {
  if (!ev || typeof ev !== 'object' || ev.kind !== ANNOUNCE_KIND || ev.pubkey !== announcer) return null
  if (!Array.isArray(ev.tags) || typeof ev.content !== 'string' || !Number.isInteger(ev.created_at)) return null
  const version = tagValue(ev.tags, 'd')
  if (typeof version !== 'string' || !SIMPLE_VERSION_RE.test(version)) return null
  if (!ev.tags.some((t) => Array.isArray(t) && t[0] === 't' && t[1] === ANNOUNCE_TAG)) return null
  const published = Number(tagValue(ev.tags, 'published_at'))
  const at = Number.isInteger(published) && published > 0 && published <= ev.created_at ? published : ev.created_at
  if (!verifiedFresh(ev)) return null
  return { version, text: ev.content, at, created: ev.created_at }
}

/** The announcements heard, one per version (the newest edit of each). */
export class AnnounceBook {
  private byVersion = new Map<string, HeardAnnouncement>()

  /** Keep `a`, unless a newer edit of its version is already kept. True when it changed what is kept. */
  add(a: HeardAnnouncement): boolean {
    const had = this.byVersion.get(a.version)
    if (had && had.created >= a.created) return false
    this.byVersion.set(a.version, a)
    return true
  }

  /** Those published in the week up to `nowS`. */
  week(nowS: number): HeardAnnouncement[] {
    return [...this.byVersion.values()].filter((a) => a.at > nowS - ANNOUNCE_WEEK_S && a.at <= nowS + ANNOUNCE_SKEW_S)
  }

  /** How many versions came in the week: N UPDATES THIS WEEK. */
  count(nowS: number): number {
    return this.week(nowS).length
  }

  /** The highest version of the week, or null for none. */
  newest(nowS: number): string | null {
    let best: string | null = null
    for (const a of this.week(nowS)) if (best === null || compareVersions(a.version, best) > 0) best = a.version
    return best
  }

  /**
   * Those still fresh that this set has not played, lowest version first:
   * what may play now (of those published before TV came on only the newest
   * plays, the rest kept as played: store/useTvAnnounce refresh).
   */
  due(nowS: number, played: (version: string) => boolean): HeardAnnouncement[] {
    return this.week(nowS)
      .filter((a) => a.at > nowS - ANNOUNCE_FRESH_S && !played(a.version))
      .sort((x, y) => compareVersions(x.version, y.version))
  }
}

/**
 * The versions this set has played, kept on the device: the broadcast's
 * page reloads (a lost WebGL context, the owner's Reload TV page), and a
 * reload must not play one again. Also kept in memory, for a browser that
 * keeps nothing.
 */
const playedHere = new Map<string, number>()

function readPlayed(nowS: number): Map<string, number> {
  const out = new Map<string, number>()
  try {
    const kept = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? '{}') as unknown
    if (kept && typeof kept === 'object' && !Array.isArray(kept)) {
      for (const [v, at] of Object.entries(kept as Record<string, unknown>)) {
        if (typeof at === 'number' && at > nowS - PLAYED_KEEP_S) out.set(v, at)
      }
    }
  } catch { /* nothing kept, or no storage: memory only */ }
  for (const [v, at] of playedHere) if (at > nowS - PLAYED_KEEP_S) out.set(v, at)
  return out
}

/** Whether this set has played `version`. */
export function wasPlayed(version: string, nowS: number): boolean {
  return readPlayed(nowS).has(version)
}

/** Remember that this set played `version`; what is past PLAYED_KEEP_S is let go. */
export function rememberPlayed(version: string, nowS: number): void {
  playedHere.set(version, nowS)
  const all = readPlayed(nowS)
  all.set(version, nowS)
  try { localStorage.setItem(PLAYED_KEY, JSON.stringify(Object.fromEntries(all))) } catch { /* memory only */ }
}

/** For tests: forget what was played, here and on the device. */
export function forgetPlayedForTest(): void {
  playedHere.clear()
  try { localStorage.removeItem(PLAYED_KEY) } catch { /* none */ }
}

/**
 * The stream's gentle self-update (owner, 2026-11-12): the broadcast page
 * reloads to run a newer build at most once in SELF_UPDATE_EVERY_S, and only
 * when the announcer has announced a version above the one it runs. When it
 * last did is kept on the device (SELF_UPDATE_KEY), so the cap holds across
 * the reload itself. The quiet moment it waits for is the store's to judge
 * (store/useTvAnnounce maybeSelfUpdate).
 */
export const SELF_UPDATE_EVERY_S = 24 * 3600
export const SELF_UPDATE_KEY = 'onosendai:tvSelfUpdateAt'

/** When this set last reloaded for a new version, unix s; null for never (or no storage). */
export function lastSelfUpdate(): number | null {
  try {
    const t = Number(localStorage.getItem(SELF_UPDATE_KEY))
    return Number.isFinite(t) && t > 0 ? t : null
  } catch { return null }
}

/** Keep when this set reloads for a new version. */
export function rememberSelfUpdate(nowS: number): void {
  try { localStorage.setItem(SELF_UPDATE_KEY, String(Math.floor(nowS))) } catch { /* the cap is for this load only */ }
}

/**
 * Whether a newer build is worth a reload: `newest` announced is above
 * `running` (both simple versions; no reload without both), and the last
 * such reload was SELF_UPDATE_EVERY_S ago or more (or never, or in the future: a clock put back).
 */
export function selfUpdateWanted(running: string | null, newest: string | null, lastAt: number | null, nowS: number): boolean {
  if (!running || !newest || !SIMPLE_VERSION_RE.test(running) || !SIMPLE_VERSION_RE.test(newest)) return false
  if (compareVersions(newest, running) <= 0) return false
  return lastAt === null || lastAt > nowS || nowS - lastAt >= SELF_UPDATE_EVERY_S
}
