/**
 * useAgentUpdates.ts: the AGENTS panel's update notices (arkinox,
 * 2026-11-23): for each of your agents, whether it runs a cyberspace-mcp
 * older than the newest release the release key signed (lib/mcpUpdates.ts).
 *
 * One check asks two things at once, each relay on its own (askEach):
 *
 * - the release key's releases, on wss://relay.onosendai.tech and the
 *   cyberspace relays, folded with the minimum safe version this identity
 *   kept before (agentUpdateDb.ts), which is only ever raised;
 * - each agent's ten newest events, where your agents publish (the cyberspace
 *   relays and the general ones), for the version in its client tag.
 *
 * "I'VE UPDATED" keeps a dismissal per identity, by agent and version, in
 * IndexedDB (in memory for the session if IndexedDB is not there). It hides
 * the notice until a newer event from the agent still runs an old
 * version; then the notice is back, saying the version it is still on.
 *
 * The panel draws MY AGENTS once the first check for this identity is done,
 * so a notice never pushes the rows down after they are on screen. The last
 * check's answer is kept on the device per identity (lib/deviceCache,
 * IndexedDB) and counts as that first check while the relays are asked
 * again, when it covers every agent on the list: the rows of a known agent,
 * and its notice, are drawn at once on every visit (the owner, 2026-11-24).
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import type { Filter } from 'nostr-tools/filter'
import { GENERAL_RELAYS } from '../lib/contacts'
import type { NostrEvent } from '../lib/events'
import {
  agentVersionOf, foldReleases, higherVersion, noticeFor, NOTHING_SEEN, NOTICE_RELAY, RELEASE_PUBKEY, releaseFilter,
  type AgentNotice, type AgentVersion, type Dismissal, type Seen,
} from '../lib/mcpUpdates'
import { openAgentUpdateDb, putDismissal, putSeenMarks, readDismissals, readSeenMarks } from '../lib/agentUpdateDb'
import { askEach, relaySet } from '../lib/relay'
import { readCached, writeCachedSoon } from '../lib/deviceCache'

/** A short wait: the releases and the agents' newest events are a handful of events. */
const WAIT_MS = 4000
/** How many of an agent's newest events are read for its version. */
const AGENT_EVENTS = 10
const HEX = /^[0-9a-f]{64}$/

interface State {
  me: string
  /** Whether a check for `me` has finished (the panel draws its rows from then on). */
  checked: boolean
  seen: Seen
  /** Each agent's version, null when none of its events was signed by cyberspace-mcp. */
  versions: Record<string, AgentVersion | null>
  dismissed: Record<string, Dismissal>
}

/** The shared answer; exported so a test can stand in for the relays. */
export const useAgentUpdatesState = create<State>(() => ({ me: '', checked: false, seen: NOTHING_SEEN, versions: {}, dismissed: {} }))

/** What a check reads from: the relays and IndexedDB. The tests pass their own, and a throwaway release key. */
export interface CheckDeps {
  releasePubkey: string
  ask: (relays: string[], filter: Filter, onEvent: (ev: NostrEvent) => void) => Promise<unknown>
  openDb: () => Promise<IDBDatabase>
  nowS: () => number
  /** The last check's answer kept on the device for this identity, and keeping the new one. Left out (as by the tests), nothing is kept. */
  readKept?: (me: string) => Promise<unknown>
  keep?: (me: string, kept: KeptCheck) => void
}

/** A check's answer as the device keeps it, per identity: what was seen, under which release key, and each agent's version. */
export interface KeptCheck { releasePubkey: string; seen: Seen; versions: Record<string, AgentVersion | null> }

/** Where the last check for this identity is kept (lib/deviceCache). */
export const agentUpdatesCacheKey = (me: string): string => `agentUpdates:${me}`

/** The kept check, when it is one for this release key and knows every agent of `agents`; else null. */
export function keptCheckFor(value: unknown, releasePubkey: string, agents: string[]): KeptCheck | null {
  const k = value as Partial<KeptCheck> | null | undefined
  if (!k || k.releasePubkey !== releasePubkey || !k.seen || typeof k.versions !== 'object' || k.versions === null) return null
  if (!agents.every((a) => Object.prototype.hasOwnProperty.call(k.versions, a))) return null
  return k as KeptCheck
}

/** The app's: built once, so the one database connection below is opened once. */
const DEFAULT_DEPS: CheckDeps = {
  releasePubkey: RELEASE_PUBKEY,
  ask: (relays, filter, onEvent) => askEach(relays, filter, onEvent, { maxWait: WAIT_MS, skipDead: true }),
  openDb: () => openAgentUpdateDb(),
  nowS: () => Math.floor(Date.now() / 1000),
  readKept: (me) => readCached(agentUpdatesCacheKey(me)),
  keep: (me, kept) => writeCachedSoon(agentUpdatesCacheKey(me), kept),
}

/** One connection per openDb (the app has one); a failed open is null, and the notices live in memory for the session. */
let db: Promise<IDBDatabase | null> | null = null
let dbFor: CheckDeps['openDb'] | null = null
function database(deps: CheckDeps): Promise<IDBDatabase | null> {
  if (!db || dbFor !== deps.openDb) {
    dbFor = deps.openDb
    db = deps.openDb().catch((err: unknown) => {
      console.warn('[agent updates] IndexedDB unavailable; I\'VE UPDATED lasts until reload', err)
      return null
    })
  }
  return db
}

/** Bumped on every check, so an answer that arrives after a newer check is dropped. */
let asking = 0
/**
 * The seen marks a kept check put on screen: only a stand-in, never the base
 * a check folds into, so a latest release is raised only by what this session
 * saw (a withdrawn release does not stay the newest on this device forever).
 */
let primedSeen: Seen | null = null

/** Check the releases and these agents' versions for `me`. Resolves when the state is set. */
export async function checkAgentUpdates(me: string, agents: string[], deps: CheckDeps = DEFAULT_DEPS): Promise<void> {
  const mine = ++asking
  const prior = useAgentUpdatesState.getState()
  if (prior.me !== me) useAgentUpdatesState.setState({ me, checked: false, seen: NOTHING_SEEN, versions: {}, dismissed: {} })
  // The last check kept on the device stands for the first one while the relays are asked.
  if (deps.readKept && HEX.test(me) && !useAgentUpdatesState.getState().checked) {
    // With the I'VE UPDATED dismissals, so a dismissed notice does not come back for a moment.
    const dismissals = database(deps).then((store) => (store ? readDismissals(store, me) : {})).catch(() => ({}))
    void Promise.all([deps.readKept(me), dismissals]).then(([value, dismissed]) => {
      const kept = keptCheckFor(value, deps.releasePubkey, agents)
      const now = useAgentUpdatesState.getState()
      if (!kept || mine !== asking || now.me !== me || now.checked) return
      const versions: Record<string, AgentVersion | null> = {}
      for (const a of agents) versions[a] = kept.versions[a] ?? null
      primedSeen = kept.seen
      useAgentUpdatesState.setState({ checked: true, seen: kept.seen, versions, dismissed: { ...dismissed, ...now.dismissed } })
    }, () => undefined)
  }
  try {
    await check(me, agents, deps, mine)
  } finally {
    // Whatever went wrong, MY AGENTS is never held on LOADING by this check.
    if (mine === asking && !useAgentUpdatesState.getState().checked) useAgentUpdatesState.setState({ me, checked: true })
  }
}

async function check(me: string, agents: string[], deps: CheckDeps, mine: number): Promise<void> {
  if (!HEX.test(me)) return
  const releases: NostrEvent[] = []
  const heard: Record<string, NostrEvent[]> = {}
  const cyberspace = relaySet()
  const agentRelays = [...new Set([...cyberspace, ...GENERAL_RELAYS])]
  // IndexedDB opens while the relays are asked (only the kept check's stand-in, above, may open it first).
  const opening = database(deps)
  const keptMarks = opening.then((store) => (store ? readSeenMarks(store, me, deps.releasePubkey) : null)).catch(() => null)
    .then((m) => m ?? { minSafe: null, security: null })
  const keptDismissals = opening.then((store) => (store ? readDismissals(store, me) : {})).catch(() => ({}))
  await Promise.all([
    deps.ask([NOTICE_RELAY, ...cyberspace], releaseFilter(deps.releasePubkey), (ev) => { releases.push(ev) }).catch(() => undefined),
    ...agents.filter((a) => HEX.test(a)).map((a) => {
      heard[a] = []
      return deps.ask(agentRelays, { authors: [a], limit: AGENT_EVENTS }, (ev) => { heard[a].push(ev) }).catch(() => undefined)
    }),
  ])
  const [marks, dismissed, store] = await Promise.all([keptMarks, keptDismissals, opening])
  if (mine !== asking) return
  const nowS = deps.nowS()
  const now = useAgentUpdatesState.getState()
  // What this identity saw before (this session and stored) is never lowered.
  const base: Seen = now.me === me && now.seen !== primedSeen ? now.seen : NOTHING_SEEN
  const folded = foldReleases(base, releases, deps.releasePubkey, nowS)
  const seen: Seen = {
    latest: folded.latest,
    minSafe: higherVersion(folded.minSafe, marks.minSafe),
    security: higherVersion(folded.security, marks.security),
  }
  if (store && (seen.minSafe !== marks.minSafe || seen.security !== marks.security)) {
    void putSeenMarks(store, me, deps.releasePubkey, { minSafe: seen.minSafe, security: seen.security }).catch(() => undefined)
  }
  const versions: Record<string, AgentVersion | null> = {}
  for (const a of Object.keys(heard)) versions[a] = agentVersionOf(heard[a], a, nowS)
  deps.keep?.(me, { releasePubkey: deps.releasePubkey, seen, versions })
  useAgentUpdatesState.setState({
    me, checked: true, seen, versions,
    // A dismissal made while this check ran stays.
    dismissed: { ...dismissed, ...(now.me === me ? now.dismissed : {}) },
  })
}

/** "I'VE UPDATED" for one agent: hides its notice, kept per identity by agent and version. */
export async function dismissAgentUpdate(me: string, agent: string, deps: CheckDeps = DEFAULT_DEPS): Promise<void> {
  const s = useAgentUpdatesState.getState()
  if (s.me !== me) return
  const version = s.versions[agent] ?? null
  const notice = noticeFor(s.seen, version, s.dismissed[agent] ?? null)
  if (!notice || !version) return
  // Never before the event that showed the old version, so an agent clock
  // ahead of this one cannot bring the notice straight back.
  const d: Dismissal = { agent, target: notice.latest, level: notice.level, from: notice.running, at: Math.max(deps.nowS(), version.at) }
  useAgentUpdatesState.setState({ dismissed: { ...s.dismissed, [agent]: d } })
  const store = await database(deps)
  if (store) await putDismissal(store, me, d).catch(() => undefined)
}

/** The notices for these agents, and whether the first check for `me` is done. Checks again when the agents change. */
export function useAgentUpdates(me: string, agents: string[], agentsReady: boolean): { checked: boolean; notices: Record<string, AgentNotice | null> } {
  const s = useAgentUpdatesState()
  const key = agents.join(',')
  useEffect(() => {
    if (agentsReady) checkAgentUpdates(me, agents).catch((err: unknown) => console.warn('[agent updates] check failed', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the list by value
  }, [me, key, agentsReady])
  const current = s.me === me
  const notices: Record<string, AgentNotice | null> = {}
  for (const a of agents) notices[a] = current ? noticeFor(s.seen, s.versions[a] ?? null, s.dismissed[a] ?? null) : null
  return { checked: current && s.checked, notices }
}
