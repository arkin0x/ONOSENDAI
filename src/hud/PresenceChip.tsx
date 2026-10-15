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
import { sectorKey, usePresence, type Person } from '../store/usePresence'
import { useChat } from '../store/useChat'
import { useProfile } from '../hooks/useProfile'
import { ProfilePic } from './ProfileBadge'
import { formatDistance } from 'sno-core/scale'
import type { Position } from '../lib/space'
import type { Plane } from 'cyberspace-core'
import { useEscape } from '../hooks/useEscape'

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

/** What decides whether the place on screen is your own sector. */
export interface SectorView {
  spectate: unknown
  /** Where you stand, and in which plane. */
  position: Position
  headPlane: Plane
  /** The scene's origin: what every view (VIEW, /C/, a hyperspace stop, an item, history, a pin) moves. */
  anchor: Position
  anchorPlane: Plane
  /** The cursor and the plane it is lined up in. */
  cursor: Position
  plane: Plane
}

/**
 * Whether the place on screen is somewhere other than your own sector (one
 * rule for every way of looking elsewhere, arkinox, 2026-10-15): spectating
 * someone; the scene anchored in another sector or plane, which is what VIEW,
 * a /C/ link, a hyperspace stop, a focused item, a pin and history all do;
 * or the cursor lined up in another sector or plane. A hyperspace stop view
 * moves the anchor and leaves the cursor at your head, which is how the chip
 * stayed up over a port in ideaspace.
 */
export function awayFromOwnSector(s: SectorView): boolean {
  if (s.spectate !== null) return true
  const home = sectorKey(s.position)
  if (s.anchorPlane !== s.headPlane || sectorKey(s.anchor) !== home) return true
  return s.plane !== s.headPlane || sectorKey(s.cursor) !== home
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
  // "In this sector" means yours, where you stand and are looking (arkinox,
  // 2026-10-11): while spectating someone else, or with the cursor in another
  // sector than your own position, the count is about somewhere you are not,
  // so the chip steps aside.
  const away = useCyberspace(awayFromOwnSector)
  const [open, setOpen] = useState(false)
  useEffect(() => { if (away) setOpen(false) }, [away])
  // The open list is a chip on the Escape stack (arkinox, 2026-10-01).
  useEscape('chip', open, () => setOpen(false))
  // Lit for a few seconds after an arrival, then back to plain.
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (lastArrivalAt === null) return
    setLit(true)
    const t = window.setTimeout(() => setLit(false), ARRIVAL_MS)
    return () => window.clearTimeout(t)
  }, [lastArrivalAt])
  const others = Object.values(people).filter((p) => p.pubkey !== me && !targets[p.pubkey]).sort((a, b) => b.lastActive - a.lastActive)
  // Gone when there is nothing to say and nobody is reading it. Open, it
  // stays until closed, whatever the scan does meanwhile.
  if (away) return null
  if (others.length === 0 && !loading && !open) return null
  const now = Math.floor(Date.now() / 1000)
  const label = others.length > 0 ? `${others.length} IN THIS SECTOR` : loading ? 'SCANNING' : 'NOBODY IN THIS SECTOR'
  const title = "Tap for what this is doing. An arrival lights this chip"
    + (muted ? "; the sound is off, which is the chat's mute." : " and chimes; the chat's mute silences it.")
  return (
    <div className={`hyperbar presence ${open ? 'is-open' : ''} ${lit ? 'is-arrival' : ''}`} role="status">
      <button className="presence__head" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={title}>
        <Users size={12} strokeWidth={2.25} aria-hidden />
        <span className="hyperbar__label">{label}</span>
        {open && <span className="presence__close" aria-hidden="true">✕</span>}
      </button>
      {open && (
        <p className="presence__explain">Searching cyberspace for nearby avatars.</p>
      )}
      {open && others.length > 0 && (
        <ul className="presence__list">
          {others.slice(0, 12).map((p) => <Row key={p.pubkey} person={p} now={now} />)}
        </ul>
      )}
    </div>
  )
}
