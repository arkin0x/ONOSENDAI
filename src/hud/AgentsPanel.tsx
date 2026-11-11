/**
 * AgentsPanel.tsx: invite an agent, and the agents that name you as operator.
 *
 * An agent is a program with a nostr key of its own that gets a body in
 * cyberspace through cyberspace-mcp. It never holds your key and you never
 * hold its (arkinox, 2026-10-09, ruling 5). COPY puts an invitation on the
 * clipboard for you to paste to your AI (ruling 3; lib/agentInvite.ts): the
 * guide, the rules, your npub as its operator, the packaged setup (init,
 * serve, doctor, the MCP URL), how you follow it and talk to it, and a
 * suggested budget, never funds. MY AGENTS lists the kind 0 profiles that
 * carry bot: true and a p tag naming you as operator (ruling 9), with the
 * npub copyable and SPECTATE as the Avatars panel has it (ruling 4), kept
 * to the ones you also follow (arkinox, 2026-10-10).
 *
 * Public, as a BETA (arkinox, 2026-10-13: "ship it so that we can make the
 * agent panel public"): drawn for everyone, no longer only for someone who
 * already has an agent, with a BETA tag whose tooltip says what beta means
 * here. Every signer gets the whole panel, the key this app generated for
 * you included, and never a login prompt (arkinox, 2026-11-11): that key is
 * an npub like any other.
 *
 * ACTIVATE (arkinox, 2026-11-11, D5): your agent replies with its npub; you
 * paste it into the field and tap ACTIVATE, which adds it to your kind 3
 * follow list (store/followAgent.ts, never from a fetch that fell short).
 * The field stays, for as many agents as you like. Once its kind 0 names
 * you, the agent shows under MY AGENTS.
 *
 * When the relays answer that you have no DM inbox, an extension or a bunker
 * gets SET UP DM INBOX (DmInboxSetup.tsx), which publishes your kind 10050
 * only after a confirmation; the generated key publishes it by itself once
 * you have an agent or have just activated one.
 *
 * TALK opens the private conversation with that agent (AgentTalk.tsx;
 * arkinox, 2026-10-10, operator and agent DMs): NIP-17 DMs only, the
 * STRATEGY line, and quick orders.
 *
 * A red dot on the title line (seen even with the panel folded) and on an
 * agent's TALK says that agent sent you a message you have not opened yet;
 * opening the conversation puts it out (arkinox, 2026-10-11). The watch that
 * notices is useAgentDmWatch.ts; the TALK modal itself is mounted from App
 * (AgentTalkHost), so the notifications toast can open it with the menu shut.
 */

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useMyAgents } from '../hooks/useMyAgents'
import { useAgentUnread } from '../hooks/useAgentDmWatch'
import { invitationText } from '../lib/agentInvite'
import { safeNpub } from '../lib/npub'
import { spectate } from '../lib/spectator'
import { shortHex } from '../lib/time'
import { appMinted, useCyberspace } from '../store/useCyberspace'
import { setTalking } from '../store/useAgentDms'
import { activateAgent } from '../store/followAgent'
import { DmInboxSetup, useMyDmInbox } from './DmInboxSetup'
import { Explanation } from './Explanation'
import { ProfileBadge } from './ProfileBadge'

/** How long a tapped button says COPIED before its label returns. */
const COPIED_MS = 1200

/** What BETA means here, as its tooltip (arkinox, 2026-10-13). */
export const BETA_TIP =
  'Beta: agents are new. The setup and the invitation may still change, and an agent can stall or make mistakes. It spends compute, never your funds. Keep its budget small and watch it in TALK.'

/** What ACTIVATE says once it went. */
export const ACTIVATED = 'Activated. Your agent shows under MY AGENTS once its profile names you.'

export function AgentsPanel(): JSX.Element {
  const identity = useCyberspace((s) => s.identity)
  const signerKind = useCyberspace((s) => s.signerKind)
  // Any signer, the generated key included, is an identity you can invite an
  // agent from: no login first (arkinox, 2026-11-11).
  const ready = /^[0-9a-f]{64}$/.test(identity.pubkey)
  const { agents, status, refresh } = useMyAgents(identity.pubkey)
  const myInbox = useMyDmInbox(identity.pubkey, ready)
  // 'invite', or the pubkey whose npub was copied last.
  const [copied, setCopied] = useState<string | null>(null)
  // ACTIVATE: the pasted npub, whether it is running, what it said, and whether one went this visit.
  const [paste, setPaste] = useState('')
  const [activating, setActivating] = useState(false)
  // Kept per identity, so a switch to another key starts clean (and never publishes its inbox unasked).
  const [noteFor, setNote] = useState<{ pubkey: string; text: string } | null>(null)
  const [activatedFor, setActivatedFor] = useState<string | null>(null)
  const note = noteFor?.pubkey === identity.pubkey ? noteFor.text : null
  const activated = activatedFor === identity.pubkey
  // The key this app generated (not a pasted nsec, also a local signer): its inbox publishes by itself.
  const generated = signerKind === 'local' && appMinted(identity.pubkey) === true
  const unread = useAgentUnread()

  const copy = (key: string, text: string): void => {
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(key); window.setTimeout(() => setCopied((c) => (c === key ? null : c)), COPIED_MS) },
      () => { /* no clipboard here: nothing to report */ },
    )
  }

  const activate = (): void => {
    if (activating) return
    const me = identity.pubkey
    setActivating(true)
    setNote(null)
    void activateAgent(paste).then((r) => {
      setActivating(false)
      if (!r.ok) { setNote({ pubkey: me, text: r.error }); return }
      setPaste('')
      setNote({ pubkey: me, text: ACTIVATED })
      setActivatedFor(me)
      refresh()
    })
  }

  const head = (
    <header className="panel__head">
      <h2 title={unread.total > 0 ? `${unread.total} new from your agents` : undefined}>
        Agents
        {unread.total > 0 && <span className="notif__dot agents__dot" aria-hidden="true" />}
        <span className="tag tag--beta" title={BETA_TIP} aria-label={`BETA. ${BETA_TIP}`}>BETA</span>
      </h2>
      {ready && (status === 'loading' ? (
        <span className="tag">LOADING</span>
      ) : (
        <button className="tag tag--tap" onClick={refresh} title="Ask the relays again">{agents.length} MINE</button>
      ))}
    </header>
  )

  const explain = (
    <Explanation>
      An agent is a program with its own nostr key that lives in cyberspace
      beside you, marked as a bot that names you as its operator. It never
      holds your key. COPY puts its setup on the clipboard for your AI: init,
      then serve, a local server whose waker starts your AI when there is
      something to do. Paste the npub your agent sends back and tap ACTIVATE,
      and it appears under MY AGENTS. TALK is how you give it orders, privately;
      👀 under a message means it has seen it. STRATEGY is standing orders,
      and KEEP GOING renews a spent budget.
    </Explanation>
  )

  return (
    <section className="panel panel--agents">
      {head}

      <div className="agents__invite">
        <span className="legend__label">Invite an agent</span>
        <button className="identity__change" onClick={() => copy('invite', invitationText({ npub: identity.npub }))} title="Copy an invitation for your AI: the guide, the rules, your npub as its operator, the setup commands and a budget">
          {copied === 'invite' ? 'COPIED' : 'COPY'}
        </button>
      </div>

      <form className="avatars__find agents__activate" onSubmit={(e) => { e.preventDefault(); activate() }}>
        <input className="avatars__input" value={paste} onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste your agent's npub" spellCheck={false} autoComplete="off" aria-label="Your agent's npub" />
        <button className="avatars__go" type="submit" disabled={activating || !paste.trim()}>{activating ? 'ACTIVATING' : 'ACTIVATE'}</button>
      </form>
      {note && <p className="notice" role="status">{note}</p>}

      {/* The generated key publishes its inbox by itself, so only once there is an agent to talk to. */}
      {myInbox.status === 'none' && (!generated || agents.length > 0 || activated) && (
        <div className="agents__inbox">
          <span className="legend__label" title="You publish no kind 10050, so your agent cannot write to you">No DM inbox</span>
          <DmInboxSetup />
        </div>
      )}

      <span className="legend__label">My agents</span>
      <ul className="avatars__list">
        {agents.map((pubkey) => {
          const npub = safeNpub(pubkey)
          const fresh = unread.byAgent[pubkey] ?? 0
          return (
            <li key={pubkey} className="avatars__row agents__row">
              <ProfileBadge pubkey={pubkey} tappable />
              <button className="copy agents__npub" onClick={() => copy(pubkey, npub)} title={`${npub}\nTap to copy`}>
                {copied === pubkey ? 'COPIED' : shortHex(npub, 12, 6)}
              </button>
              <button
                className="avatars__spectate agents__talk"
                onClick={() => setTalking(pubkey)}
                title={fresh > 0 ? `${fresh} new from this agent. Tap to read.` : 'Talk privately with this agent'}
                aria-label={fresh > 0 ? `Talk, ${fresh} unread` : undefined}
              >
                <MessageSquare size={10} /> TALK
                {fresh > 0 && <span className="notif__dot" aria-hidden="true" />}
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

      {explain}
    </section>
  )
}
