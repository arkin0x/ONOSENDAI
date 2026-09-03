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
import { nip19 } from 'nostr-tools'
import { latestByPubkey, parsePubkey, V2_ACTIONS } from '../lib/chains'
import { fetchContacts, type Contact } from '../lib/contacts'
import { query } from '../lib/relay'
import { spectate } from '../lib/spectator'
import { targetColor } from '../lib/targets'
import { formatAgo, formatStamp } from '../lib/time'
import type { Position } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { profileLabel, useProfiles } from '../store/useProfiles'
import { ProfileBadge } from './ProfileBadge'
import { Explanation } from './Explanation'

export function TargetsPanel(): JSX.Element {
  const targets = useCyberspace((s) => s.targets)
  const me = useCyberspace((s) => s.identity)
  const myPos = useCyberspace((s) => s.position)
  const [input, setInput] = useState('')
  const [who, setWho] = useState(me.npub)
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [contactsState, setContactsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  // Where each follow actually is, for the ones the relay has a chain for.
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const profiles = useProfiles((s) => s.profiles)
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

  // Spawned first, nearest of them at the top; everyone else alphabetical below.
  // A follow the relay has a chain for is really somewhere, so it sorts by that
  // distance. Most of a contact list has never spawned and has no position at
  // all, so they are equally "nowhere" and fall to the name, which is what makes
  // a long list findable. Name is the profile name when it has arrived, else the
  // petname, else the key.
  const sortedContacts = useMemo(() => {
    if (!contacts) return contacts
    const d2 = (p: Position): bigint => {
      const dx = myPos.x - p.x
      const dy = myPos.y - p.y
      const dz = myPos.z - p.z
      return dx * dx + dy * dy + dz * dz
    }
    // The exact string ProfileBadge shows, so the order matches the names on
    // screen: the profile name, else the petname, else the short npub.
    const nameKey = (c: Contact): string => {
      const p = profiles[c.pubkey]
      return (p?.name ?? c.name ?? profileLabel(p, nip19.npubEncode(c.pubkey))).toLowerCase()
    }
    const byName = (a: Contact, b: Contact): number => {
      const an = nameKey(a)
      const bn = nameKey(b)
      return an < bn ? -1 : an > bn ? 1 : 0
    }
    return [...contacts].sort((a, b) => {
      const pa = positions[a.pubkey]
      const pb = positions[b.pubkey]
      if (pa && pb) {
        const da = d2(pa)
        const db = d2(pb)
        return da !== db ? (da < db ? -1 : 1) : byName(a, b)
      }
      if (pa) return -1
      if (pb) return 1
      return byName(a, b)
    })
  }, [contacts, positions, myPos, profiles])

  const loadContacts = async (): Promise<void> => {
    if (!whoHex) return
    const target = whoHex
    setContactsState('loading')
    setPositions({})
    let list: Contact[]
    try {
      list = await fetchContacts(target)
    } catch {
      setContactsState('error')
      return
    }
    setContacts(list)
    setContactsState('ready')
    // Best-effort: one query for every follow's chain, so the ones actually in
    // cyberspace can sort by real distance. A failure just leaves them alongside
    // the un-spawned, all alphabetical.
    try {
      const events = await query({ kinds: [3333], authors: list.map((c) => c.pubkey), '#A': V2_ACTIONS })
      if (parsePubkey(who) !== target) return // a newer load has taken over
      const pos: Record<string, Position> = {}
      for (const a of latestByPubkey(events)) pos[a.pubkey] = a.position
      setPositions(pos)
    } catch { /* no positions: the whole list stays alphabetical */ }
  }

  return (
    <section className="panel panel--targets">
      <header className="panel__head">
        <h2>Targets</h2>
        <span className="tag">{list.length} ACTIVE</span>
      </header>

      <form className="avatars__find" onSubmit={(e) => { e.preventDefault(); if (typed) { useCyberspace.getState().addTarget(typed); setInput('') } }}>
        <input className="avatars__input" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="npub, nprofile or hex pubkey" spellCheck={false} autoComplete="off" aria-label="Pubkey to target" />
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
            placeholder="npub, nprofile or hex pubkey" spellCheck={false} autoComplete="off" aria-label="Whose follows to list" />
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

      <Explanation>
        Target an identity to mark their location on your HUD.
      </Explanation>
    </section>
  )
}
