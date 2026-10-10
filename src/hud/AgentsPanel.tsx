/**
 * AgentsPanel.tsx: invite an agent, and the agents that name you as operator.
 *
 * An agent is a program with a nostr key of its own that gets a body in
 * cyberspace through cyberspace-mcp. It never holds your key and you never
 * hold its (arkinox, 2026-10-09, ruling 5). COPY puts an invitation on the
 * clipboard for you to paste to the agent (ruling 3; lib/agentInvite.ts):
 * the guide, the install line, your npub, your current coordinate as the
 * rendezvous, a one-time meeting code and a suggested budget, never funds.
 * The code is shown beside the button after a copy, since the agent will
 * put it in the message it hides for you and you need it to know that
 * message is theirs. MY AGENTS lists the kind 0 profiles that carry
 * bot: true and a p tag naming you as operator (ruling 9), with the npub
 * copyable and SPECTATE as the Avatars panel has it (ruling 4), kept to
 * the ones you also follow (arkinox, 2026-10-10).
 */

import { useState } from 'react'
import { useMyAgents } from '../hooks/useMyAgents'
import { invitationText, meetingCode } from '../lib/agentInvite'
import { safeNpub } from '../lib/npub'
import { spectate } from '../lib/spectator'
import { shortHex } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { Explanation } from './Explanation'
import { ProfileBadge } from './ProfileBadge'

/** How long a tapped button says COPIED before its label returns. */
const COPIED_MS = 1200

export function AgentsPanel(): JSX.Element {
  const identity = useCyberspace((s) => s.identity)
  const coordHex = useCyberspace((s) => s.coordHex())
  const { agents, status, refresh } = useMyAgents(identity.pubkey)
  // 'invite', or the pubkey whose npub was copied last.
  const [copied, setCopied] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)

  const copy = (key: string, text: string): void => {
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(key); window.setTimeout(() => setCopied((c) => (c === key ? null : c)), COPIED_MS) },
      () => { /* no clipboard here: nothing to report */ },
    )
  }
  // A fresh code on every COPY: the one shown is the one in the clipboard.
  const copyInvite = (): void => {
    const next = meetingCode()
    setCode(next)
    copy('invite', invitationText({ npub: identity.npub, coordinateHex: coordHex, code: next }))
  }

  return (
    <section className="panel panel--agents">
      <header className="panel__head">
        <h2>Agents</h2>
        {status === 'loading' ? (
          <span className="tag">LOADING</span>
        ) : (
          <button className="tag tag--tap" onClick={refresh} title="Ask the relays again">{agents.length} MINE</button>
        )}
      </header>

      <div className="agents__invite">
        <span className="legend__label">Invite an agent</span>
        <button className="identity__change" onClick={copyInvite} title="Copy an invitation to the clipboard: the guide, the install line, your npub, your coordinate as the rendezvous, a one-time meeting code and a budget">
          {copied === 'invite' ? 'COPIED' : 'COPY'}
        </button>
        {code && <code className="agents__code" title="The one-time meeting code in the invitation you copied last. The agent puts it in what it hides and says for you.">{code}</code>}
      </div>

      <span className="legend__label">My agents</span>
      <ul className="avatars__list">
        {agents.map((pubkey) => {
          const npub = safeNpub(pubkey)
          return (
            <li key={pubkey} className="avatars__row agents__row">
              <ProfileBadge pubkey={pubkey} />
              <button className="copy agents__npub" onClick={() => copy(pubkey, npub)} title={`${npub}\nTap to copy`}>
                {copied === pubkey ? 'COPIED' : shortHex(npub, 12, 6)}
              </button>
              <button className="avatars__spectate" onClick={() => void spectate(pubkey)}>SPECTATE</button>
            </li>
          )
        })}
        {status !== 'loading' && agents.length === 0 && (
          <li className="avatars__empty">No agents yet.</li>
        )}
      </ul>
      {status === 'error' && <p className="notice">Could not reach the relays.</p>}

      <Explanation>
        An agent is a program with a nostr key of its own that moves, talks,
        hides and finds in cyberspace like anyone, marked as a bot with you
        named as its operator. It never holds your key and you never hold
        its. COPY puts an invitation on the clipboard with everything the
        agent needs: the guide, the install line, your npub, your current
        coordinate as the rendezvous, a one-time meeting code and a suggested
        budget. Paste it to the agent. An agent is listed under MY AGENTS
        when its profile names you as operator and you follow it from your
        own account; a profile that names you without your follow is never
        shown. In this version nobody can travel to
        anybody, so the agent hides a message at your coordinate and you find
        it from where you stand.
      </Explanation>
    </section>
  )
}
