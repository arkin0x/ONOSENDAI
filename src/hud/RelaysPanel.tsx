/**
 * RelaysPanel.tsx — the relays this client fans out across.
 *
 * cyberspace.nostr1.com is the shared default and is pinned: everyone meets
 * there, so it cannot be removed. Add your own below it, and movement, hidden
 * content, discovery and everyone else's chains all ride the whole set. A dot
 * per relay shows whether the socket is open right now.
 */

import { useEffect, useState } from 'react'
import { connected } from '../lib/relay'
import { getPool } from '../lib/relay'
import { DEFAULT_RELAY, useRelays } from '../store/useRelays'

export function RelaysPanel(): JSX.Element {
  const relays = useRelays((s) => s.relays)
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  // Connection dots update on their own clock; the pool is not reactive.
  const [, tick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 2000)
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
          const open = status.get(r)
          const pinned = r === DEFAULT_RELAY
          return (
            <li key={r} className="relays__row">
              <span className={`relays__dot ${open ? 'is-on' : ''}`} title={open ? 'connected' : 'not connected'} />
              <span className="relays__url" title={r}>{r.replace(/^wss?:\/\//, '')}</span>
              {pinned ? (
                <span className="relays__default" title="The shared default, always present">DEFAULT</span>
              ) : (
                <button className="targets__remove" onClick={() => useRelays.getState().remove(r)} aria-label="Remove relay" title="Remove relay">✕</button>
              )}
            </li>
          )
        })}
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
      {error && <p className="notice">Not a valid ws:// or wss:// URL.</p>}

      <p className="legend__note">
        Everything the client does fans out across these. The default is shared
        by everyone and stays; yours are added on top and kept on this device.
      </p>
    </section>
  )
}
