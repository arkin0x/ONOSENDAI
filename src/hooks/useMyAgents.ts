/**
 * useMyAgents.ts: the agents whose profile names you as operator.
 *
 * One query, { kinds: [0], "#p": [me] }, to the canonical relay, every
 * configured one and the general relays (where useProfiles looks for kind 0
 * too), kept to the events that are bots naming me (lib/agentInvite.ts
 * agentsOf; ruling 9 of 2026-10-09 made MY AGENTS one #p query). Each kind 0
 * that qualifies goes into the profile cache, so the rows show the agents'
 * names without a second fetch.
 *
 * A profile's claim is half of it (arkinox, 2026-10-10): the agent is mine
 * only when I also follow it in my kind 3 list, so my follow list is fetched
 * beside the profiles and only pubkeys on both sides are kept
 * (lib/agentInvite.ts followedAgents).
 *
 * The answer is shared (arkinox, 2026-10-10): the app-wide DM watch reads
 * it to decide whether to watch at all, and the panel reads it for its rows,
 * so both ask once between them. (The Hud read it too, to draw the panel
 * only for someone with an agent, until the panel went public on
 * 2026-10-13.) Asked again when the pubkey changes and on refresh().
 *
 * FAST, FROM THE FIRST FRAME (the owner, 2026-11-24: "lately my agents panel
 * has been empty... and minutes later XOR will show up"). The list used to
 * appear only once every relay had answered both questions, and the follow
 * list was read the way a list read is (lib/relay queryAny), which authenticates
 * first at every relay that gates, with no limit but the signer's own: once
 * the canonical relay had asked this visit for a sign-in (a gift wrap, a DM
 * inbox), each ask waited on the remote signer's AUTH, minutes with a phone
 * signer asleep. Now:
 *
 * - The last list this identity saw is kept on the device, in IndexedDB per
 *   pubkey (arkinox, 2026-11-19: all local data per npub, in IndexedDB), and
 *   drawn at once, before any relay is asked.
 * - Every relay is asked on its own (lib/relay askRelay), its sign-in inside
 *   its own short wait, for the profiles and for the follow list alike, and
 *   the rows are drawn as the answers land: an agent shows the moment its
 *   profile and a follow list naming it are both in, whichever relay sent
 *   them. No slow relay holds the others.
 * - The canonical relay is where agents publish (cyberspace-mcp's default),
 *   so only its answer, with my follow list from a general relay, can take
 *   an agent off the list: a list where either was missing keeps every agent
 *   it had, in the order it had them, and is asked again a little later.
 * - "No agents yet" waits for every relay to answer or give up, so it is
 *   never said while an answer may still bring one.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { agentsOf, followedAgents } from '../lib/agentInvite'
import { GENERAL_RELAYS } from '../lib/contacts'
import { readCached, writeCachedSoon } from '../lib/deviceCache'
import type { NostrEvent } from '../lib/events'
import { askRelay, CYBERSPACE_RELAY, relaySet } from '../lib/relay'
import { useProfiles } from '../store/useProfiles'

/** The general relays answer profile lookups quickly (useProfiles PROFILE_WAIT_MS). */
const WAIT_MS = 4000
/** The canonical relay's socket is busiest at startup, when this is asked: it gets a lookup's full wait. */
const CANONICAL_WAIT_MS = 8000
/** How long after a list the canonical relay did not answer it is asked again, and how many times. */
export const RETRY_MS = 15_000
const RETRIES = 2
const HEX = /^[0-9a-f]{64}$/

/** Where this identity's last list is kept on the device (lib/deviceCache, IndexedDB), by pubkey. */
export const myAgentsCacheKey = (me: string): string => `myAgents:${me}`

export interface MyAgents {
  /** Pubkeys, newest profile first. */
  agents: string[]
  status: 'loading' | 'ready' | 'error'
  /** Ask the relays again. */
  refresh: () => void
}

interface Answer { me: string; agents: string[]; status: MyAgents['status'] }

/** The shared answer; exported so a test can stand in for the relays. */
export const useMyAgentsAnswer = create<Answer>(() => ({ me: '', agents: [], status: 'loading' }))
const useAnswer = useMyAgentsAnswer
/** Bumped on every ask, so an answer that arrives after a newer ask is dropped. */
let asking = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined

/** The kept list, or null: none kept, or not a list of pubkeys. */
function keptAgents(value: unknown): string[] | null {
  const agents = (value as { agents?: unknown } | null | undefined)?.agents
  return Array.isArray(agents) && agents.every((a) => typeof a === 'string' && HEX.test(a)) ? agents as string[] : null
}

/** `first`, then whatever of `rest` it lacks: the confirmed agents in profile order, then the ones not yet heard of again. */
function union(first: string[], rest: string[]): string[] {
  const seen = new Set(first)
  return [...first, ...rest.filter((a) => !seen.has(a))]
}

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

function ask(me: string, retriesLeft = RETRIES): void {
  const mine = ++asking
  clearTimeout(retryTimer)
  if (!HEX.test(me)) { useAnswer.setState({ me, agents: [], status: 'ready' }); return }
  const prior = useAnswer.getState()
  // A refresh keeps the rows it has while it asks; a new pubkey starts empty.
  const had = prior.me === me ? prior.agents : []
  // A retry of its own keeps what it said, "none" included, so the header does not flip to LOADING and back.
  const retrying = retriesLeft < RETRIES && prior.me === me
  useAnswer.setState({ me, agents: had, status: had.length ? 'ready' : retrying ? prior.status : 'loading' })
  /** What this identity is known to have: the rows on screen, then what the device kept. */
  let known = had
  let shown = had

  const heard: NostrEvent[] = []
  /** My newest kind 3: its time and the pubkeys it follows. */
  let follows: { at: number; id: string; list: string[] } | null = null
  /** Whether a general relay (where follow lists live) answered the follow list question. */
  let followsAnswered = false
  let canonicalAnswered = false

  const confirmed = (): string[] => {
    if (!follows) return []
    const profiles = useProfiles.getState()
    // A cached profile newer than what the query returned means a later
    // kind 0 dropped the tag, so that pubkey is no longer my agent.
    return followedAgents(agentsOf(heard, me, (pk) => profiles.get(pk)?.at), follows.list)
  }

  const put = (agents: string[], status: MyAgents['status']): void => {
    const now = useAnswer.getState()
    if (now.me === me && now.status === status && same(now.agents, agents)) return
    shown = agents
    useAnswer.setState({ me, agents, status })
  }

  /** As answers land: the known ones in their order, then every agent confirmed so far; nothing is taken away or moved yet. */
  const update = (): void => {
    if (mine !== asking) return
    const next = union(known, confirmed())
    // An empty list waits for the end: an answer still on its way may bring an agent.
    if (next.length && !same(next, shown)) put(next, 'ready')
  }

  // The device's list first, before any relay can answer.
  void readCached(myAgentsCacheKey(me)).then((value) => {
    if (mine !== asking) return
    const kept = keptAgents(value)
    if (!kept?.length) return
    known = union(known, kept)
    update()
  }, () => undefined)

  const canonical = CYBERSPACE_RELAY
  const profileRelays = [...new Set([canonical, ...relaySet(), ...GENERAL_RELAYS])]
  const followRelays = [...new Set([...GENERAL_RELAYS, ...relaySet()])]

  // The canonical relay is never skipped as recently unreachable: a retry is there to ask it again.
  const profiles = Promise.all(profileRelays.map((url) => askRelay(url, { kinds: [0], '#p': [me] }, (ev) => { heard.push(ev); update() }, url === canonical ? { maxWait: CANONICAL_WAIT_MS } : { maxWait: WAIT_MS, skipDead: true })
    .then((answer) => {
      if (answer.outcome === 'answered' && url === canonical) canonicalAnswered = true
      update()
      return answer
    })))
  const followList = Promise.all(followRelays.map((url) => askRelay(url, { kinds: [3], authors: [me] }, (ev) => {
    if (ev.kind !== 3 || ev.pubkey !== me) return
    if (follows && (follows.at > ev.created_at || (follows.at === ev.created_at && follows.id <= ev.id))) return
    follows = { at: ev.created_at, id: ev.id, list: ev.tags.filter((t) => t[0] === 'p' && HEX.test(t[1] ?? '')).map((t) => t[1]) }
    update()
  }, { maxWait: WAIT_MS, skipDead: true }).then((answer) => {
    if (answer.outcome === 'answered' && GENERAL_RELAYS.includes(url)) followsAnswered = true
    return answer
  })))

  Promise.all([profiles, followList]).then(([answers]) => {
    if (mine !== asking) return
    const list = confirmed()
    const store = useProfiles.getState()
    for (const ev of heard) if (list.includes(ev.pubkey)) store.remember(ev)
    // Only the canonical relay's answer, with my follow list in hand and a
    // general relay heard from, can take an agent off the list: a relay that
    // answered with no follow list of mine is no word that I follow nobody.
    const sure = canonicalAnswered && followsAnswered && follows !== null
    if (sure) {
      put(list, 'ready')
      writeCachedSoon(myAgentsCacheKey(me), { agents: list, at: Date.now() })
      return
    }
    const kept = union(known, list)
    // Only an answer says "none": with every relay unreachable the list is unknown, not empty.
    put(kept, kept.length || answers.some((a) => a.outcome === 'answered') ? 'ready' : 'error')
    if (kept.length) writeCachedSoon(myAgentsCacheKey(me), { agents: kept, at: Date.now() })
    // Asked again only where an answer that matters was missing (not for someone who simply follows nobody).
    if (retriesLeft > 0 && (!canonicalAnswered || !followsAnswered)) retryTimer = setTimeout(() => { if (mine === asking) ask(me, retriesLeft - 1) }, RETRY_MS)
  }, () => {
    if (mine !== asking) return
    put(known, known.length ? 'ready' : 'error')
  })
}

export function useMyAgents(me: string): MyAgents {
  const answer = useAnswer()
  useEffect(() => {
    if (useAnswer.getState().me !== me) ask(me)
  }, [me])
  const current = answer.me === me
  return {
    agents: current ? answer.agents : [],
    status: current ? answer.status : 'loading',
    refresh: () => ask(me),
  }
}
