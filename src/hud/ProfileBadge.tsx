/**
 * ProfileBadge.tsx — a pubkey as a face and a name.
 *
 * A round avatar (the kind:0 picture, or a colour-from-the-key fallback with an
 * initial) and the name, or a shortened npub until the profile arrives. One
 * component so every list — follows, avatars, targets, a secret's creator —
 * shows a person the same way.
 */

import { useState } from 'react'
import { nip19 } from 'nostr-tools'
import { targetColor } from '../lib/targets'
import { profileLabel } from '../store/useProfiles'
import { useProfile } from '../hooks/useProfile'

export function ProfilePic({ pubkey, size = 22 }: { pubkey: string; size?: number }): JSX.Element {
  const profile = useProfile(pubkey)
  const [broken, setBroken] = useState(false)
  const npub = nip19.npubEncode(pubkey)
  const initial = (profile?.name ?? npub.slice(4, 5)).slice(0, 1).toUpperCase()
  const style = { width: size, height: size, minWidth: size } as const

  if (profile?.picture && !broken) {
    return <img className="pfp" style={style} src={profile.picture} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  }
  return (
    <span className="pfp pfp--fallback" style={{ ...style, background: targetColor(pubkey), fontSize: size * 0.5 }} aria-hidden="true">
      {initial}
    </span>
  )
}

interface BadgeProps {
  pubkey: string
  /** A petname from a contact list, shown when the profile has no name yet. */
  fallbackName?: string | null
  size?: number
  className?: string
}

export function ProfileBadge({ pubkey, fallbackName, size = 22, className = '' }: BadgeProps): JSX.Element {
  const profile = useProfile(pubkey)
  const npub = nip19.npubEncode(pubkey)
  const name = profile?.name ?? fallbackName ?? profileLabel(profile, npub)
  return (
    <span className={`badge ${className}`} title={npub}>
      <ProfilePic pubkey={pubkey} size={size} />
      <span className="badge__name">{name}</span>
    </span>
  )
}
