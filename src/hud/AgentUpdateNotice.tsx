/**
 * AgentUpdateNotice.tsx: one agent's cyberspace-mcp update notice in MY
 * AGENTS (arkinox, 2026-11-23: "if you have an agent connected then it could
 * say 'YOU MUST UPDATE cyberspace-mcp TO VERSION X' and have a 'I've updated'
 * button to dismiss it").
 *
 * - Below the minimum safe version: a red banner in his words, YOU MUST
 *   UPDATE cyberspace-mcp TO VERSION X (X the latest), and why when the
 *   release fixes a security problem.
 * - Older than the latest but safe: a calm line, UPDATE AVAILABLE.
 * - Unknown: nothing (the panel draws no notice).
 *
 * I'VE UPDATED hides it (store/useAgentUpdates.ts keeps that per identity,
 * by agent and version); it comes back, saying the version the agent is
 * still on, when the agent's newer events still run an old one. HOW TO
 * UPDATE unfolds the commands from cyberspace-mcp's README, never anything a
 * release event said.
 *
 * The look follows red HUD danger frames (hazard-striped edge, glowing
 * border, the warning mark first) drawn by hand in the house chamfer: top
 * left and bottom right cut, white words with a dark shadow.
 */

import { useState } from 'react'
import { ChevronDown, CircleArrowUp, Check, ShieldAlert } from 'lucide-react'
import { updateSteps, type AgentNotice } from '../lib/mcpUpdates'

/** The owner's words for an agent below the minimum safe version. */
export const mustUpdateWords = (version: string): string => `YOU MUST UPDATE cyberspace-mcp TO VERSION ${version}`
/** The calm line for an agent behind the latest but safe. */
export const updateAvailableWords = (version: string): string => `UPDATE AVAILABLE: cyberspace-mcp ${version}`
/** Why, when the newer release fixes a security problem. */
export const SECURITY_WHY = 'This version has a security problem.'
/** The line once an earlier I'VE UPDATED was followed by the old version again. */
export const stillOnWords = (version: string): string => `Still on version ${version}.`

export function AgentUpdateNotice({ notice, onUpdated }: { notice: AgentNotice; onUpdated: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const must = notice.level === 'must'
  const Icon = must ? ShieldAlert : CircleArrowUp
  return (
    <div className={`agentupd${must ? ' agentupd--must' : ''}`} role={must ? 'alert' : 'status'}>
      <p className="agentupd__head">
        <Icon size={must ? 16 : 13} aria-hidden="true" />
        <span>{must ? mustUpdateWords(notice.latest) : updateAvailableWords(notice.latest)}</span>
      </p>
      {must && notice.security && <p className="agentupd__line">{SECURITY_WHY}</p>}
      <p className="agentupd__line agentupd__line--dim">
        {notice.stillOn ? stillOnWords(notice.stillOn) : `Running: ${notice.running}`}
      </p>
      <div className="agentupd__acts">
        <button type="button" className="agentupd__act" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDown size={11} aria-hidden="true" className={open ? 'is-open' : undefined} /> HOW TO UPDATE
        </button>
        <button type="button" className="agentupd__act agentupd__act--done" onClick={onUpdated}>
          <Check size={11} aria-hidden="true" /> I&apos;VE UPDATED
        </button>
      </div>
      {open && <HowToUpdate version={notice.latest} />}
    </div>
  )
}

/** HOW TO UPDATE, unfolded: the README's commands, pinned to the version to update to. */
export function HowToUpdate({ version }: { version: string }): JSX.Element {
  return (
    <div className="agentupd__how">
      {updateSteps(version).map((s) => (
        <div key={s.label} className="agentupd__step">
          <span className="agentupd__step-label">{s.label}:</span>
          <code>{s.command}</code>
        </div>
      ))}
      <p className="agentupd__line agentupd__line--dim">Then restart serve.</p>
    </div>
  )
}
