/**
 * RelaysPanel.tsx — the relays this client fans out across.
 *
 * The canonical relay (useRelays DEFAULT_RELAY) is the shared default and is pinned: everyone meets
 * there, so it cannot be removed. Add your own below it, and movement, hidden
 * content, discovery and everyone else's chains all ride the whole set. The
 * former canonical relay (useRelays READ_FALLBACK_RELAY) is listed last,
 * READ ONLY: still read while it is retired, nothing sent there. A dot per
 * relay shows whether the socket is open right now.
 */

import { useEffect, useState } from 'react'
import { normalizeURL } from 'nostr-tools/utils'
import { connected } from '../lib/relay'
import { getPool } from '../lib/relay'
import { DEFAULT_RELAY, READ_FALLBACK_RELAY, isRetiredRelay, useRelays } from '../store/useRelays'
import { Explanation } from './Explanation'

export function RelaysPanel(): JSX.Element {
  const relays = useRelays((s) => s.relays)
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  // Connection dots update on their own clock; the pool is not reactive.
  // The panel re-renders only when a dot changes, and not at all while the
  // tab is hidden (2026-10-15): it re-rendered every 2 s regardless.
  const [, tick] = useState('')
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      const st = getPool().listConnectionStatus?.() ?? new Map<string, boolean>()
      tick([...st.entries()].map(([u, up]) => `${u}=${up ? 1 : 0}`).join(' '))
    }, 2000)
    return () => window.clearInterval(t)
  }, [])
  void connected

  const status = getPool().listConnectionStatus?.() ?? new Map<string, boolean>()

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const added = useRelays.getState().add(input)
    if (added) { setInput(''); setError(false) } else setError(true)
  }

  return (
    <section className="panel panel--relays">
      <header className="panel__head">
        <h2>Relays</h2>
        <span className="tag">{relays.length}</span>
      </header>

      <ul className="relays__list">
        {relays.map((r) => {
          // The pool keys its sockets by normalized URL (a trailing slash).
          const open = status.get(normalizeURL(r))
          return (
            <li key={r} className="relays__row">
              <span className={`relays__dot ${open ? 'is-on' : ''}`} title={open ? 'connected' : 'not connected'} />
              <span className="relays__url" title={r}>{r.replace(/^wss?:\/\//, '')}</span>
              {r === DEFAULT_RELAY ? (
                <span className="relays__default" title="The shared default, always present">DEFAULT</span>
              ) : (
                <button className="targets__remove" onClick={() => useRelays.getState().remove(r)} aria-label="Remove relay" title="Remove relay">✕</button>
              )}
            </li>
          )
        })}
        {!relays.includes(READ_FALLBACK_RELAY) && (
          <li key={READ_FALLBACK_RELAY} className="relays__row">
            <span className={`relays__dot ${status.get(normalizeURL(READ_FALLBACK_RELAY)) ? 'is-on' : ''}`} title={status.get(normalizeURL(READ_FALLBACK_RELAY)) ? 'connected' : 'not connected'} />
            <span className="relays__url" title={READ_FALLBACK_RELAY}>{READ_FALLBACK_RELAY.replace(/^wss?:\/\//, '')}</span>
            <span className="relays__default" title="The old default: still read while it is retired, nothing is sent there">READ ONLY</span>
          </li>
        )}
      </ul>

      <form className="avatars__find" onSubmit={submit}>
        <input
          className="avatars__input"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(false) }}
          placeholder="wss://relay.example.com"
          spellCheck={false}
          autoComplete="off"
          aria-label="Relay URL to add"
        />
        <button className="avatars__go" type="submit" disabled={!input.trim()}>ADD</button>
      </form>
      {error && <p className="notice">{isRetiredRelay(input) ? 'That relay is retired.' : 'Not a valid ws:// or wss:// URL.'}</p>}

      <Explanation>
        Your actions are published to each relay, and cyberspace data is pulled
        from each relay.
      </Explanation>
    </section>
  )
}
