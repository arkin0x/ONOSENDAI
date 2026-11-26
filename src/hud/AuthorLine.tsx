/**
 * AuthorLine.tsx: who left a hidden message or sound and when, at the top of
 * its card (owner, 2026-11-26; shared pieces "Author colour" and "Time as a
 * block"): their picture in an octagon of their colour, their name, and
 * "Sealed at block 975,410 · 2 h ago".
 *
 * Under them their npub, to copy. For a message or a sound this line is the
 * card's whole account of who left it; the profile is one tap away.
 *
 * The block is reckoned from the newest block this client knows
 * (lib/sealedAt.ts); before one is known the line says only how long ago.
 */

import type { CSSProperties } from 'react'
import { Box } from 'lucide-react'
import { authorColour } from '../lib/authorColour'
import { sealedWords } from '../lib/sealedAt'
import { trustedTip } from '../lib/seeds/seedSources'
import { useNow } from '../hooks/useNow'
import { useHyperspace } from '../store/useHyperspace'
import { useProfile } from '../hooks/useProfile'
import { ProfilePic, ProfileTap } from './ProfileBadge'
import { CopyValue } from './ui/CopyValue'
import { safeNpub } from '../lib/npub'
import { shortHex } from '../lib/time'

export function AuthorLine({ pubkey, name, mine, createdAt }: { pubkey: string; name: string; mine: boolean; createdAt?: number }): JSX.Element {
  const tip = useHyperspace((s) => s.tipHeight) ?? trustedTip()
  const now = useNow(60_000)
  const when = sealedWords(createdAt, tip, now / 1000)
  const nip05 = useProfile(pubkey || null)?.nip05?.replace(/^_@/, '')
  const style = { '--author': authorColour(pubkey) } as CSSProperties
  return (
    <div className="authorline" style={style}>
      <ProfileTap pubkey={pubkey} className="authorline__pic"><ProfilePic pubkey={pubkey} size={30} /></ProfileTap>
      <div className="authorline__text">
        <span className="authorline__name"><i className="authordot" aria-hidden="true" />{name}{mine ? ' (you)' : ''}</span>
        {nip05 && <span className="secret__nip05 authorline__nip05">{nip05}</span>}
        {/* The line keeps its height before the time is known, so nothing under it moves. */}
        <span className="authorline__when">{when && <Box size={11} strokeWidth={2} aria-hidden />}{when || ' '}</span>
        {/* Their key, to copy, as the card's LEFT BY gave it: this line replaces that block for a message or a sound. */}
        <CopyValue className="secret__npub authorline__npub" value={safeNpub(pubkey)} shown={shortHex(safeNpub(pubkey), 14, 8)} />
      </div>
    </div>
  )
}
