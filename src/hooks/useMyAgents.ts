/**
 * useMyAgents.ts: the agents whose profile names you as operator.
 *
 * One query, { kinds: [0], "#p": [me] }, to the general relays and every
 * configured one (where useProfiles looks for kind 0 too), kept to the
 * events that are bots naming me (lib/agentInvite.ts agentsOf; ruling 9 of
 * 2026-10-09 made MY AGENTS one #p query). Each kind 0 that qualifies goes
 * into the profile cache, so the rows show the agents' names without a
 * second fetch. Asked again on every mount and on refresh(): the list is
 * small and an agent's profile is published once, so there is nothing to
 * keep live.
 */

import { useCallback, useEffect, useState } from 'react'
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

export function useMyAgents(me: string): MyAgents {
  const [agents, setAgents] = useState<string[]>([])
  const [status, setStatus] = useState<MyAgents['status']>('loading')
  const [asked, setAsked] = useState(0)
  const refresh = useCallback(() => setAsked((n) => n + 1), [])

  useEffect(() => {
    let stale = false
    if (!HEX.test(me)) { setAgents([]); setStatus('ready'); return }
    const heard: NostrEvent[] = []
    setStatus('loading')
    const relays = [...new Set([...GENERAL_RELAYS, ...relaySet()])]
    askEach(relays, { kinds: [0], '#p': [me] }, (ev) => { heard.push(ev) }, { maxWait: WAIT_MS, skipDead: true })
      .then((answers) => {
        if (stale) return
        const profiles = useProfiles.getState()
        // A cached profile newer than what the query returned means a later
        // kind 0 dropped the tag, so that pubkey is no longer my agent.
        const list = agentsOf(heard, me, (pk) => profiles.get(pk)?.at)
        for (const ev of heard) if (list.includes(ev.pubkey)) profiles.remember(ev)
        setAgents(list)
        // Only an answer says "none": with every relay unreachable the list is unknown, not empty.
        setStatus(answers.some((a) => a.outcome === 'answered') ? 'ready' : 'error')
      }, () => { if (!stale) setStatus('error') })
    return () => { stale = true }
  }, [me, asked])

  return { agents, status, refresh }
}
