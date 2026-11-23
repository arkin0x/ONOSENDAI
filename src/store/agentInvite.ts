/**
 * agentInvite.ts: how many times COPY under Invite an agent (hud/AgentsPanel.tsx)
 * was pressed on this page. The tour's AI step waits for one press
 * (tutorial/director.ts 'agent-copy'; owner, 2026-11-23: "give you the Finish
 * button once you've pressed the copy button for the agent invite"). Its own
 * module, so the tour does not load the panel to read it.
 */

import { create } from 'zustand'

export const useAgentInviteCopies = create<{ presses: number }>(() => ({ presses: 0 }))
