/**
 * personalStart.ts: whose personal lists are shown (store/personalLists.ts)
 * follows the identity signed in. Started once from App.tsx, beside the
 * other starters; the lists themselves never import the identity store.
 */

import { useCyberspace } from './useCyberspace'
import { personalListsMade } from './personalLists'
// The lists held outside useCyberspace, made when their modules load.
import './useStarred'
import './recentViewsList'
import './useItemsSeen'
import './useMessagesRead'

let started = false

export function startPersonalLists(): void {
  if (started) return
  started = true
  const follow = (owner: string): void => { for (const l of personalListsMade()) void l.setOwner(owner) }
  follow(useCyberspace.getState().identity.pubkey)
  useCyberspace.subscribe((s, prev) => { if (s.identity.pubkey !== prev.identity.pubkey) follow(s.identity.pubkey) })
}
