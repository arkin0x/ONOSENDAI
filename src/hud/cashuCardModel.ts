/**
 * cashuCardModel.ts - what the cashu card says about a token, decided apart from
 * how it is drawn.
 *
 * A hidden message that carries a Cashu token is shown as a card, not as two
 * thousand characters of base64 (arkinox, 2026-10-05): what it is, how much it
 * holds, whether it has been taken, and where it was minted. This turns the
 * useCashu view into those words, one state at a time, so every state's
 * sentence can be read and tested without rendering anything.
 */

import { cashuLabel, mintHost } from '../lib/cashu'
import { cashuStateLabel, type CashuView } from './useCashu'

export interface CashuCardModel {
  /** "21 sats"; null when the token cannot be read, so its amount is unknown. */
  amount: string | null
  /** The status word, in the STASH row's vocabulary, except the mint's silence is spelled out. */
  status: string
  /** The state, for the status's color: `cashucard__status--<tone>`. */
  tone: CashuView['state']
  /** One explicit sentence saying what the status means for whoever is reading. */
  line: string
  /** Where the token was minted: its host to show, its URL for the tooltip. Null when unreadable. */
  mint: { host: string; url: string } | null
  /** The token's own memo, when it carries one. */
  memo: string | null
}

/** The card's words for a message's token, in each of the states useCashu reports. */
export function cashuCardModel(view: CashuView): CashuCardModel {
  const status = view.state === 'unknown' ? 'COULD NOT BE CHECKED' : cashuStateLabel(view.state)
  if (!view.token) {
    return {
      amount: null,
      status: cashuStateLabel('unreadable'),
      tone: 'unreadable',
      line: 'This token could not be read. It may be cut short, joined to the word after it, or in a format this client does not know, so its amount and mint are unknown and the mint cannot be asked about it. COPY TOKEN still copies it exactly as it was written.',
      mint: null,
      memo: null,
    }
  }
  const host = mintHost(view.token.mint)
  const memo = view.token.memo?.trim() || null
  return { amount: cashuLabel(view.token), status, tone: view.state, line: lineFor(view.state, host), mint: { host, url: view.token.mint }, memo }
}

function lineFor(state: CashuView['state'], host: string): string {
  switch (state) {
    case 'checking': return `Asking ${host} whether this token has been redeemed.`
    case 'unclaimed': return `Not taken yet. ${host} says nobody has redeemed this token, so the first person to redeem it in a Cashu wallet gets the sats.`
    case 'redeemed': return `Already taken. ${host} says this token has been redeemed, so there is nothing left in it to claim.`
    case 'pending': return `${host} says this token is being redeemed right now. Open this again in a minute to see whether it went through.`
    default: return `${host} could not be reached, or gave an answer this client does not understand, so whether this token has been redeemed is unknown. A wallet will say so when you try to redeem it.`
  }
}
