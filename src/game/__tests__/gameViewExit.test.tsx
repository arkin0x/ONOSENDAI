/**
 * gameViewExit.test.tsx - EXIT GAME on the game's bar (DECK-0002 §2.3):
 * leaving is offered at every moment of play, so the button is pressable
 * while a pad's teleport is being signed, and held only while an exit is
 * already on its way. Rendered to a string; the world is not read yet, so
 * no canvas is drawn.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { GameView } from '../GameView'
import { useGame, type GameSession } from '../../store/useGame'
import { TUTORIAL_GAME } from '../../lib/games/tutorialGame'
import { startProgress } from '../../lib/games/progress'

function session(over: Partial<GameSession> = {}): GameSession {
  return {
    game: TUTORIAL_GAME, entryId: 'ab'.repeat(32), at: null, resumeAt: null, world: null, door: null, keyBag: 'unread', keys: [],
    room: null, worldError: null, snapshot: null, arc: null, doubled: false, progress: startProgress(0), ...over,
  }
}

/** The screen as the store stands: a server render reads the initial state, so it is brought up to date first (the house pattern). */
function render(): string {
  Object.assign(useGame.getInitialState(), useGame.getState())
  return renderToStaticMarkup(<GameView />)
}

/** Every EXIT GAME button drawn, as its opening tag. */
function exitButtons(): string[] {
  const html = render()
  return [...html.matchAll(/<button[^>]*>EXIT GAME<\/button>/g)].map((m) => m[0])
}

beforeEach(() => { useGame.setState({ session: null, busy: null, message: null }) })
afterEach(() => { useGame.setState({ session: null, busy: null, message: null }); Object.assign(useGame.getInitialState(), useGame.getState()) })

describe('EXIT GAME is offered at every moment of play', () => {
  it('is pressable while a teleport is being signed', () => {
    useGame.setState({ session: session(), busy: 'teleporting' })
    expect(render()).toContain('TELEPORTING')
    const buttons = exitButtons()
    expect(buttons).toHaveLength(1)
    expect(buttons[0]).not.toContain('disabled')
  })

  it('is pressable with nothing being signed, and on the clear card while a teleport is', () => {
    useGame.setState({ session: session(), busy: null })
    expect(exitButtons()[0]).not.toContain('disabled')
    useGame.setState({ session: session({ progress: { ...startProgress(0), clearedMs: 1234 } }), busy: 'teleporting' })
    const buttons = exitButtons()
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b).not.toContain('disabled')
  })

  it('is held only while the exit itself is on its way', () => {
    useGame.setState({ session: session({ progress: { ...startProgress(0), clearedMs: 1234 } }), busy: 'exiting' })
    const buttons = exitButtons()
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b).toContain('disabled')
  })
})
