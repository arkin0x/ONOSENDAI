/**
 * useAgentConversation.ts: one agent's private conversation, for the TALK
 * modal (arkinox, 2026-10-10, operator and agent DMs).
 *
 * Opens the conversation in the store while mounted (both DM inboxes looked
 * up, your inbox read) and closes it on unmount; everything else is a read
 * of store/useAgentDms.ts.
 */

import { useEffect } from 'react'
import type { DmMessage } from '../lib/dm'
import {
  cannotSend, openConversation, sendToAgent, strategyWith, useAgentDms,
  type InboxState, type ReadingStatus,
} from '../store/useAgentDms'

export interface AgentConversation {
  /** Oldest first. */
  messages: DmMessage[]
  /** The STRATEGY in force: the newest one you sent, or null. */
  strategy: DmMessage | null
  me: string
  myInbox: InboxState
  agentInbox: InboxState
  /** Why nothing can be sent right now, in words; null when it can. */
  blocked: string | null
  reading: ReadingStatus
  readError: string | null
  sending: boolean
  sendError: string | null
  /** Send a message, or a STRATEGY; resolves true once the agent's copy was accepted. */
  send: (text: string, strategy?: boolean) => Promise<boolean>
}

const NONE: DmMessage[] = []
const LOADING: InboxState = { status: 'loading', relays: [] }

export function useAgentConversation(agent: string): AgentConversation {
  const me = useAgentDms((s) => s.me)
  const messages = useAgentDms((s) => s.messages[agent] ?? NONE)
  const myInbox = useAgentDms((s) => s.myInbox)
  const agentInbox = useAgentDms((s) => s.inboxes[agent] ?? LOADING)
  const reading = useAgentDms((s) => s.reading)
  const readError = useAgentDms((s) => s.readError)
  const sending = useAgentDms((s) => s.sending[agent] ?? false)
  const sendError = useAgentDms((s) => s.sendError[agent] ?? null)
  useEffect(() => openConversation(agent), [agent])
  return {
    messages,
    strategy: strategyWith({ me, messages: { [agent]: messages } }, agent),
    me,
    myInbox,
    agentInbox,
    blocked: cannotSend({ myInbox, inboxes: { [agent]: agentInbox } }, agent),
    reading,
    readError,
    sending,
    sendError,
    send: (text, strategy = false) => sendToAgent(agent, text, strategy),
  }
}
