/**
 * nftCardModel.ts - what the NFT card says about a claim link, decided apart
 * from how it is drawn, and the hook that asks about it.
 *
 * A hidden message that carries a nonfungible.cash claim link is shown as a
 * card, the way a Cashu token is (CashuCard): what it is, its title when the
 * site said it, whether it has been claimed, whether it needs a password,
 * and CLAIM, which opens the link on nonfungible.cash. The card never claims.
 *
 * Asking follows useCashu: once a minute at most per link, shared by every
 * card showing it, and a link the site has called claimed or cancelled is
 * never asked about again. While lib/nftLink NFT_LINK_API is null (the site
 * sends no CORS headers, so a browser here cannot read its answer) nothing
 * is asked and every card reads CHECK ON SITE.
 */

import { useEffect, useState } from 'react'
import { checkNftLink, NFT_LINK_API, UNKNOWN_LINK, type NftLink, type NftLinkInfo, type NftLinkState } from '../lib/nftLink'

const RECHECK_MS = 60_000
const cache = new Map<string, { info: NftLinkInfo; at: number; pending: Promise<NftLinkInfo> | null }>()

/** Claimed and cancelled never change back, so they are never asked about again. */
const final = (s: NftLinkState): boolean => s === 'claimed' || s === 'cancelled'

/**
 * Ask `api` about a link, no more than once a minute, and never again once it
 * is final. An unknown answer never overwrites a definite one already in hand.
 */
export function infoOf(id: string, api: string, fetchFn: typeof fetch = fetch): Promise<NftLinkInfo> {
  const now = Date.now()
  const c = cache.get(id)
  if (c?.pending) return c.pending
  if (c && (final(c.info.state) || now - c.at < RECHECK_MS)) return Promise.resolve(c.info)
  const pending = checkNftLink(id, api, fetchFn).then((fresh) => {
    const prior = cache.get(id)?.info
    const info = fresh.state === 'unknown' && prior && prior.state !== 'unknown' ? prior : fresh
    cache.set(id, { info, at: Date.now(), pending: null })
    return info
  })
  cache.set(id, { info: c?.info ?? UNKNOWN_LINK, at: c?.at ?? 0, pending })
  return pending
}

/** For tests: forget every answer. */
export function forgetNftAnswers(): void { cache.clear() }

export type NftView = NftLinkInfo['state'] | 'checking'

/** What the site has said about a link, asked only when `api` is set. */
export function useNftLink(link: NftLink, api: string | null = NFT_LINK_API): { state: NftView; info: NftLinkInfo } {
  const [info, setInfo] = useState<NftLinkInfo | null>(() => (api ? cache.get(link.id)?.info ?? null : UNKNOWN_LINK))
  useEffect(() => {
    if (!api) { setInfo(UNKNOWN_LINK); return }
    let live = true
    void infoOf(link.id, api).then((i) => { if (live) setInfo(i) })
    return () => { live = false }
  }, [link.id, api])
  return info ? { state: info.state, info } : { state: 'checking', info: UNKNOWN_LINK }
}

export interface NftCardModel {
  /** The NFT's title, when the site said it. */
  title: string | null
  /** The status word. */
  status: string
  /** One short line for the status's tooltip. */
  statusTip: string
  /** The state, for the status's color: `nftcard__status--<tone>`. */
  tone: NftView
  /** Whether to say PASSWORD on the card. */
  password: boolean
  /** The open button's word: CLAIM while it may still be there, else OPEN ON SITE. */
  open: string
  /** The open button's tooltip. */
  openTip: string
}

/** The card's words for a link, in each state. */
export function nftCardModel(state: NftView, info: NftLinkInfo): NftCardModel {
  const gone = state === 'claimed' || state === 'cancelled' || state === 'missing'
  return {
    title: info.title,
    status: STATUS[state],
    statusTip: TIP[state],
    tone: state,
    password: info.password === true,
    open: gone ? 'OPEN ON SITE' : 'CLAIM',
    openTip: gone
      ? 'Opens the link on nonfungible.cash in a new tab'
      : 'Opens nonfungible.cash in a new tab, where you claim it. Not yours until then: the hider can cancel it or claim it back first',
  }
}

const STATUS: Record<NftView, string> = {
  unclaimed: 'UNCLAIMED',
  claimed: 'CLAIMED',
  cancelled: 'CANCELLED',
  missing: 'NOT FOUND',
  checking: 'CHECKING',
  unknown: 'CHECK ON SITE',
}

const TIP: Record<NftView, string> = {
  unclaimed: 'nonfungible.cash says nobody has claimed it yet',
  claimed: 'nonfungible.cash says someone already claimed it',
  cancelled: 'nonfungible.cash says the hider cancelled this link',
  missing: 'nonfungible.cash does not know this link',
  checking: 'Asking nonfungible.cash whether it has been claimed',
  unknown: 'ONOSENDAI does not ask nonfungible.cash about links. Open it there to see if it is still unclaimed',
}
