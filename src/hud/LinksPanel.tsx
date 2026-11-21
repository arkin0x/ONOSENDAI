/**
 * LinksPanel.tsx: the menu's Official panel, the official places to read
 * about and build on Cyberspace, each a link that opens in a new tab.
 *
 * The last two rows are arkinox himself (arkinox, 2026-11-21: "lets add my X
 * profile to the onosendai menu official links, as well as my nostr profile
 * under that. put an appropriate icon for each"): his X account, then his
 * nostr profile, each with its mark (BrandMarks.tsx). The nostr row is a real
 * link to his profile on njump, the page ONOSENDAI already falls back to for
 * nostr addresses (sno-core sellerLink), so a long press, a copy or a middle
 * click gets a page that opens anywhere; a plain tap opens his profile right
 * here instead, in the same ProfileView a tap on any name opens.
 */

import { nip19 } from 'nostr-tools'
import type { MouseEvent } from 'react'
import { Explanation } from './Explanation'
import { NostrMark, XMark } from './BrandMarks'
import { STRAYLIGHT_INVITE } from '../tutorial/straylight'
import { useProfileView } from '../store/useProfileView'

/** arkinox's pubkey, the author of Cyberspace (npub1arkn0x...). */
export const ARKINOX_PUBKEY = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'

export interface OfficialLink {
  href: string
  name: string
  what: string
  /** The brand mark shown before the name, when the row has one. */
  mark?: (props: { size?: number }) => JSX.Element
  /** A nostr profile: a plain tap opens it in ProfileView rather than the href. */
  pubkey?: string
}

export const OFFICIAL: OfficialLink[] = [
  { href: 'https://github.com/arkin0x/cyberspace', name: 'Cyberspace v2 Specification', what: 'the core protocol documentation' },
  { href: STRAYLIGHT_INVITE, name: 'Straylight Cafe', what: 'the cyberspace community on Armada' },
  { href: 'https://cyberspace.international', name: 'cyberspace.international', what: 'education, proliferation, adoption of cyberspace' },
  { href: 'https://snocrash.art', name: 'SnoCrash', what: 'SNO format 3D model builder' },
  { href: 'https://github.com/arkin0x/ONOSENDAI/tree/v2', name: 'ONOSENDAI v2 Codebase', what: 'this client on GitHub' },
  { href: 'https://www.youtube.com/@onosendaitv', name: 'Cyberspace TV', what: 'the 24/7 live stream' },
  { href: 'https://x.com/arkinoxreturns', name: 'arkinox on X', what: 'the author of Cyberspace', mark: XMark },
  { href: `https://njump.me/${nip19.npubEncode(ARKINOX_PUBKEY)}`, name: 'arkinox on nostr', what: 'the author of Cyberspace', mark: NostrMark, pubkey: ARKINOX_PUBKEY },
]

/** A plain tap on a profile row opens the profile here; a modified or middle click keeps the link. */
export function openProfileHere(e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'preventDefault'>, pubkey: string): void {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  useProfileView.getState().open(pubkey)
}

export function LinksPanel(): JSX.Element {
  return (
    <section className="panel panel--links">
      <header className="panel__head">
        <h2>Official</h2>
      </header>
      {OFFICIAL.map((l) => {
        const Mark = l.mark
        const pubkey = l.pubkey
        return (
          <p key={l.href} className="links__row">
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={pubkey ? (e) => openProfileHere(e, pubkey) : undefined}
            >{Mark && <Mark />}{l.name}</a>
            <span className="links__what"> - {l.what}</span>
          </p>
        )
      })}
      <Explanation>
        These are the official places to read about and build on Cyberspace, and
        each one opens in a new tab. The Cyberspace v2 Specification is the
        protocol itself: coordinates, movement and its proofs, region keys,
        hyperspace and every event kind. Straylight Cafe is the cyberspace community, a
        chat on Armada where people exploring cyberspace hang out. cyberspace.international is for teaching
        Cyberspace and bringing more people and apps to it. SnoCrash builds 3D
        models in the SNO format that Cyberspace objects use. The ONOSENDAI v2
        Codebase is the source code of this client on GitHub. The last two are
        arkinox, the author of Cyberspace, on X and on nostr; his nostr profile
        opens right here instead.
      </Explanation>
    </section>
  )
}
