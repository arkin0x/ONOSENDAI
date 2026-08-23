/**
 * AvatarsPanel.tsx — everyone else, by how recently they moved.
 *
 * Each row is a pubkey and its newest action on the relay. SPECTATE anchors
 * the scene on that avatar's chain head and hands the explorer their history;
 * the field above takes any npub or hex key, for someone who has not moved
 * lately or is not on this relay's feed at all. Your own key is listed when it
 * has published, marked YOU, since spectating yourself is just being here.
 */

import { useEffect, useState } from 'react'
import { useRecentAvatars } from '../hooks/useRecentAvatars'
import { parsePubkey } from '../lib/chains'
import { CYBERSPACE_RELAY } from '../lib/relay'
import { spectate } from '../lib/spectator'
import { ProfileBadge } from './ProfileBadge'
import { targetColor } from '../lib/targets'
import { formatAgo, formatStamp } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'

export function AvatarsPanel(): JSX.Element {
  const { avatars, status } = useRecentAvatars()
  const me = useCyberspace((s) => s.identity.pubkey)
  const targets = useCyberspace((s) => s.targets)
  const [input, setInput] = useState('')
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 10_000)
    return () => window.clearInterval(t)
  }, [])

  const typed = parsePubkey(input)

  const go = (pubkey: string): void => {
    setInput('')
    void spectate(pubkey)
  }

  return (
    <section className="panel panel--avatars">
      <header className="panel__head">
        <h2>Avatars</h2>
        <span className="tag">{status === 'loading' ? 'LOADING' : `${avatars.length} SEEN`}</span>
      </header>

      <form
        className="avatars__find"
        onSubmit={(e) => { e.preventDefault(); if (typed) go(typed) }}
      >
        <input
          className="avatars__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="npub or hex pubkey"
          spellCheck={false}
          autoComplete="off"
          aria-label="Pubkey to spectate"
        />
        <button className="avatars__go" type="submit" disabled={!typed}>SPECTATE</button>
      </form>

      {status === 'error' && <p className="notice">Could not reach {CYBERSPACE_RELAY.replace('wss://', '')}.</p>}

      <ul className="avatars__list">
        {avatars.map((a) => {
          const you = a.pubkey === me
          const on = !!targets[a.pubkey]
          return (
            <li key={a.pubkey} className="avatars__row">
              <ProfileBadge pubkey={a.pubkey} />
              <span className={`avatars__type avatars__type--${a.type}`}>{a.type.toUpperCase()}</span>
              <span className="avatars__when" title={formatStamp(a.createdAt)}>{formatAgo(a.createdAt, now)}</span>
              {you ? (
                <span className="avatars__you">YOU</span>
              ) : (
                <span className="avatars__acts">
                  <button
                    className={`targets__toggle targets__toggle--mini ${on ? 'is-on' : ''}`}
                    style={on ? { color: targetColor(a.pubkey), borderColor: targetColor(a.pubkey) } : undefined}
                    aria-pressed={on}
                    title={on ? 'Stop targeting' : 'Target'}
                    onClick={() => useCyberspace.getState().toggleTarget(a.pubkey)}
                  >◎</button>
                  <button className="avatars__spectate" onClick={() => go(a.pubkey)}>SPECTATE</button>
                </span>
              )}
            </li>
          )
        })}
        {status === 'ready' && avatars.length === 0 && (
          <li className="avatars__empty">No v2 actions on the relay yet.</li>
        )}
      </ul>

      <p className="legend__note">
        Newest kind:3333 action per pubkey on {CYBERSPACE_RELAY.replace('wss://', '')}.
        Spectating anchors the scene on their chain head and gives the chain
        explorer their history; the controls stand down until you end it.
      </p>
    </section>
  )
}
