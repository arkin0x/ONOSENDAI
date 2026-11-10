/**
 * GameChip.tsx - IN A GAME, for a game ONOSENDAI plays (DECK-0002 §7).
 *
 * Your chain's head is inside a game this client implements, and the game is
 * not on screen: after a reload, from another tab, or after BACK TO
 * CYBERSPACE when leaving could not be signed. Tapping it goes back into the
 * game, where EXIT GAME is. A game played from another client keeps the IN A
 * GAME notice of the Proof chain panel, as before.
 */

import { useMemo } from 'react'
import { Gamepad2 } from 'lucide-react'
import { openBracket } from '../lib/events'
import { gameFor } from '../lib/games/registry'
import { useCyberspace } from '../store/useCyberspace'
import { useGame } from '../store/useGame'

export function GameChip(): JSX.Element | null {
  const events = useCyberspace((s) => s.events)
  const atHead = useCyberspace((s) => s.atHead())
  const inMode = useGame((s) => s.session !== null || s.busy !== null)
  const game = useMemo(() => gameFor(openBracket(useCyberspace.getState().actions())?.game?.pubkey), [events])
  if (!game || inMode || !atHead) return null
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
