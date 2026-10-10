/**
 * useMyAgents.ts: the agents whose profile names you as operator.
 *
 * One query, { kinds: [0], "#p": [me] }, to the general relays and every
 * configured one (where useProfiles looks for kind 0 too), kept to the
 * events that are bots naming me (lib/agentInvite.ts agentsOf; ruling 9 of
 * 2026-10-09 made MY AGENTS one #p query). Each kind 0 that qualifies goes
 * into the profile cache, so the rows show the agents' names without a
 * second fetch.
 *
 * The answer is shared (arkinox, 2026-10-10): the Hud reads it to decide
 * whether the AGENTS panel is shown at all, and the panel reads it for its
 * rows, so both ask once between them. Asked again when the pubkey changes
 * and on refresh(): the list is small and an agent's profile is published
 * once, so there is nothing to keep live.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { agentsOf } from '../lib/agentInvite'
import { GENERAL_RELAYS } from '../lib/contacts'
import type { NostrEvent } from '../lib/events'
import { askEach, relaySet } from '../lib/relay'
import { useProfiles } from '../store/useProfiles'

/** Profiles live on the general relays; a short wait there is enough (useProfiles PROFILE_WAIT_MS). */
const WAIT_MS = 4000
const HEX = /^[0-9a-f]{64}$/

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

function ask(me: string): void {
  const mine = ++asking
  if (!HEX.test(me)) { useAnswer.setState({ me, agents: [], status: 'ready' }); return }
  const prior = useAnswer.getState()
  // A refresh keeps the rows it has while it asks; a new pubkey starts empty.
  useAnswer.setState({ me, agents: prior.me === me ? prior.agents : [], status: 'loading' })
  const heard: NostrEvent[] = []
  const relays = [...new Set([...GENERAL_RELAYS, ...relaySet()])]
  askEach(relays, { kinds: [0], '#p': [me] }, (ev) => { heard.push(ev) }, { maxWait: WAIT_MS, skipDead: true })
    .then((answers) => {
      if (mine !== asking) return
      const profiles = useProfiles.getState()
      // A cached profile newer than what the query returned means a later
      // kind 0 dropped the tag, so that pubkey is no longer my agent.
      const list = agentsOf(heard, me, (pk) => profiles.get(pk)?.at)
      for (const ev of heard) if (list.includes(ev.pubkey)) profiles.remember(ev)
      // Only an answer says "none": with every relay unreachable the list is unknown, not empty.
      useAnswer.setState({ me, agents: list, status: answers.some((a) => a.outcome === 'answered') ? 'ready' : 'error' })
    }, () => { if (mine === asking) useAnswer.setState({ me, agents: [], status: 'error' }) })
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
