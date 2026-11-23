/**
 * foundGames.ts - keeps the GAMES panel's notes (lib/games/discovered.ts)
 * as the chain and the finds change: a game this identity entered (its
 * enter-virtual on the chain, from this client or another) and a game whose
 * world bag opened here are noted for the identity on screen, so neither
 * drops off the list after a respawn, which starts a new chain, or a reload,
 * which starts with no finds. Only games this client implements and has on.
 * Nothing is published.
 */

import { enteredOnChain, noteFoundGame, worldsOpened } from '../lib/games/discovered'
import { implementedGames } from '../lib/games/registry'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'

/** Note every game the chain and the finds say this identity found. */
export function noteFoundNow(): void {
  const games = implementedGames()
  if (games.length === 0) return
  const cs = useCyberspace.getState()
  const me = cs.identity.pubkey
  const known = new Set(games.map((g) => g.pubkey))
  for (const pk of enteredOnChain(cs.actions())) if (known.has(pk)) noteFoundGame(me, pk)
  for (const pk of worldsOpened(Object.values(useShards.getState().discovered), games)) noteFoundGame(me, pk)
}

useCyberspace.subscribe((s, prev) => { if (s.events !== prev.events || s.identity.pubkey !== prev.identity.pubkey) noteFoundNow() })
useShards.subscribe((s, prev) => { if (s.discovered !== prev.discovered) noteFoundNow() })
