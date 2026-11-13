/**
 * GamesPanel.tsx - GAMES in the menu (owner, 2026-11-13: "a game panel in
 * the menu UI so that you can enter a game that you've discovered whenever
 * you want"). It lists the games this identity found (lib/games/discovered.ts),
 * each with ENTER, or BACK INTO THE GAME while the chain is inside that game.
 *
 * ENTER is the one way in there is (store/useGame enter): it publishes
 * enter-virtual from wherever you stand, since entering puts you at the
 * game's entry point (owner's ruling, 2026-11-13: "You can enter a game from
 * anywhere"), and your place in cyberspace is held until you leave. It is
 * greyed out while no game can be entered (useGame enterBlocked, and the
 * tour), and for a game entered only from somewhere else (discovered.ts
 * enterFromRefusal, the seam for the draft enter-from requirement), whose
 * words then show under its name.
 */

import { useMemo, useState } from 'react'
import { openBracket } from '../lib/events'
import { discoveredGames, enterFromRefusal, notedGames, useFoundGames } from '../lib/games/discovered'
import type { GameDef } from '../lib/games/types'
import { useCyberspace } from '../store/useCyberspace'
import { useDemo } from '../store/useDemo'
import { enterBlocked, useGame } from '../store/useGame'
import { useShards } from '../store/useShards'
import { useTv } from '../store/useTv'
import { useWalk } from '../store/useWalk'
import { useWorkshop } from '../store/useWorkshop'
import '../store/foundGames'
import { Explanation } from './Explanation'

/** Why ENTER is greyed out during the tour (/demo), which a game would sit under. */
export const TOUR_MESSAGE = 'Leave the tour first.'
export const NO_GAMES_LINE = 'No games found yet.'

/** Why no game can be entered now, or null: the tour, else useGame enterBlocked. */
export function whyNoEnter(): string | null {
  return useDemo.getState().active ? TOUR_MESSAGE : enterBlocked()
}

export function GamesPanel(): JSX.Element {
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  const events = useCyberspace((s) => s.events)
  const atHead = useCyberspace((s) => s.atHead())
  const finds = useShards((s) => s.discovered)
  const version = useFoundGames((s) => s.version)
  const session = useGame((s) => s.session)
  const busy = useGame((s) => s.busy)
  // Drawn again whenever anything enterBlocked reads changes.
  useDemo((s) => s.active)
  useTv((s) => s.on)
  useWorkshop((s) => s.open)
  useWalk((s) => s.queue.length + (s.open ? 1 : 0) + (s.running ? 1 : 0) + (s.falling ? 1 : 0))
  useCyberspace(() => whyNoEnter())
  const blocked = whyNoEnter()
  const [entering, setEntering] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const chain = useMemo(() => useCyberspace.getState().actions(), [events])
  const games = useMemo(
    () => discoveredGames({ noted: notedGames(pubkey), chain, finds: Object.values(finds) }),
    // `version` is the noted list's: a new note draws it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubkey, chain, finds, version],
  )
  const inside = openBracket(chain)?.game?.pubkey ?? null

  const enter = (game: GameDef): void => {
    setNote(null)
    setEntering(game.pubkey)
    useGame.getState().enter(game).then(
      (why) => { setEntering(null); setNote(why) },
      (err: unknown) => { setEntering(null); setNote(err instanceof Error ? err.message : String(err)) },
    )
  }

  const row = (game: GameDef): JSX.Element => {
    if (inside === game.pubkey) {
      return (
        <li key={game.pubkey} className="avatars__row games__row">
          <span className="avatars__who" title={game.name}>{game.name}</span>
          <button className="avatars__go" disabled={session !== null || busy !== null || !atHead} onClick={() => { useGame.getState().resume() }}>BACK INTO THE GAME</button>
        </li>
      )
    }
    const place = enterFromRefusal(game)
    const why = blocked ?? place
    return (
      <li key={game.pubkey} className="avatars__row games__row">
        <span className="avatars__who" title={game.name}>{game.name}</span>
        <button className="avatars__go" disabled={why !== null} title={why ?? undefined} onClick={() => enter(game)}>{entering === game.pubkey ? 'ENTERING' : 'ENTER'}</button>
        {place && <span className="games__where">{place}</span>}
      </li>
    )
  }

  return (
    <section className="panel panel--games">
      <header className="panel__head"><h2>Games</h2></header>
      <ul className="avatars__list">
        {games.length > 0 ? games.map(row) : <li className="avatars__empty">{NO_GAMES_LINE}</li>}
      </ul>
      {note && <p className="notice" role="status">{note}</p>}
      <Explanation>Enter from anywhere. You come back where you entered.</Explanation>
    </section>
  )
}
