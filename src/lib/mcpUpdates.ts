/**
 * mcpUpdates.ts: whether your agent runs an old cyberspace-mcp (arkinox,
 * 2026-11-23: "on onosendai, in the agent panel, if you have an agent
 * connected then it could say 'YOU MUST UPDATE cyberspace-mcp TO VERSION X'
 * and have a 'I've updated' button to dismiss it").
 *
 * Two things are read, and both are read as strictly as cyberspace-mcp reads
 * them itself (cyberspace-mcp src/updates.ts, docs/releasing.md "Update
 * notices"):
 *
 * - The releases. The cyberspace-mcp RELEASE KEY publishes each release as a
 *   NIP-82 kind 30063 (d "cyberspace-mcp@X.Y.Z", channel main, an `a` naming
 *   its kind 32267 app listing) to wss://relay.onosendai.tech, with two tags
 *   of ours: ["security", "true"] and ["min_allowed_version", "X.Y.Z"]. A
 *   release counts only when its signature verifies, its author is
 *   RELEASE_PUBKEY (compiled in; the tests alone pass another), and its shape
 *   is exactly right; anything malformed ignores the whole event. The latest
 *   is the highest version, never the newest event, so a backport published
 *   after a newer release does not win. The minimum safe version is the
 *   highest min_allowed_version ever seen, and the panel keeps it per identity
 *   (agentUpdateDb.ts), so a relay that hides a release cannot lower it.
 * - The agent's version. cyberspace-mcp writes on its events
 *   ["client", "cyberspace-mcp", "", "", "<version>"] (NIP-89's handler
 *   address and relay hint left empty, the version fifth). The agent's newest
 *   signed event that carries that client tag says what it runs now. A copy
 *   that writes no version is unknown, and unknown is never nagged about.
 *
 * Nothing here talks to a relay or IndexedDB; store/useAgentUpdates.ts does.
 */

import { verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from './events'

/** The cyberspace-mcp release key (npub1ttlpyy4r6lrsvgtxmny8wny2pakp8xwpurvuc3a6pae2jnv8wpestxy4ks), the only author of releases. */
export const RELEASE_PUBKEY = '5afe1212a3d7c7062166dcc8774c8a0f6c1399c1e0d9cc47ba0f72a94d877073'
/** Where the release key publishes its releases. */
export const NOTICE_RELAY = 'wss://relay.onosendai.tech'
/** NIP-82 kinds and the app id, as cyberspace-mcp names them. */
export const RELEASE_KIND = 30063
export const APP_KIND = 32267
export const APP_ID = 'cyberspace-mcp'
export const CHANNEL = 'main'
/** The client name cyberspace-mcp writes in its client tag (NIP-89). */
export const MCP_CLIENT = 'cyberspace-mcp'
/** How far ahead of this clock an event may be dated and still be read, in seconds. */
export const MAX_FUTURE_S = 600
const MAX_CONTENT = 65_536

/** The question for the release key's releases of cyberspace-mcp. */
export function releaseFilter(releasePubkey: string = RELEASE_PUBKEY): { kinds: number[]; authors: string[]; '#i': string[]; limit: number } {
  return { kinds: [RELEASE_KIND], authors: [releasePubkey], '#i': [APP_ID], limit: 100 }
}

/** The app listing's address, which every release names in its `a` tag. */
export function appAddress(releasePubkey: string = RELEASE_PUBKEY): string {
  return `${APP_KIND}:${releasePubkey}:${APP_ID}`
}

// ---- versions ---------------------------------------------------------------

/** X.Y.Z, each part a whole number of at most six digits, no leading zeros, nothing after. */
const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/
export type Semver = [number, number, number]

/** The version as three numbers, or null when it is not strict X.Y.Z. */
export function parseSemver(s: unknown): Semver | null {
  if (typeof s !== 'string') return null
  const m = SEMVER.exec(s)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Negative when a is older than b, zero when equal, positive when newer. */
export function compareSemver(a: Semver, b: Semver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/** A running version: X.Y.Z, or X.Y.Z-<pre-release>, which is below X.Y.Z. Null when it is neither. */
export function parseRunning(s: unknown): { v: Semver; pre: boolean } | null {
  if (typeof s !== 'string' || s.length > 64) return null
  const m = /^([^-+]+)(-[0-9A-Za-z.-]+)?$/.exec(s)
  const v = m ? parseSemver(m[1]) : null
  return v ? { v, pre: !!m![2] } : null
}

/** Whether a running version is below a release version (a pre-release of X.Y.Z is below X.Y.Z). */
export function runningBelow(running: string, version: string | null): boolean {
  if (version === null) return false
  const r = parseRunning(running)
  const v = parseSemver(version)
  if (!r || !v) return false
  const c = compareSemver(r.v, v)
  return c < 0 || (c === 0 && r.pre)
}

// ---- the release (NIP-82 kind 30063) ---------------------------------------

/** One trusted release. */
export interface Release {
  id: string
  created_at: number
  version: string
  /** Its min_allowed_version, or null. */
  minSafe: string | null
  security: boolean
}

const HEX64 = /^[0-9a-f]{64}$/
const HEX40 = /^[0-9a-f]{40}$/
const HEX128 = /^[0-9a-f]{128}$/
/** Single-valued tags; each may appear once, with exactly one value. */
const ONCE = new Set(['d', 'i', 'version', 'c', 'min_allowed_version', 'security', 'commit'])

/**
 * The release an event carries, or null when it is not one to trust: the
 * same checks as cyberspace-mcp's parseNotice. The trusted author, a valid
 * signature over a freshly built event, kind 30063, i "cyberspace-mcp", a
 * strict X.Y.Z version, d "cyberspace-mcp@<version>", channel main, exactly
 * one `a` naming the release key's own app listing, at least one `f` and one
 * well formed `e`, min_allowed_version no higher than the version, security
 * "true" or "false", commit 40 hex, no single-valued tag twice, and not
 * dated more than ten minutes ahead.
 */
export function parseRelease(raw: unknown, trustedPubkey: string, nowS: number): Release | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string' || !HEX64.test(e.id)) return null
  if (typeof e.pubkey !== 'string' || e.pubkey !== trustedPubkey) return null
  if (typeof e.sig !== 'string' || !HEX128.test(e.sig)) return null
  if (e.kind !== RELEASE_KIND) return null
  if (typeof e.created_at !== 'number' || !Number.isSafeInteger(e.created_at) || e.created_at <= 0) return null
  if (e.created_at > nowS + MAX_FUTURE_S) return null
  if (typeof e.content !== 'string' || e.content.length > MAX_CONTENT) return null
  if (!Array.isArray(e.tags) || e.tags.length > 256) return null
  const tags: string[][] = []
  for (const t of e.tags) {
    if (!Array.isArray(t) || t.length === 0 || t.length > 8 || !t.every((x) => typeof x === 'string' && x.length <= 1024)) return null
    tags.push(t as string[])
  }
  let valid = false
  try { valid = verifyEvent({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags, content: e.content, sig: e.sig }) } catch { valid = false }
  if (!valid) return null

  const one: Record<string, string> = {}
  const apps: string[] = []
  let assets = 0
  let fTags = 0
  for (const t of tags) {
    if (ONCE.has(t[0])) {
      if (t[0] in one || t.length !== 2) return null
      one[t[0]] = t[1]
    } else if (t[0] === 'a') {
      if ((t[1] ?? '').startsWith(`${APP_KIND}:`)) apps.push(t[1])
    } else if (t[0] === 'e') {
      if (!HEX64.test(t[1] ?? '')) return null
      assets++
    } else if (t[0] === 'f') {
      if (!/^[a-z0-9_-]{1,64}$/.test(t[1] ?? '')) return null
      fTags++
    }
  }
  if (one.i !== APP_ID) return null
  const version = parseSemver(one.version)
  if (!version) return null
  if (one.d !== `${APP_ID}@${one.version}`) return null
  if (one.c !== CHANNEL) return null
  if (apps.length !== 1 || apps[0] !== appAddress(trustedPubkey)) return null
  if (assets === 0 || fTags === 0) return null
  let minSafe: string | null = null
  if ('min_allowed_version' in one) {
    const m = parseSemver(one.min_allowed_version)
    if (!m || compareSemver(m, version) > 0) return null
    minSafe = one.min_allowed_version
  }
  if ('security' in one && one.security !== 'true' && one.security !== 'false') return null
  if ('commit' in one && !HEX40.test(one.commit)) return null
  return { id: e.id, created_at: e.created_at, version: one.version, minSafe, security: one.security === 'true' }
}

/** What the trusted releases add up to. */
export interface Seen {
  /** The latest release: the highest version. */
  latest: Release | null
  /** The highest min_allowed_version any trusted release carried: only ever raised. */
  minSafe: string | null
  /** The highest version of a release marked security: only ever raised. */
  security: string | null
}

export const NOTHING_SEEN: Seen = { latest: null, minSafe: null, security: null }

/** The higher of two versions; null counts as none. */
export function higherVersion(a: string | null, b: string | null): string | null {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa) return pb ? b : null
  if (!pb) return a
  return compareSemver(pa, pb) >= 0 ? a : b
}

/** Whether release a stands above b as the latest: the higher version; for the same version, the later event, then the lower id. */
function replaces(a: Release, b: Release | null): boolean {
  if (!b) return true
  const v = compareSemver(parseSemver(a.version)!, parseSemver(b.version)!)
  if (v !== 0) return v > 0
  if (a.created_at !== b.created_at) return a.created_at > b.created_at
  return a.id < b.id
}

/** Every trusted release among these events folded into what was seen. Never lowers the minimum or the security mark. */
export function foldReleases(seen: Seen, events: unknown[], trustedPubkey: string, nowS: number): Seen {
  let out = seen
  for (const ev of events) {
    const r = parseRelease(ev, trustedPubkey, nowS)
    if (!r) continue
    out = {
      latest: replaces(r, out.latest) ? r : out.latest,
      minSafe: higherVersion(out.minSafe, r.minSafe),
      security: r.security ? higherVersion(out.security, r.version) : out.security,
    }
  }
  return out
}

// ---- the agent's version ----------------------------------------------------

/** What the agent's newest cyberspace-mcp event says it runs: the version (null when it writes none) and when it said it. */
export interface AgentVersion { version: string | null; at: number }

/** The version in a cyberspace-mcp client tag (its fifth element), or null: another client, no version, or not a version. */
export function clientVersion(ev: Pick<NostrEvent, 'tags'>): string | null | undefined {
  const t = ev.tags.find((x) => x[0] === 'client')
  if (!t || t[1] !== MCP_CLIENT) return undefined
  return parseRunning(t[4]) ? t[4] : null
}

/**
 * The kinds an agent's version is read from: the ones cyberspace-mcp writes
 * fresh each time and publishes itself (profile, deletion, comment, movement,
 * relay list, avatar, bag, public object). Never an item kind: a moved item
 * keeps every tag of the version it replaces, the client tag included
 * (editedTemplate, as ONOSENDAI's), so a copy of one that reached a relay
 * would speak for the copy that first signed it. Nor kind 1, where an old
 * signed message item looks like a travel log entry.
 */
export const VERSION_KINDS: ReadonlySet<number> = new Set([0, 5, 1111, 3333, 10002, 11333, 33330, 33331])

/**
 * The agent's newest event signed by cyberspace-mcp (by created_at, then
 * id), of a kind in VERSION_KINDS, and the version it writes. Only the
 * agent's own events with a valid signature count, and none dated more than
 * ten minutes ahead (one such event would otherwise speak for the agent
 * forever). Null when it has none.
 */
export function agentVersionOf(events: NostrEvent[], agent: string, nowS: number): AgentVersion | null {
  let best: NostrEvent | null = null
  let bestVersion: string | null = null
  for (const ev of events) {
    if (ev.pubkey !== agent || !VERSION_KINDS.has(ev.kind) || !Number.isSafeInteger(ev.created_at) || ev.created_at > nowS + MAX_FUTURE_S || !Array.isArray(ev.tags)) continue
    const v = clientVersion(ev)
    if (v === undefined) continue
    if (best && (ev.created_at < best.created_at || (ev.created_at === best.created_at && ev.id >= best.id))) continue
    let valid = false
    try { valid = verifyEvent({ id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig: ev.sig }) } catch { valid = false }
    if (!valid) continue
    best = ev
    bestVersion = v
  }
  return best ? { version: bestVersion, at: best.created_at } : null
}

// ---- the notice -------------------------------------------------------------

/** "I'VE UPDATED", as kept: which agent, the latest version it was told about, how loud, what it ran, and when (unix seconds). */
export interface Dismissal {
  agent: string
  target: string
  level: NoticeLevel
  from: string
  at: number
}

export type NoticeLevel = 'must' | 'available'

/** What the panel shows for one agent; null for nothing. */
export interface AgentNotice {
  level: NoticeLevel
  /** The latest version: what to update to. */
  latest: string
  /** What the agent runs. */
  running: string
  /** A newer release than the agent's fixes a security problem. */
  security: boolean
  /** Set when an earlier "I'VE UPDATED" was followed by an event that still runs this version. */
  stillOn: string | null
}

/**
 * The notice for one agent. Nothing when no trusted release or kept minimum is known, the
 * version is unknown, or the agent is current. Below the minimum safe
 * version: must. Older than the latest but safe: available. A dismissal of
 * this latest version, at this loudness or louder, hides it until the agent
 * publishes a newer event that still runs an old version; then it is back, with
 * the version it is still on.
 */
export function noticeFor(seen: Seen, agent: AgentVersion | null, dismissal: Dismissal | null): AgentNotice | null {
  // Never a version below the minimum: with no release heard this time, or
  // only older ones, the kept minimum is what to update to.
  const latest = higherVersion(seen.latest?.version ?? null, seen.minSafe)
  if (latest === null || !agent || agent.version === null) return null
  const running = agent.version
  const must = runningBelow(running, seen.minSafe)
  if (!must && !runningBelow(running, latest)) return null
  const level: NoticeLevel = must ? 'must' : 'available'
  const base = { level, latest, running, security: runningBelow(running, seen.security), stillOn: null }
  const covers = dismissal !== null && dismissal.target === latest && (dismissal.level === 'must' || level === 'available')
  if (!covers) return base
  return agent.at > dismissal.at ? { ...base, stillOn: running } : null
}

/** The update commands, as cyberspace-mcp's README gives them ("Updating"). Never taken from a release. */
export function updateSteps(version: string): Array<{ label: string; command: string | null; words?: string }> {
  return [
    { label: 'From a clone', command: 'git pull && npm ci --omit=dev --ignore-scripts' },
    { label: 'Installed with npm i -g', command: `npm i -g github:arkin0x/cyberspace-mcp#v${version}` },
    { label: 'Started with npx', command: 'npx github:arkin0x/cyberspace-mcp serve' },
    { label: 'From a release bundle', command: null, words: 'download the new bundle and check its signature, as its releasing guide says' },
  ]
}
