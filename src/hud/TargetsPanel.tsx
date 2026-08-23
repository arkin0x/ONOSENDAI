/**
 * TargetsPanel.tsx — who you are pointing at.
 *
 * A target is a pubkey whose chain head gets the Earth treatment: a reticle
 * when it is in frame, a chevron on the nearest edge when it is not, the
 * distance either way, and the avatar itself once you are near. Any number at
 * once. Targets come from three places: a key typed here, the Avatars panel,
 * and a contact list, which is fetched for any npub because the key this
 * client spawned with has no follows of its own.
 */

import { useEffect, useMemo, useState } from 'react'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { parsePubkey } from '../lib/chains'
import { fetchContacts, GENERAL_RELAYS, type Contact } from '../lib/contacts'
import { spectate } from '../lib/spectator'
import { targetColor } from '../lib/targets'
import { formatAgo, formatStamp } from '../lib/time'
import { useCyberspace } from '../store/useCyberspace'
import { ProfileBadge } from './ProfileBadge'

export function TargetsPanel(): JSX.Element {
  const targets = useCyberspace((s) => s.targets)
  const me = useCyberspace((s) => s.identity)
  const myPos = useCyberspace((s) => s.position)
  const [input, setInput] = useState('')
  const [who, setWho] = useState(me.npub)
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [contactsState, setContactsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), 10_000)
    return () => window.clearInterval(t)
  }, [])

  // Logging in is a new identity: point "Follows of" at it, and drop the old
  // identity's contacts so the list never shows one key's follows under
  // another's npub.
  useEffect(() => {
    setWho(me.npub)
    setContacts(null)
    setContactsState('idle')
  }, [me.npub])

  const typed = parsePubkey(input)
  const whoHex = parsePubkey(who)
  const list = Object.values(targets)

  // Nearest first. A follow you have never seen move still has a place: its
  // spawn coordinate, straight from its pubkey (spec §3.1), which is exactly
  // where it would appear. Most of a contact list has not spawned, so this is
  // the honest position for nearly all of them. Ties (all but impossible across
  // 85-bit coordinates) fall back to the name.
  const sortedContacts = useMemo(() => {
    if (!contacts) return contacts
    const withDistance = contacts.map((c) => {
      const p = coordToXyz(hexToCoord(c.pubkey))
      const dx = myPos.x - p.x
      const dy = myPos.y - p.y
      const dz = myPos.z - p.z
      return { c, d2: dx * dx + dy * dy + dz * dz }
    })
    withDistance.sort((a, b) => {
      if (a.d2 !== b.d2) return a.d2 < b.d2 ? -1 : 1
      const an = (a.c.name ?? a.c.pubkey).toLowerCase()
      const bn = (b.c.name ?? b.c.pubkey).toLowerCase()
      return an < bn ? -1 : an > bn ? 1 : 0
    })
    return withDistance.map((x) => x.c)
  }, [contacts, myPos])

  const loadContacts = async (): Promise<void> => {
    if (!whoHex) return
    setContactsState('loading')
    try {
      setContacts(await fetchContacts(whoHex))
      setContactsState('ready')
    } catch {
      setContactsState('error')
    }
  }

  return (
    <section className="panel panel--targets">
      <header className="panel__head">
        <h2>Targets</h2>
        <span className="tag">{list.length} ACTIVE</span>
      </header>

      <form className="avatars__find" onSubmit={(e) => { e.preventDefault(); if (typed) { useCyberspace.getState().addTarget(typed); setInput('') } }}>
        <input className="avatars__input" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="npub or hex pubkey" spellCheck={false} autoComplete="off" aria-label="Pubkey to target" />
        <button className="avatars__go" type="submit" disabled={!typed}>TARGET</button>
      </form>

      <ul className="avatars__list targets__list">
        {list.map((t) => (
          <li key={t.pubkey} className="targets__row">
            <span className="targets__dot" style={{ background: targetColor(t.pubkey), boxShadow: `0 0 6px ${targetColor(t.pubkey)}` }} />
            <ProfileBadge pubkey={t.pubkey} fallbackName={t.name} />
            <span className={`targets__status targets__status--${t.status}`} title={t.lastActive ? formatStamp(t.lastActive) : undefined}>
              {t.status === 'live' && t.lastActive ? formatAgo(t.lastActive, now)
                : t.status === 'resolving' ? 'FINDING'
                  : t.status === 'spawn' ? 'AT SPAWN'
                    : 'RELAY?'}
            </span>
            <button className="avatars__spectate" onClick={() => void spectate(t.pubkey)} title="Spectate">SPECTATE</button>
            <button className="targets__remove" onClick={() => useCyberspace.getState().removeTarget(t.pubkey)} aria-label="Remove target" title="Remove target">✕</button>
          </li>
        ))}
        {list.length === 0 && <li className="avatars__empty">No targets. Add a key, or toggle one in Avatars.</li>}
      </ul>

      <div className="targets__follows">
        <span className="legend__label">Follows of</span>
        <form className="avatars__find" onSubmit={(e) => { e.preventDefault(); void loadContacts() }}>
          <input className="avatars__input" value={who} onChange={(e) => setWho(e.target.value)}
            placeholder="npub or hex pubkey" spellCheck={false} autoComplete="off" aria-label="Whose follows to list" />
          <button className="avatars__go" type="submit" disabled={!whoHex || contactsState === 'loading'}>
            {contactsState === 'loading' ? 'LOADING' : 'LOAD'}
          </button>
        </form>
        {contactsState === 'error' && <p className="notice">Could not reach the contact relays.</p>}
        {contactsState === 'ready' && sortedContacts && (
          <ul className="avatars__list">
            {sortedContacts.map((c) => {
              const on = !!targets[c.pubkey]
              return (
                <li key={c.pubkey} className="targets__row targets__row--contact">
                  <ProfileBadge pubkey={c.pubkey} fallbackName={c.name} />
                  <button
                    className={`targets__toggle ${on ? 'is-on' : ''}`}
                    style={on ? { color: targetColor(c.pubkey), borderColor: targetColor(c.pubkey) } : undefined}
                    aria-pressed={on}
                    onClick={() => useCyberspace.getState().toggleTarget(c.pubkey, c.name)}
                  >{on ? 'TARGETED' : 'TARGET'}</button>
                </li>
              )
            })}
            {sortedContacts.length === 0 && <li className="avatars__empty">No kind 3 contact list found for that key.</li>}
          </ul>
        )}
      </div>

      <p className="legend__note">
        A target is pointed at from anywhere, like Earth: reticle in frame,
        chevron on the edge, distance either way, and the avatar itself once
        you are near. Positions are chain heads on the relay, kept live; a key
        with no chain is pointed at its spawn coordinate. Follows come from
        kind 3 on {GENERAL_RELAYS.map((r) => r.replace('wss://', '')).join(', ')}.
      </p>
    </section>
  )
}
