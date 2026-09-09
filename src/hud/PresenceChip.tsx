/**
 * PresenceChip.tsx — how many people are in this sector, and who.
 *
 * A sector is 2^30 gibsons on a side, so "in this sector" is not "beside
 * you": it is the part of cyberspace you are in, and the chip says so with
 * that word. Tap it for the names; TARGET makes one of them a target, which
 * is the existing path to their chain, their marker at any distance, and the
 * scene following them.
 */

import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { usePresence, type Person } from '../store/usePresence'
import { useChat } from '../store/useChat'
import { useProfile } from '../hooks/useProfile'
import { ProfilePic } from './ProfileBadge'
import { formatDistance } from '../lib/scale'

function ageLabel(at: number, now: number): string {
  const s = Math.max(0, now - at)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function Row({ person, now }: { person: Person; now: number }): JSX.Element {
  const profile = useProfile(person.pubkey)
  const me = useCyberspace((s) => s.position)
  const name = profile?.name ?? `${person.pubkey.slice(0, 12)}…`
  const d = [person.position.x - me.x, person.position.y - me.y, person.position.z - me.z].map((v) => (v < 0n ? -v : v))
  const far = d.reduce((a, b) => (a > b ? a : b), 0n)
  return (
    <li className="presence__row">
      <ProfilePic pubkey={person.pubkey} size={20} />
      <span className="presence__who">
        <span className="presence__name">{name}</span>
        <span className="presence__meta">{formatDistance(far)} away · {ageLabel(person.lastActive, now)}</span>
      </span>
      <button className="avatars__go presence__target" onClick={() => useCyberspace.getState().addTarget(person.pubkey, profile?.name ?? null)}>TARGET</button>
    </li>
  )
}

/** How long the chip stays lit after someone arrives. */
const ARRIVAL_MS = 4000

export function PresenceChip(): JSX.Element | null {
  const people = usePresence((s) => s.people)
  const loading = usePresence((s) => s.loading)
  const lastArrivalAt = usePresence((s) => s.lastArrivalAt)
  const targets = useCyberspace((s) => s.targets)
  const me = useCyberspace((s) => s.identity.pubkey)
  const muted = useChat((s) => s.muted)
  const [open, setOpen] = useState(false)
  // Lit for a few seconds after an arrival, then back to plain.
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (lastArrivalAt === null) return
    setLit(true)
    const t = window.setTimeout(() => setLit(false), ARRIVAL_MS)
    return () => window.clearTimeout(t)
  }, [lastArrivalAt])
  const others = Object.values(people).filter((p) => p.pubkey !== me && !targets[p.pubkey]).sort((a, b) => b.lastActive - a.lastActive)
  if (others.length === 0 && !loading) return null
  const now = Math.floor(Date.now() / 1000)
  const title = "People whose newest move landed in this sector or one beside it. A sector is 2^30 gibsons on a side. An arrival lights this chip"
    + (muted ? "; the sound is off, which is the chat's mute." : " and chimes; the chat's mute silences it.")
  return (
    <div className={`hyperbar presence ${open ? 'is-open' : ''} ${lit ? 'is-arrival' : ''}`} role="status">
      <button className="presence__head" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={title}>
        <Users size={12} strokeWidth={2.25} aria-hidden />
        <span className="hyperbar__label">{loading && others.length === 0 ? 'LOOKING' : `${others.length} IN THIS SECTOR`}</span>
      </button>
      {open && others.length > 0 && (
        <ul className="presence__list">
          {others.slice(0, 12).map((p) => <Row key={p.pubkey} person={p} now={now} />)}
        </ul>
      )}
    </div>
  )
}
