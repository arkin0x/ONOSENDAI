/**
 * DroneRunScreen.tsx - DRONE RUN on screen: the first-person canvas
 * (Canvas3D: the run, the world, the drones, the gun in hand), the HUD over
 * it (hud/DroneRunHud: the input layer, health, guns, the cards), and the
 * game bar with the game's name and EXIT GAME, offered at every moment
 * (DECK-0002 §2.3). Kept thin: the work is in Canvas3D and the HUD.
 *
 * What it reads from the session (store/useGame): `world`, the shards, and
 * `entry`, the world's entry point (DECK-0002 §2.2), both set once the world
 * is read; `worldError` when it could not be. Also set with them: `level`,
 * the Level played (zones, entry, spawns, patrol; lib/games/droneRun/level/
 * level.ts), and `field`, which field it is (the built-in field or one
 * imported on this device; lib/games/droneRun/levelSource.ts). The shards and
 * the Level always come from the same field.
 */

import { useState } from 'react'
import { useGame } from '../../store/useGame'
import { Canvas3D } from './Canvas3D'
import { DroneRunHudMount } from './hud/DroneRunHud'

export function DroneRunScreen(): JSX.Element | null {
  const session = useGame((s) => s.session)
  const busy = useGame((s) => s.busy)
  const message = useGame((s) => s.message)
  const [exitFailed, setExitFailed] = useState(false)
  if (!session) return null
  const { game, world, entry, level, worldError } = session

  const leave = async (): Promise<void> => {
    const refused = await useGame.getState().exit()
    setExitFailed(refused !== null)
  }
  const status = busy === 'entering' ? 'ENTERING' : busy === 'exiting' ? 'LEAVING' : world === null && !worldError ? 'LOADING THE WORLD' : null

  return (
    <div className="gameview gameview--drun" role="application" aria-label={`${game.name}: in a game`} data-level={level?.id}>
      <div className="gameview__canvas">
        {entry && world && <Canvas3D game={game} world={world} entry={entry} level={level ?? null} />}
      </div>
      <DroneRunHudMount />
      <div className="gameview__bar">
        <span className="gameview__name">{game.name}</span>
        {status && <span className="gameview__status">{status}</span>}
        {/* Leaving is offered at every moment of play (DECK-0002 §2.3): only an exit already on its way holds it. */}
        <button className="gameview__exit" disabled={busy === 'exiting'} onClick={(e) => { e.currentTarget.blur(); void leave() }}>EXIT GAME</button>
      </div>
      {(message || worldError) && (
        <p className="gameview__note" role="status">
          {message ?? worldError}
          {exitFailed && message && <button className="tag tag--tap" onClick={() => { setExitFailed(false); useGame.getState().hide() }}>BACK TO CYBERSPACE</button>}
        </p>
      )}
    </div>
  )
}
