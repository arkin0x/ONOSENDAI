/**
 * useAgentDmWatch.ts: the app-wide watch for new messages from your agents,
 * and the unread they leave (arkinox, 2026-10-11: "I need a red dot
 * notification in the ui when XOR has sent a new message to me", then "or
 * just use the existing notification toast").
 *
 * The watch runs from App, not from the AGENTS panel, because on a phone the
 * menu starts closed and the message must still be noticed. It runs only
 * while you have at least one agent; the store (useAgentDms.ts) keeps it to
 * one subscription per DM relay, opened once and reopened at most once per
 * resume.
 */

import { useEffect } from 'react'
import { useMyAgents } from './useMyAgents'
import { followIdentity, useAgentDms, watchAgentDms, type Unread } from '../store/useAgentDms'
import { useCyberspace } from '../store/useCyberspace'

/** Keeps the watch open while this identity has an agent. Call once, from App. */
export function useAgentDmWatch(): void {
  const me = useCyberspace((s) => s.identity.pubkey)
  // The shared answer the Hud reads too: asked once between them.
  const hasAgents = useMyAgents(me).agents.length > 0
  useEffect(() => { followIdentity(me) }, [me])
  useEffect(() => (hasAgents ? watchAgentDms(me) : undefined), [me, hasAgents])
}

export interface AgentUnread {
  /** Unread messages, by agent, for my current agents only. */
  byAgent: Record<string, number>
  /** All of them together. */
  total: number
  /** The agent with the newest unread message, or null. */
  latest: string | null
}

const NONE: Record<string, Unread> = {}

/** Pure, so a test can check it: the unread kept, narrowed to the agents I have now. */
export function unreadOf(unread: Record<string, Unread>, agents: readonly string[]): AgentUnread {
  const byAgent: Record<string, number> = {}
  let total = 0
  let latest: string | null = null
  let latestAt = -1
  for (const agent of agents) {
    const u = unread[agent]
    if (!u || u.ids.length === 0) continue
    byAgent[agent] = u.ids.length
    total += u.ids.length
    if (u.at > latestAt) { latestAt = u.at; latest = agent }
  }
  return { byAgent, total, latest }
}

/** The unread messages from my agents, for the dots and the toast. */
export function useAgentUnread(): AgentUnread {
  const me = useCyberspace((s) => s.identity.pubkey)
  const { agents } = useMyAgents(me)
  // Another identity's unread never shows: the store may not have followed yet.
  const unread = useAgentDms((s) => (s.me === me ? s.unread : NONE))
  return unreadOf(unread, agents)
}
