/**
 * GameChip.tsx - IN A GAME, for a game ONOSENDAI plays (DECK-0002 §7).
 *
 * Your chain's head is inside a game this client implements, and the game is
 * not on screen: after a reload, from another tab, or after BACK TO
 * CYBERSPACE when leaving could not be signed. Tapping it goes back into the
 * game, where EXIT GAME is. A game this client once played but does not
 * play here now (the switch is off on this device, or its key was
 * replaced) is left with a tap instead, so no chain is ever stranded. A game played from another client keeps the IN A
 * GAME notice of the Proof chain panel, as before.
 */

import { useMemo } from 'react'
import { Gamepad2 } from 'lucide-react'
import { openBracket } from '../lib/events'
import { canLeave, gameFor } from '../lib/games/registry'
import { useCyberspace } from '../store/useCyberspace'
import { useGame } from '../store/useGame'

export function GameChip(): JSX.Element | null {
  const events = useCyberspace((s) => s.events)
  const atHead = useCyberspace((s) => s.atHead())
  const inMode = useGame((s) => s.session !== null)
  const open = useMemo(() => openBracket(useCyberspace.getState().actions()), [events])
  const game = gameFor(open?.game?.pubkey)
  const busy = useGame((s) => s.busy)
  if (!open || inMode || !atHead) return null
  // A game this client played but does not play now (games off here, or a key since replaced): it can still be left (registry canLeave).
  if (!game) {
    if (!canLeave(open.game?.pubkey) || busy) return null
    return (
      <button
        className="hyperbar hyperbar--game"
        onClick={() => { void useGame.getState().exit() }}
        title="You are in a game ONOSENDAI no longer plays here. Tap to leave it; you come back where you entered."
        aria-label="In a game. Tap to leave it."
      >
        <Gamepad2 size={14} strokeWidth={2.5} aria-hidden className="hyperbar__glyph" />
        <span className="hyperbar__text">
          <span className="hyperbar__label">IN A GAME</span>
          <span className="hyperbar__meta">TAP TO LEAVE</span>
        </span>
      </button>
    )
  }
  return (
    <button
      className="hyperbar hyperbar--game"
      onClick={() => useGame.getState().resume()}
      title="You are in a game. Tap to go back into it; EXIT GAME is there."
      aria-label={`In a game: ${game.name}. Tap to go back into it.`}
    >
      <Gamepad2 size={14} strokeWidth={2.5} aria-hidden className="hyperbar__glyph" />
      <span className="hyperbar__text">
        <span className="hyperbar__label">IN A GAME</span>
        <span className="hyperbar__meta">{game.name}</span>
      </span>
    </button>
  )
}
