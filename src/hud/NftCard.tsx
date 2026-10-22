/**
 * NftCard.tsx - a nonfungible.cash claim link in a hidden message, shown as a card.
 *
 * Drawn wherever a message is printed in full (MessageText, beside the Cashu
 * card): NFT, its title when the site said it, its status, PASSWORD when
 * claiming needs one, CLAIM, which opens the whole link (with its `#` key) on
 * nonfungible.cash in a new tab, and COPY LINK. The link's text is never
 * drawn: its key is what claims. Claiming happens on the site, never here.
 *
 * The picture. The NFT's own picture lives on nonfungible.cash and is never
 * fetched by itself: a stranger's picture is unscreened here, and fetching it
 * tells the site the reader's address and when they read. The card shows the
 * message's own picture when the hider sealed one in under the item-picture
 * rule (lib/itemPicture: an imeta data URI, at most 32 a side, which fetches
 * nothing), else a placeholder. When the site has named the picture (only
 * once the link check is on, lib/nftLink NFT_LINK_API), tapping the
 * placeholder loads it, and only then.
 */

import { useState } from 'react'
import { Copy, ExternalLink, Gem, Lock } from 'lucide-react'
import { NFT_LINK_API, nftPictureUrl, type NftLink } from '../lib/nftLink'
import { nftCardModel, useNftLink } from './nftCardModel'
import { Explanation } from './Explanation'

/**
 * The card for one link. `picture` is the message's own sealed picture, a
 * data URI already checked by pictureOf, or undefined. `api` is for tests:
 * where to ask about the link, defaulting to NFT_LINK_API.
 */
export function NftCard({ link, picture, api }: { link: NftLink; picture?: string; api?: string | null }): JSX.Element {
  const { state, info, asked } = useNftLink(link, api === undefined ? NFT_LINK_API : api)
  const card = nftCardModel(state, info, asked)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  // Which picture was tapped for, by its hash: a tap on one NFT never loads another's (review of #440).
  const [tapped, setTapped] = useState<string | null>(null)

  const flash = (to: 'copied' | 'failed'): void => {
    setCopy(to)
    window.setTimeout(() => setCopy('idle'), 1400)
  }
  const copyLink = (): void => {
    if (!navigator.clipboard) { flash('failed'); return }
    navigator.clipboard.writeText(link.url).then(() => flash('copied'), () => flash('failed'))
  }

  const fullPicture = info.picture && tapped === info.picture ? nftPictureUrl(info.picture) : null
  const thumb = picture
    ? <img className="nftcard__thumb" src={picture} alt="" />
    : info.picture
      ? <button type="button" className="nftcard__thumb nftcard__thumb--tap" onClick={() => setTapped(info.picture)} title="Load its picture from nonfungible.cash" aria-label="Load its picture from nonfungible.cash"><Gem size={16} strokeWidth={2} aria-hidden /></button>
      : <span className="nftcard__thumb" title="Its picture is on nonfungible.cash"><Gem size={16} strokeWidth={2} aria-hidden /></span>

  return (
    <section className={`nftcard nftcard--${card.tone}`} aria-label="NFT">
      <div className="nftcard__head">
        {thumb}
        <span className="nftcard__name">
          <span className="nftcard__title">NFT</span>
          {card.title && <span className="nftcard__label">{card.title}</span>}
        </span>
      </div>

      {fullPicture && <img className="nftcard__picture" src={fullPicture} alt={card.title ?? 'NFT'} referrerPolicy="no-referrer" />}

      <div className="nftcard__state" aria-live="polite">
        <span className={`nftcard__status nftcard__status--${card.tone}`} title={card.statusTip}>{card.status}</span>
        {card.password && <span className="nftcard__status nftcard__status--password" title="Claiming asks for a password. Get it from whoever hid this"><Lock size={10} strokeWidth={2.5} aria-hidden /> PASSWORD</span>}
      </div>

      <div className="nftcard__acts">
        <a className="nftcard__act" href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={card.openTip}>
          <ExternalLink size={14} strokeWidth={2.25} aria-hidden />
          {card.open}
        </a>
        <button type="button" className={`nftcard__act ${copy === 'copied' ? 'is-on' : ''}`} onClick={copyLink} title="Copy the whole claim link, to open it somewhere else">
          <Copy size={14} strokeWidth={2.25} aria-hidden />
          {copy === 'copied' ? 'COPIED' : copy === 'failed' ? 'COULD NOT COPY' : 'COPY LINK'}
        </button>
      </div>

      <Explanation>
        An NFT from nonfungible.cash, left here as a claim link. It is not yours until you claim it there: until then the hider can cancel the link or claim it back, and anyone who reads this can claim it first. ONOSENDAI never claims it and never loads its picture by itself.
      </Explanation>
    </section>
  )
}
