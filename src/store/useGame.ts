/**
 * useGame.ts - in-game mode (DECK-0002 §2.3): your own player inside a game
 * this client implements.
 *
 * ENTER publishes enter-virtual from where you stand, then the game's arrival,
 * a `teleport` to its start: you go there through the game, not across
 * cyberspace. While you are in, the game's world is drawn in place of
 * cyberspace (game/GameView.tsx), and a press moves you one gibson by the
 * game's own rules (lib/games/play.ts), on this device, signing nothing. A pad
 * signs a `teleport`. EXIT publishes exit-virtual, which puts you back where
 * you entered (spec §8.11.4 rule 2), and the view comes back exactly as it was
 * when you entered: the same place, zoom, look and mode (DECK-0002 §7).
 *
 * Every event goes through the store's own signing (useCyberspace enterGame,
 * signGameAction, exitGame), which confirms the head first and queues it like
 * a hop: LIVE drains it to the relays, LOCAL keeps it on this device.
 *
 * A chain whose head is inside a game this client implements, after a reload
 * or from another tab, can be gone back into (resume) or left (exit); the
 * chain alone says which game, from where, and the last game position on the
 * record.
 */

import { create } from 'zustand'
import { useCyberspace, type CyberspaceState } from './useCyberspace'
import { useWalk } from './useWalk'
import { openBracket, positionHex, type ActionEvent } from '../lib/events'
import { teleportTemplate } from '../lib/games/bracket'
import { gameFor } from '../lib/games/registry'
import { gamesEnabled } from '../lib/games/flag'
import { TUTORIAL_GAME } from '../lib/games/tutorialGame'
import { inRegion, stepIn, type WorldShard } from '../lib/games/play'
import { loadWorld } from '../lib/games/world'
import type { GameDef } from '../lib/games/types'
import type { AxisName, Position } from '../lib/space'

/** The view as it stood when you entered, put back when you leave (DECK-0002 §7). */
type ViewSnapshot = Pick<CyberspaceState, 'view' | 'scaleExp' | 'cursor' | 'anchor' | 'anchorPlane' | 'walking' | 'focus' | 'focusReturnScale'>

export interface GameSession {
  game: GameDef
  /** The enter-virtual that opened the bracket. */
  entryId: string
  /** Your game position (DECK-0002 §3): never a position in cyberspace. */
  at: Position
  /** The world's shards, null while they load. */
  world: WorldShard[] | null
  /** Why the world could not be read, if it could not. */
  worldError: string | null
  /** The view to come back to; null when the game was resumed, not entered, on this page. */
  snapshot: ViewSnapshot | null
}

export interface GameState {
  session: GameSession | null
  /** What is being signed now, if anything: nothing else is asked while it is. */
  busy: 'entering' | 'arriving' | 'teleporting' | 'exiting' | null
  /** The last thing worth saying: a refusal, or a record that did not get signed. */
  message: string | null
  /** Enter `game` from where you stand. Null when in, else the words it was refused with. */
  enter: (game: GameDef) => Promise<string | null>
  /** Back into the game whose bracket is open at your head (after a reload), signing nothing. */
  resume: () => boolean
  /** Leave the game: exit-virtual, and the view as it was. Null when out, else why not. */
  exit: () => Promise<string | null>
  /** One press: a gibson along `axis`, by the game's rules. */
  step: (axis: AxisName, dir: 1 | -1) => void
  /** Back to cyberspace's view with the game still open on your chain: only when leaving it cannot be signed. */
  hide: () => void
  clearMessage: () => void
}

/** Refusals of in-game mode itself, in words. */
export const GAMES_OFF_MESSAGE = 'Games are off on this device.'
export const WALK_BUSY_MESSAGE = 'Finish your walk first.'

function snapshotView(): ViewSnapshot {
  const s = useCyberspace.getState()
  return { view: s.view, scaleExp: s.scaleExp, cursor: { ...s.cursor }, anchor: { ...s.anchor }, anchorPlane: s.anchorPlane, walking: s.walking, focus: s.focus, focusReturnScale: s.focusReturnScale }
}

/** Whether WALK is still doing anything: a queued or open segment, a step in flight or a fall. */
function walkBusy(): boolean {
  const w = useWalk.getState()
  return w.queue.length > 0 || w.open !== null || w.running !== null || w.falling
}

/** The last game position on the record inside the bracket opened by `entry`: its newest `teleport` or `move` with a `C` (DECK-0002 §4). */
export function recordedPosition(chain: ActionEvent[], entry: ActionEvent, game: Pick<GameDef, 'region' | 'start'>): Position {
  const from = chain.indexOf(entry)
  for (let i = chain.length - 1; i > from; i--) {
    const a = chain[i]
    if (a.bracketId !== entry.id || a.role !== 'virtual' || (a.name !== 'teleport' && a.name !== 'move') || !a.declared) continue
    const p = a.declared.position
    if (a.declared.plane === game.region.plane && inRegion(game, p)) return { ...p }
  }
  return { ...game.start }
}

/** Your game position as the `C` of a game action. */
function hexAt(game: GameDef, p: Position): string {
  return positionHex(p, game.region.plane)
}

export const useGame = create<GameState>((set, get) => {
  /** Start reading the world of `session`'s game; lands only while that session stands. */
  const readWorld = (session: GameSession): void => {
    loadWorld(session.game).then(
      (world) => { if (get().session?.entryId === session.entryId) set({ session: { ...get().session!, world, worldError: world.length ? null : 'This game has no world yet.' } }) },
      (err) => { if (get().session?.entryId === session.entryId) set({ session: { ...get().session!, world: [], worldError: err instanceof Error ? err.message : String(err) } }) },
    )
  }

  /** Sign a teleport from `from` to `to` inside the open game; the game goes on either way (DECK-0002 §6), and a failed record is said. */
  const teleport = async (game: GameDef, to: Position, from: Position | null, busy: 'arriving' | 'teleporting'): Promise<void> => {
    set({ busy })
    const signed = await useCyberspace.getState().signGameAction(game, (links) => teleportTemplate({ ...links, toHex: hexAt(game, to), ...(from ? { fromHex: hexAt(game, from) } : {}) }))
    const now = get().session
    if (now && now.game.pubkey === game.pubkey) set({ session: { ...now, at: { ...to } } })
    set({ busy: null, message: 'refused' in signed ? `The teleport was not signed: ${signed.refused}` : null })
  }

  return {
    session: null,
    busy: null,
    message: null,

    enter: async (game) => {
      if (!gamesEnabled()) return GAMES_OFF_MESSAGE
      if (get().session || get().busy) return null
      if (walkBusy()) { set({ message: WALK_BUSY_MESSAGE }); return WALK_BUSY_MESSAGE }
      const snapshot = snapshotView()
      set({ busy: 'entering', message: null })
      const entered = await useCyberspace.getState().enterGame(game)
      if ('refused' in entered) { set({ busy: null, message: entered.refused }); return entered.refused }
      const session: GameSession = { game, entryId: entered.event.id, at: { ...game.start }, world: null, worldError: null, snapshot }
      set({ session })
      readWorld(session)
      // The arrival (DECK-0002 §2.2): through the game, to its start.
      await teleport(game, game.start, null, 'arriving')
      return null
    },

    resume: () => {
      if (get().session || get().busy) return false
      const chain = useCyberspace.getState().actions()
      const open = openBracket(chain)
      const game = gameFor(open?.game?.pubkey)
      if (!open || !game || !useCyberspace.getState().atHead()) return false
      const session: GameSession = { game, entryId: open.id, at: recordedPosition(chain, open, game), world: null, worldError: null, snapshot: null }
      set({ session, message: null })
      readWorld(session)
      return true
    },

    exit: async () => {
      const session = get().session
      if (get().busy) return null
      const game = session?.game ?? gameFor(openBracket(useCyberspace.getState().actions())?.game?.pubkey)
      if (!game) return null
      set({ busy: 'exiting', message: null })
      const left = await useCyberspace.getState().exitGame(session ? hexAt(game, session.at) : undefined)
      if ('refused' in left) { set({ busy: null, message: left.refused }); return left.refused }
      set({ session: null, busy: null })
      // The view you entered from, exactly (DECK-0002 §7). The base position
      // needs nothing: the exit's C is the entry's c, so you stand where you did.
      if (session?.snapshot) useCyberspace.setState({ ...session.snapshot })
      return null
    },

    step: (axis, dir) => {
      const { session, busy } = get()
      if (!session || busy || !session.world) return
      const r = stepIn(session.game, session.at, axis, dir, session.world)
      if (!r.moved) return
      set({ session: { ...session, at: r.at } })
      if (r.pad) void teleport(session.game, r.pad.to, r.at, 'teleporting')
    },

    hide: () => { if (!get().busy) set({ session: null }) },

    clearMessage: () => set({ message: null }),
  }
})

/**
 * THE ENTRY POINT for the first-arrival tutorial (Track A, step 10, DUNGEON):
 * enter the tutorial dungeon from where the player stands. Resolves to null
 * once they are in, or to the words it was refused with, for the tutorial to
 * show. Ask gamesEnabled() first: with games off it is refused.
 */
export function enterTutorialDungeon(): Promise<string | null> {
  return useGame.getState().enter(TUTORIAL_GAME)
}

export { gamesEnabled }

// The session follows the chain: a bracket closed elsewhere (another tab or
// device published the exit, a respawn, an identity switch) ends in-game mode.
useCyberspace.subscribe((s, prev) => {
  const session = useGame.getState().session
  if (!session) return
  if (s.identity.pubkey !== prev.identity.pubkey) { useGame.setState({ session: null, busy: null }); return }
  if (s.events === prev.events) return
  const open = openBracket(useCyberspace.getState().actions())
  if (open?.id !== session.entryId && useGame.getState().busy !== 'exiting') useGame.setState({ session: null, message: 'The game was left from another tab or device.' })
})

// DEV window handle, the house pattern (__store): the game session, for the LOCAL browser smoke (scripts/game-smoke.mjs).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __game?: unknown; __enterTutorialDungeon?: unknown }).__game = useGame
  ;(window as unknown as { __enterTutorialDungeon?: unknown }).__enterTutorialDungeon = enterTutorialDungeon
}
