/**
 * CashuCard.tsx - a hidden message's text, with a Cashu token shown as a card.
 *
 * The MESSAGE panel and the VIEWING panel print a message in full. A message
 * that carries a Cashu token used to print the token too: two thousand
 * characters of base64 filling a phone screen (arkinox, 2026-10-05). Now the
 * words around the token are the message, drawn as before, and the token is
 * a card: what it is, how much it holds, whether the mint says it has been
 * redeemed, where it was minted, its memo, and two ways to take it: COPY
 * TOKEN for any wallet, OPEN IN WALLET for a wallet app on this device. The
 * token's text itself is never drawn. A message without a token is unchanged.
 */

import { useState } from 'react'
import { Copy, Wallet } from 'lucide-react'
import { cashuTokensAsWritten, cashuWalletHref, textWithoutToken } from '../lib/cashu'
import { findNftLinks, textWithoutNftLinks } from '../lib/nftLink'
import { pictureOf } from '../lib/itemPicture'
import { NftCard } from './NftCard'
import { useCashu } from './useCashu'
import { cashuCardModel } from './cashuCardModel'
import { Explanation } from './Explanation'
import { ItemIcon } from './ItemIcon'

/**
 * A hidden message's full text, as a panel shows it. `words` draws text the
 * way the panel always has (a quote, a block); for a message with a token or
 * a nonfungible.cash claim link it draws only the words around them, and is
 * skipped when there are none. Each token and each link gets a card of its
 * own, so none of them is hidden by another.
 *
 * `tags` are the message's own tags, when the panel has its event: a
 * message that holds one claim link may carry that NFT's picture under the
 * item-picture rule (lib/itemPicture pictureOf, a data URI that fetches
 * nothing), and its card shows it. With several links, which picture goes
 * with which is not said, so none is shown.
 */
export function MessageText({ text, words, tags }: { text: string; words: (text: string) => JSX.Element; tags?: string[][] }): JSX.Element {
  const tokens = cashuTokensAsWritten(text)
  const links = findNftLinks(text)
  if (tokens.length === 0 && links.length === 0) return words(text)
  const rest = textWithoutToken(textWithoutNftLinks(text))
  const picture = links.length === 1 && Array.isArray(tags) ? pictureOf(tags)?.image : undefined
  return (
    <>
      {rest && words(rest)}
      {tokens.map((t, i) => <CashuCard key={i} token={t} />)}
      {links.map((l, i) => <NftCard key={i} link={l} picture={picture} />)}
    </>
  )
}

/**
 * The card for one token, asking its mint whether it has been redeemed.
 * `token` is the token exactly as written in the message, which is what COPY
 * TOKEN copies and OPEN IN WALLET opens.
 */
export function CashuCard({ token }: { token: string }): JSX.Element {
  const view = useCashu(token)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const card = cashuCardModel(view)

  const flash = (to: 'copied' | 'failed'): void => {
    setCopy(to)
    window.setTimeout(() => setCopy('idle'), 1400)
  }
  // The bare token, never a `cashu:` link: a wallet's receive screen takes
  // the token itself, and cashuTokensAsWritten has already left the prefix off.
  const copyToken = (): void => {
    if (!navigator.clipboard) { flash('failed'); return }
    navigator.clipboard.writeText(token).then(() => flash('copied'), () => flash('failed'))
  }

  return (
    <section className={`cashucard cashucard--${card.tone}`} aria-label="Cashu token">
      <div className="cashucard__head">
        <span className="cashucard__title"><ItemIcon type="message" coin size={14} /> CASHU TOKEN</span>
        {card.amount && <span className="cashucard__amount">{card.amount}</span>}
      </div>

      <div className="cashucard__state" aria-live="polite">
        <span className={`cashucard__status cashucard__status--${card.tone}`}>{card.status}</span>
        <p className="cashucard__line">{card.line}</p>
      </div>

      {(card.mint || card.memo) && (
        <dl className="cashucard__facts">
          {card.mint && <div><dt>Mint</dt><dd title={card.mint.url}>{card.mint.host}</dd></div>}
          {card.memo && <div><dt>Memo</dt><dd>{card.memo}</dd></div>}
        </dl>
      )}

      <div className="cashucard__acts">
        <button type="button" className={`cashucard__act ${copy === 'copied' ? 'is-on' : ''}`} onClick={copyToken} title="Copy the token, to paste into any Cashu wallet's receive screen">
          <Copy size={14} strokeWidth={2.25} aria-hidden />
          {copy === 'copied' ? 'COPIED' : copy === 'failed' ? 'COULD NOT COPY' : 'COPY TOKEN'}
        </button>
        <a className="cashucard__act" href={cashuWalletHref(token)} title="Open the token in a Cashu wallet app on this device">
          <Wallet size={14} strokeWidth={2.25} aria-hidden />
          OPEN IN WALLET
        </a>
      </div>
      <p className="cashucard__note">OPEN IN WALLET needs a Cashu wallet app installed on this device. COPY TOKEN works with any Cashu wallet: paste the token into its receive screen.</p>

      <Explanation>
        A Cashu token is bitcoin written down as text. Whoever has the text can redeem it into a Cashu wallet, and the mint, the service that issued it, pays out once: the first wallet to redeem it gets the sats, and after that the token holds nothing. The status above comes from asking the mint whether the token has been spent. Asking only reads; it never redeems or moves anything. The token itself is not shown here because it is a long block of letters that means nothing to read; COPY TOKEN and OPEN IN WALLET hand it over whole.
      </Explanation>
    </section>
  )
}
