/**
 * straylight.ts: the Straylight route's way out (tutorial/script.ts
 * STRAYLIGHT_OPEN; owner, 2026-11-14).
 *
 * Straylight Cafe is the cyberspace community, a community on Armada
 * (armada.buzz, Soapbox's nostr chat app). The invite is the one link here:
 * its `#…` part is the invite's secret, which Armada reads in the page and
 * never sends to a server. Nothing of the player's goes with it: no key, no
 * pubkey, no referrer.
 */

import { registerTutorialEffect } from '../store/useTutorial'

/** The Straylight Cafe invite (owner, 2026-11-14). The one place it is written. */
export const STRAYLIGHT_INVITE = 'https://armada.buzz/invite/naddr1qvzqqqyzz5pzpawpqlpcs7u04rpyf4v2w9yyalx7kfl8vqws27wuzv9hfnvzjr8mqqqq0qc2nx#BAGM73fksEDqnrHTlJvgA5OA'

/** What the new tab is opened with: no handle back to this page, and no referrer sent. */
export const STRAYLIGHT_REL = 'noopener noreferrer'

/**
 * Open the invite in a new tab, as OPEN STRAYLIGHT CAFE's tap: a link
 * clicked, not window.open, whose features string ('noopener,noreferrer')
 * some browsers read as a request for a popup window rather than a tab.
 * Inside the tap, so no popup blocker stops it.
 */
export function openStraylight(): void {
  const link = document.createElement('a')
  link.href = STRAYLIGHT_INVITE
  link.target = '_blank'
  link.rel = STRAYLIGHT_REL
  link.click()
}

registerTutorialEffect('open-straylight', openStraylight)
