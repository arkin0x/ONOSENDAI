/**
 * AvatarsPanel.tsx — everyone else, by how recently they moved.
 *
 * Each row is a pubkey and its newest action on the relay. SPECTATE anchors
 * the scene on that avatar's chain head and hands the explorer their history;
 * the field above takes any npub, nprofile or hex key, for someone who has not
 * moved lately or is not on this relay's feed at all. Your own key is listed
 * when it has published, marked YOU, since spectating yourself is just being
 * here. The panel shows the five newest; VIEW MORE opens the whole list in an
 * overlay that scrolls, so the menu column stays short.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRecentAvatars, type RecentAvatars } from '../hooks/useRecentAvatars'
import { parsePubkey } from '../lib/chains'
import { CYBERSPACE_RELAY } from '../lib/relay'
import { spectate } from '../lib/spectator'
import { ProfileBadge } from './ProfileBadge'
import { targetColor } from '../lib/targets'
import { formatAgo, formatStamp } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { Explanation } from './Explanation'

/** Rows the panel shows before VIEW MORE takes over. */
const SHOWN = 5

export function AvatarsPanel(): JSX.Element {
  const { avatars, status } = useRecentAvatars()
  const me = useCyberspace((s) => s.identity.pubkey)
  const targets = useCyberspace((s) => s.targets)
  const [input, setInput] = useState('')
  const [more, setMore] = useState(false)
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 10_000)
    return () => window.clearInterval(t)
  }, [])

  const typed = parsePubkey(input)

  const go = (pubkey: string): void => {
    setInput('')
    setMore(false)
    void spectate(pubkey)
  }

  const row = (a: RecentAvatars['avatars'][number]): JSX.Element => {
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
          placeholder="npub, nprofile or hex pubkey"
          spellCheck={false}
          autoComplete="off"
          aria-label="Pubkey to spectate"
        />
        <button className="avatars__go" type="submit" disabled={!typed}>SPECTATE</button>
      </form>

      {status === 'error' && <p className="notice">Could not reach {CYBERSPACE_RELAY.replace('wss://', '')}.</p>}

      <ul className="avatars__list">
        {avatars.slice(0, SHOWN).map(row)}
        {status === 'ready' && avatars.length === 0 && (
          <li className="avatars__empty">No v2 actions on the relay yet.</li>
        )}
      </ul>
      {avatars.length > SHOWN && (
        <button className="avatars__more" onClick={() => setMore(true)}>VIEW MORE ({avatars.length - SHOWN})</button>
      )}

      <Explanation>
        Identities publish action proofs to move through cyberspace. You can
        spectate or target other identities to track where they go. Recent
        activity is listed above.
      </Explanation>

      {/* Through a portal: the panel's backdrop-filter makes it a stacking context, under the panels below it. */}
      {more && createPortal(
        <div className="modal" role="dialog" aria-modal="true" aria-label="All avatars" onPointerDown={() => setMore(false)}>
          <div className="modal__card modal__card--list" onPointerDown={(e) => e.stopPropagation()}>
            <header className="panel__head">
              <h2>Avatars</h2>
              <span className="tag">{avatars.length} SEEN</span>
            </header>
            <ul className="avatars__list avatars__list--all">{avatars.map(row)}</ul>
            <div className="modal__row">
              <button className="modal__cancel" onClick={() => setMore(false)}>CLOSE</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
