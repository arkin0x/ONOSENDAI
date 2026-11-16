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
 * greyed out while no game can be entered (useGame enterBlocked, the tour,
 * and a tutorial run), and for a game entered only from somewhere else (discovered.ts
 * enterFromRefusal, the seam for the draft enter-from requirement), whose
 * words then show under its name.
 *
 * DRONE RUN, a test game on a DEV key (lib/games/droneRun/game.ts), is listed
 * whenever it is on for this device (registry implementedGames: the device
 * switch, never the production host), found or not, and its ENTER is greyed
 * out while LIVE (useGame localOnlyRefusal). Under its name, which field it
 * plays and IMPORT LEVEL (DroneRunFields), locked while the chain is inside it.
 * The tutorial dungeon is listed as before.
 */

import { useMemo, useState } from 'react'
import { DroneRunFields } from './DroneRunFields'
import { openBracket } from '../lib/events'
import { discoveredGames, enterFromRefusal, notedGames, useFoundGames } from '../lib/games/discovered'
import { implementedGames } from '../lib/games/registry'
import type { GameDef } from '../lib/games/types'
import { useCyberspace } from '../store/useCyberspace'
import { useDemo } from '../store/useDemo'
import { enterBlocked, enterBlockedFor, isDroneRun, useGame } from '../store/useGame'
import { useDroneRunLevels } from '../store/useDroneRunLevels'
import { useShards } from '../store/useShards'
import { useTutorial } from '../store/useTutorial'
import { useTv } from '../store/useTv'
import { useWalk } from '../store/useWalk'
import { useWorkshop } from '../store/useWorkshop'
import '../store/foundGames'
import { Explanation } from './Explanation'

/** Why DRONE RUN's ENTER is greyed out while a level is being imported. */
export const IMPORTING_MESSAGE = 'Wait for the level to finish importing.'

/** Why ENTER is greyed out during the tour (/demo), which a game would sit under. */
export const TOUR_MESSAGE = 'Leave the tour first.'
/**
 * Why ENTER is greyed out while a tutorial run is going: the dungeon is
 * listed for everyone from the first step (owner, 2026-11-14), but entered
 * mid-run it would hold the chain the run's steps move, and cover the card.
 * The tutorial's own DUNGEON choice enters it and ends the run.
 */
export const TUTORIAL_MESSAGE = 'Finish or close the tutorial first.'
export const NO_GAMES_LINE = 'No games found yet.'

/** Why no game can be entered from here now, or null: the tour, a tutorial run, else useGame enterBlocked. */
export function whyNoEnter(): string | null {
  if (useDemo.getState().active) return TOUR_MESSAGE
  if (useTutorial.getState().active) return TUTORIAL_MESSAGE
  return enterBlocked()
}

/** Why `game` cannot be entered from here now, or null: the tour, a tutorial run, else useGame enterBlockedFor. */
export function whyNoEnterFor(game: GameDef): string | null {
  if (useDemo.getState().active) return TOUR_MESSAGE
  if (useTutorial.getState().active) return TUTORIAL_MESSAGE
  return enterBlockedFor(game)
}

/** The games listed: those found (lib/games/discovered.ts), and DRONE RUN whenever it is on here, in the registry's order. */
export function panelGames(found: readonly GameDef[], on: readonly GameDef[] = implementedGames()): GameDef[] {
  const listed = new Set(found.map((g) => g.pubkey))
  return on.filter((g) => listed.has(g.pubkey) || isDroneRun(g))
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
  useTutorial((s) => s.active)
  useTv((s) => s.on)
  useWorkshop((s) => s.open)
  useWalk((s) => s.queue.length + (s.open ? 1 : 0) + (s.running ? 1 : 0) + (s.falling ? 1 : 0))
  useCyberspace(() => whyNoEnter())
  // A test game's ENTER follows LOCAL and LIVE (useGame localOnlyRefusal).
  useCyberspace((s) => s.live)
  // DRONE RUN's ENTER waits while a level is being imported: the field it plays is chosen at ENTER.
  const importing = useDroneRunLevels((s) => s.busy !== null)
  const [entering, setEntering] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const chain = useMemo(() => useCyberspace.getState().actions(), [events])
  const games = useMemo(
    () => panelGames(discoveredGames({ noted: notedGames(pubkey), chain, finds: Object.values(finds) })),
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
          {isDroneRun(game) && <DroneRunFields locked />}
        </li>
      )
    }
    const place = enterFromRefusal(game)
    const why = whyNoEnterFor(game) ?? place ?? (isDroneRun(game) && importing ? IMPORTING_MESSAGE : null)
    return (
      <li key={game.pubkey} className="avatars__row games__row">
        <span className="avatars__who" title={game.name}>{game.name}</span>
        <button className="avatars__go" disabled={why !== null} title={why ?? undefined} onClick={() => enter(game)}>{entering === game.pubkey ? 'ENTERING' : 'ENTER'}</button>
        {place && <span className="games__where">{place}</span>}
        {isDroneRun(game) && <DroneRunFields locked={session !== null || busy !== null} />}
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
