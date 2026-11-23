/**
 * useGame.ts - in-game mode (DECK-0002 §2.3): your own player inside a game
 * this client implements.
 *
 * ENTER publishes enter-virtual from where you stand, and nothing else: you
 * appear at the game's entry point by virtue of entering (DECK-0002 §2.2,
 * owner's ruling 2026-11-10), the `C` of the world item with the `entry` tag,
 * while your position in cyberspace stays where you entered from. While you
 * are in, the game defines every action (§2.3). The tutorial dungeon's are
 * its own choice, not the DECK's: the game's world is drawn in place of
 * cyberspace (game/GameView.tsx), a press moves you one gibson by its rules
 * (lib/games/play.ts) on this device, signing nothing, and a pad signs a
 * `teleport`. In a game with gravity, JUMP jumps and a tick on every frame
 * carries the fall (lib/games/gravity.ts); TAKE and OPEN are the key door;
 * the clock runs from the entry to the exit zone (lib/games/progress.ts). All
 * of that is the game's logic, kept on this device: nothing is signed for it.
 * In a world whose gate is a DECK-0004 door (lib/games/keyDoor.ts), the key is
 * a real key item: reaching its bag's region opens the bag, TAKE holds it in
 * ITEMS (store/useInventory, on this device, nothing published), and OPEN
 * opens the door with it and reads its room. The LEGACY world, with no door,
 * keeps the game-only key and gate.
 * Its run is not anchored (DECK-0002 §6.2, play kept on the device): its steps are not events anyone
 * keeps, so an anchor would commit to nothing checkable. EXIT publishes exit-virtual, which puts you back where
 * you entered (spec §8.11.4 rule 2), and the view comes back exactly as it was
 * when you entered: the same place, zoom, look and mode (DECK-0002 §7).
 *
 * Every event goes through the store's own signing (useCyberspace enterGame,
 * signGameAction, exitGame), which confirms the head first and queues it like
 * a hop: LIVE drains it to the relays, LOCAL keeps it on this device.
 *
 * A chain whose head is inside a game this client implements, after a reload
 * or from another tab, can be gone back into (resume) or left (exit); the
 * chain alone says which game and from where; you are shown at the last game
 * position on the record, or at the entry point when there is none.
 */

import { create } from 'zustand'
import { gameEventRefusal, useCyberspace, whyNoMove, type CyberspaceState } from './useCyberspace'
import { useWalk } from './useWalk'
import { openBracket, positionHex, type ActionEvent } from '../lib/events'
import { teleportTemplate } from '../lib/games/bracket'
import { canLeave, gameFor } from '../lib/games/registry'
import { useWorkshop } from './useWorkshop'
import { tvIsOn } from './tvOn'
import { gameEnabled, gamesEnabled } from '../lib/games/flag'
import { TUTORIAL_GAME } from '../lib/games/tutorialGame'
import { inRegion, padUnder, stepIn, type WorldShard } from '../lib/games/play'
import { jump as jumpBody, move as moveBody, tick as tickBody, type Arc, type Body } from '../lib/games/gravity'
import { DOOR_REACH, KEY_REACH, offerHere, openDoor, reachExit, startProgress, takeKey, within, type Offer, type Progress } from '../lib/games/progress'
import { doorKey, doorSecretWith, inKeyBag, keyItemHeld, readKeyBag, readRoom, sceneNow, thingsNow } from '../lib/games/keyDoor'
import { loadWorld } from '../lib/games/world'
import { useInventory } from './useInventory'
import type { Hidden } from '../lib/hidden'
import type { HeldItem } from '../lib/inventory'
import { noteFoundGame } from '../lib/games/discovered'
import type { GameDef } from '../lib/games/types'
import type { AxisName, Position } from '../lib/space'

/** The view as it stood when you entered, put back when you leave (DECK-0002 §7). */
type ViewSnapshot = Pick<CyberspaceState, 'view' | 'scaleExp' | 'cursor' | 'anchor' | 'anchorPlane' | 'walking' | 'focus' | 'focusReturnScale'>

export interface GameSession {
  game: GameDef
  /** The enter-virtual that opened the bracket. */
  entryId: string
  /** Your game position (DECK-0002 §3): never a position in cyberspace. Null until the world is read, which says where the entry point is. */
  at: Position | null
  /** Where a resumed session puts you once the world is read: the last game position on the record (recordedPosition); null for the entry point. */
  resumeAt: Position | null
  /** The world's shards, null while they load. */
  world: WorldShard[] | null
  /** The world's DECK-0004 door, or null: no door is the LEGACY world (game-only key and gate). */
  door: Hidden | null
  /** The key bag (GameDef keyBag): not read yet, being read, read, or failed (read again once you leave its region and come back). */
  keyBag: 'unread' | 'reading' | 'read' | 'failed'
  /** The key items the key bag revealed. */
  keys: Hidden[]
  /** The door's room once opened and read: its shards. Null until then. */
  room: WorldShard[] | null
  /** Why the world could not be read, if it could not. */
  worldError: string | null
  /** The view to come back to; null when the game was resumed, not entered, on this page. */
  snapshot: ViewSnapshot | null
  /** In the air under gravity: the arc you follow. Null while standing, and always in a game without gravity. */
  arc: Arc | null
  /** The double jump is spent for this time in the air. */
  doubled: boolean
  /** The key, the door and the clock. */
  progress: Progress
}

export interface GameState {
  session: GameSession | null
  /** What is being signed now, if anything: nothing else is asked while it is, except leaving (exit), which always is. */
  busy: 'entering' | 'teleporting' | 'exiting' | null
  /** The last thing worth saying: a refusal, or a record that did not get signed. */
  message: string | null
  /** Enter `game` from where you stand. Null when in, else the words it was refused with. */
  enter: (game: GameDef) => Promise<string | null>  // null only once you are in
  /** Back into the game whose bracket is open at your head (after a reload), signing nothing. */
  resume: () => boolean
  /**
   * Leave the game: exit-virtual, and the view as it was. Null when out, else why not. Offered at every moment of
   * play (DECK-0002 §2.3): pressed while a teleport is being signed, it waits for that one and then follows it on the
   * chain; pressed while entering, it calls the entry off (left at once if the entry got signed meanwhile).
   */
  exit: () => Promise<string | null>
  /** One press: a gibson along `axis`, by the game's rules. Under gravity only X and Z: Y is the fall's. */
  step: (axis: AxisName, dir: 1 | -1, now?: number) => void
  /** JUMP, in a game with gravity: off the floor, or the double jump in the air. */
  jump: (now?: number) => void
  /** The fall and the jump brought up to `now` (performance.now()): called every frame while you play. */
  tick: (now?: number) => void
  /** TAKE the key, within reach: into ITEMS for a real key item, into hand for the LEGACY one. */
  take: () => void
  /** OPEN the door, with the key, within reach. */
  open: () => void
  /** Back to cyberspace's view with the game still open on your chain: only when leaving it cannot be signed. */
  hide: () => void
  clearMessage: () => void
}

/** Refusals of in-game mode itself, in words. */
export const GAMES_OFF_MESSAGE = 'Games are off on this device.'
export const WALK_BUSY_MESSAGE = 'Finish your walk first.'
export const GAME_NOT_HERE_MESSAGE = 'This game is not one ONOSENDAI plays.'
export const GAME_ALREADY_MESSAGE = 'A game is already open, or on its way.'
export const COVERED_MESSAGE = 'Close the workshop or TV first.'
/** What ENTER comes to when EXIT called it off before the game opened. */
export const ENTER_CANCELLED_MESSAGE = 'You left before the game opened.'
/** An EXIT that waited on a teleport while the identity changed: nothing is signed on the other identity's chain. */
export const EXIT_STOPPED_MESSAGE = 'The exit was not signed: your identity changed meanwhile.'
/** The bracket was closed from somewhere else (another tab or device): in-game mode ends. */
const LEFT_ELSEWHERE_MESSAGE = 'Your chain is no longer in this game: it was left, or changed, from another tab or device.'
/** The key bag held no key when read: said, never shown as a platform with nothing on it. */
export const KEY_BAG_MISSING_MESSAGE = 'The key could not be found here yet. Step off the platform and back on to look again.'
/** Something threw where a refusal was expected: said, never left hanging (review of #660). */
const failed = (err: unknown): string => `Something went wrong: ${err instanceof Error ? err.message : String(err)}`

function snapshotView(): ViewSnapshot {
  const s = useCyberspace.getState()
  return { view: s.view, scaleExp: s.scaleExp, cursor: { ...s.cursor }, anchor: { ...s.anchor }, anchorPlane: s.anchorPlane, walking: s.walking, focus: s.focus, focusReturnScale: s.focusReturnScale }
}

/** Whether WALK is still doing anything: a queued or open segment, a step in flight or a fall. */
function walkBusy(): boolean {
  const w = useWalk.getState()
  return w.queue.length > 0 || w.open !== null || w.running !== null || w.falling
}

/** The last game position on the record inside the bracket opened by `entry`: its newest `teleport` or `move` with a `C` (DECK-0002 §4), or null when there is none (you are at the entry point). */
export function recordedPosition(chain: ActionEvent[], entry: ActionEvent, game: Pick<GameDef, 'region'>): Position | null {
  const from = chain.indexOf(entry)
  for (let i = chain.length - 1; i > from; i--) {
    const a = chain[i]
    if (a.bracketId !== entry.id || a.role !== 'virtual' || (a.name !== 'teleport' && a.name !== 'move') || !a.declared) continue
    const p = a.declared.position
    if (a.declared.plane === game.region.plane && inRegion(game, p)) return { ...p }
  }
  return null
}

/** The player as gravity sees them, once placed. */
function bodyOf(s: GameSession, at: Position): Body {
  return { at, arc: s.arc, doubled: s.doubled }
}

/** Your game position as the `C` of a game action. */
function hexAt(game: GameDef, p: Position): string {
  return positionHex(p, game.region.plane)
}

/** Where an entry's progress is kept on this device, so a reload keeps the key, the door and the clock. */
const progressKey = (entryId: string): string => `onosendai:game:${entryId}`

/** The progress kept for `entryId`, if any and well formed. */
export function loadProgress(entryId: string): Progress | null {
  try {
    const raw = JSON.parse(localStorage.getItem(progressKey(entryId)) ?? 'null') as Partial<Progress> | null
    if (!raw || typeof raw.startedAt !== 'number' || !Number.isFinite(raw.startedAt)) return null
    return { startedAt: raw.startedAt, keyHeld: raw.keyHeld === true, doorOpen: raw.doorOpen === true, clearedMs: typeof raw.clearedMs === 'number' && Number.isFinite(raw.clearedMs) ? raw.clearedMs : null, ...(typeof raw.doorId === 'string' ? { doorId: raw.doorId } : {}) }
  } catch { return null }
}

function saveProgress(entryId: string, pr: Progress | null): void {
  try {
    if (pr) localStorage.setItem(progressKey(entryId), JSON.stringify(pr))
    else localStorage.removeItem(progressKey(entryId))
  } catch { /* no storage: the progress lives as long as the page */ }
}

/** The world's walls as they stand: the door open or shut (its room with it), the LEGACY key gone or not. */
function solidOf(session: GameSession): WorldShard[] {
  return session.world ? sceneNow(session.game, { shards: session.world, door: session.door, room: session.room }, session.progress).solid : []
}

/** Who is playing: whose ITEMS hold the key. */
const me = (): string => useCyberspace.getState().identity.pubkey

/**
 * What a tap would do where you stand in `session`, if anything: the one
 * button shown (TAKE, OPEN or LOCKED). A real key item counts as held once
 * it is in this identity's ITEMS (lib/games/keyDoor.ts thingsNow).
 */
export function offerFor(session: GameSession, items: Record<string, HeldItem> = useInventory.getState().items): Offer {
  if (!session.at) return null
  return offerHere(thingsNow(session.game, session, session.progress, items, me()), session.progress, session.at)
}

/** Whether the door would open for what this identity holds: a held key item for a door, the LEGACY key in hand otherwise. */
export function holdsDoorKey(session: GameSession, items: Record<string, HeldItem> = useInventory.getState().items): boolean {
  return session.door ? doorKey(session.door, items, me()) !== null : session.progress.keyHeld
}

/** Physics clock: performance.now(), monotonic. */
const perfNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export const useGame = create<GameState>((set, get) => {
  /**
   * The entry or teleport being signed now, until it settles. EXIT waits on it (settled, never on how): the exit is
   * signed only after it, so it follows the last game event on the chain instead of racing it for the same previous.
   */
  let inFlight: Promise<unknown> | null = null
  const settled = (): Promise<unknown> | undefined => inFlight?.then(undefined, () => undefined)
  /** The entry being signed now: EXIT marks it called off, and it is left at once if it got signed. One per ENTER. */
  let entering: { cancelled: boolean } | null = null
  /** Note `p` as the sign in flight until it settles. */
  const track = <T,>(p: Promise<T>): Promise<T> => {
    inFlight = p
    const clear = (): void => { if (inFlight === p) inFlight = null }
    p.then(clear, clear)
    return p
  }

  /** Put `next` in place of the session it was made from, if that session still stands, keeping its progress on this device. */
  const commit = (next: GameSession): void => {
    if (get().session?.entryId !== next.entryId) return
    const progress = next.at ? reachExit(next.game, next.progress, next.at, Date.now()) : next.progress
    const session = progress === next.progress ? next : { ...next, progress }
    if (session.progress !== get().session?.progress) saveProgress(session.entryId, session.progress)
    set({ session })
    reveal(session)
  }

  /**
   * The key bag, opened once you stand in its region (lib/games/keyDoor.ts
   * readKeyBag): its key derived here, the work of being there. Only in a world
   * with a door; once per session, and again after a failure only once you have
   * left the region and come back.
   */
  const reveal = (session: GameSession): void => {
    if (!session.door || !session.at || !session.world || session.worldError) return
    const inside = inKeyBag(session.game, session.at)
    if (session.keyBag === 'failed' && !inside) { set({ session: { ...session, keyBag: 'unread' } }); return }
    if (session.keyBag !== 'unread' || !inside) return
    set({ session: { ...session, keyBag: 'reading' } })
    readKeyBag(session.game).then(
      (keys) => {
        const now = get().session
        if (now?.entryId !== session.entryId) return
        // No bag, or no key in it: a relay that did not answer, or a bag not yet up. Said, and asked again once you step out and back.
        if (keys.length === 0) set({ session: { ...now, keyBag: 'failed' }, message: KEY_BAG_MISSING_MESSAGE })
        else set({ session: { ...now, keys, keyBag: 'read' } })
      },
      (err) => { const now = get().session; if (now?.entryId === session.entryId) set({ session: { ...now, keyBag: 'failed' }, message: `The key's place could not be read: ${err instanceof Error ? err.message : String(err)}` }) },
    )
  }

  /** The door's room, read with its secret, landing only in the session of the entry it was opened in (lib/games/keyDoor.ts readRoom). */
  const fillRoom = (session: GameSession, door: Hidden, secretHex: string): void => {
    readRoom(session.game, door, secretHex).then(
      (room) => {
        const now = get().session
        if (now?.entryId !== session.entryId) return
        // A room whose bag is not found is said, not shown as an empty room (DECK-0004 §3.7.3).
        set({ session: { ...now, room: room.shards }, ...(room.found ? {} : { message: 'The room behind the gate could not be retrieved.' }) })
      },
      (err) => { if (get().session?.entryId === session.entryId) set({ message: `The room behind the gate could not be read: ${err instanceof Error ? err.message : String(err)}` }) },
    )
  }

  /** A run that opened the door before a reload: its room read again with the key still held, or said that it cannot be. */
  const refillRoom = (session: GameSession): void => {
    if (!session.door || !session.progress.doorOpen || session.room) return
    const key = doorKey(session.door, useInventory.getState().items, me())
    const secret = key && doorSecretWith(session.door, key)
    if (secret) fillRoom(session, session.door, secret)
    // Said only once ITEMS has loaded: before that the key may be on its way from this device's storage.
    else if (useInventory.getState().storage !== 'loading') set({ message: 'The room behind the gate could not be read: its key is not in your ITEMS.' })
  }

  /** After a move or a landing: a pad under a player who stands on it sends them on. */
  const onPad = (session: GameSession): void => {
    if (session.arc || !session.at) return
    const pad = padUnder(session.game, session.at)
    if (pad) void teleport(session.game, session.entryId, pad.to, session.at, 'teleporting')
  }

  /** Start reading the world of `session`'s game; lands only while that session stands. */
  const readWorld = (session: GameSession): void => {
    loadWorld(session.game).then(
      // You appear at the entry point by virtue of having entered (DECK-0002 §2.2), or where the record left you.
      (world) => {
        const now = get().session
        if (now?.entryId !== session.entryId) return
        // The gate kept open from this entry counts only for the gate it was opened on: progress kept from the other world
        // (the world switched between a reload and the next) starts shut, so no gate stands open that its key did not open.
        const progress = now.progress.doorOpen && (now.progress.doorId ?? null) !== (world.door?.eventId ?? null) ? { ...now.progress, doorOpen: false, doorId: undefined } : now.progress
        const next: GameSession = { ...now, progress, world: world.shards, door: world.door, at: now.at ?? now.resumeAt ?? world.entry, worldError: world.shards.length ? null : 'This game has no world yet.' }
        if (progress !== now.progress) saveProgress(next.entryId, progress)
        set({ session: next })
        reveal(next)
        refillRoom(next)
      },
      // No world: a resumed player is still drawn where the record left them; nobody moves without walls (step).
      (err) => { const now = get().session; if (now?.entryId === session.entryId) set({ session: { ...now, world: [], at: now.at ?? now.resumeAt, worldError: err instanceof Error ? err.message : String(err) } }) },
    )
  }

  /** Sign a pad's teleport from `from` to `to` inside the open game; the tutorial game goes on either way (its own choice), and a failed record is said. */
  const teleport = (game: GameDef, entryId: string, to: Position, from: Position, busy: 'teleporting'): Promise<void> => {
    set({ busy })
    return track(signTeleport(game, entryId, to, from))
  }

  const signTeleport = async (game: GameDef, entryId: string, to: Position, from: Position): Promise<void> => {
    let note: string | null = null
    try {
      const signed = await useCyberspace.getState().signGameAction(game, entryId, (links) => teleportTemplate({ ...links, toHex: hexAt(game, to), fromHex: hexAt(game, from) }))
      if ('refused' in signed) note = `The teleport was not signed: ${signed.refused}`
    } catch (err) {
      note = `The teleport was not signed: ${failed(err)}`
    } finally {
      // Only for the session it was signed in: one that ended meanwhile (an exit elsewhere, an identity switch) hears nothing of it.
      // An EXIT pressed meanwhile (busy 'exiting') goes on from here: busy stays its, and its own words come next.
      const leaving = get().busy === 'exiting'
      const now = get().session
      if (now && now.entryId === entryId) { commit({ ...now, at: { ...to }, arc: null, doubled: false }); if (!leaving) set({ message: note }) }
      if (!leaving) set({ busy: null })
    }
  }

  /** Sign the entry into `game`, then open in-game mode, or leave at once when EXIT called the entry off meanwhile. */
  const signEnter = async (game: GameDef, snapshot: ViewSnapshot, ticket: { cancelled: boolean }): Promise<string | null> => {
    const refuse = (why: string): string => { set({ message: why }); return why }
    let entryId: string
    try {
      const entered = await useCyberspace.getState().enterGame(game)
      if ('refused' in entered) { set({ busy: null }); return ticket.cancelled ? ENTER_CANCELLED_MESSAGE : refuse(entered.refused) }
      entryId = entered.event.id
    } catch (err) {
      set({ busy: null })
      return ticket.cancelled ? ENTER_CANCELLED_MESSAGE : refuse(failed(err))
    }
    let stillIn: string | null = null
    if (ticket.cancelled) {
      // Called off, but signed meanwhile: the bracket is open, so it is closed at once, the exit naming this entry as
      // its previous (spec §8.11.3). Nothing was shown, so there is no view to put back.
      set({ busy: 'exiting' })
      let left: Awaited<ReturnType<CyberspaceState['exitGame']>>
      try {
        left = await useCyberspace.getState().exitGame(entryId)
      } catch (err) {
        left = { refused: failed(err) }
      }
      if (!('refused' in left)) { set({ busy: null }); return ENTER_CANCELLED_MESSAGE }
      // Not left: in, then, with EXIT GAME on screen to try again, and why it did not go said there.
      stillIn = left.refused
    }
    // No arrival is signed: entering is the arrival (DECK-0002 §2.2). The world says where the entry point is.
    // The clock starts now, at the entry (lib/games/progress.ts).
    const progress = startProgress(Date.now())
    saveProgress(entryId, progress)
    const session: GameSession = { game, entryId, at: null, resumeAt: null, world: null, door: null, keyBag: 'unread', keys: [], room: null, worldError: null, snapshot, arc: null, doubled: false, progress }
    set({ session, busy: null, ...(stillIn ? { message: stillIn } : {}) })
    // Found, for the GAMES panel (lib/games/discovered.ts): kept past a respawn, which forgets the chain.
    noteFoundGame(useCyberspace.getState().identity.pubkey, game.pubkey)
    readWorld(session)
    return null
  }

  return {
    session: null,
    busy: null,
    message: null,

    enter: async (game) => {
      if (!gameEnabled(game)) return GAMES_OFF_MESSAGE
      if (get().session || get().busy) return GAME_ALREADY_MESSAGE
      const refuse = (why: string): string => { set({ message: why }); return why }
      if (walkBusy()) return refuse(WALK_BUSY_MESSAGE)
      if (useWorkshop.getState().open || tvIsOn()) return refuse(COVERED_MESSAGE)
      const snapshot = snapshotView()
      set({ busy: 'entering', message: null })
      const ticket = { cancelled: false }
      entering = ticket
      return track(signEnter(game, snapshot, ticket).finally(() => { if (entering === ticket) entering = null }))
    },

    resume: () => {
      if (get().session || get().busy) return false
      const chain = useCyberspace.getState().actions()
      const open = openBracket(chain)
      const game = gameFor(open?.game?.pubkey)
      if (!open || !game || !useCyberspace.getState().atHead()) return false
      // The clock goes on from the entry: kept on this device, or the entry's own time when this device never saw it.
      const progress = loadProgress(open.id) ?? startProgress(open.createdAt * 1000)
      const session: GameSession = { game, entryId: open.id, at: null, resumeAt: recordedPosition(chain, open, game), world: null, door: null, keyBag: 'unread', keys: [], room: null, worldError: null, snapshot: null, arc: null, doubled: false, progress }
      set({ session, message: null })
      noteFoundGame(useCyberspace.getState().identity.pubkey, game.pubkey)
      readWorld(session)
      return true
    },

    exit: async () => {
      const busy = get().busy
      if (busy === 'exiting') return GAME_ALREADY_MESSAGE
      if (busy === 'entering') {
        // Nothing to leave yet: the entry is called off, and left at once should it get signed meanwhile (signEnter).
        if (entering) entering.cancelled = true
        await settled()
        return get().session ? get().message ?? GAME_ALREADY_MESSAGE : null
      }
      if (busy === 'teleporting') {
        // Leaving always goes (DECK-0002 §2.3), but after the teleport being signed: the exit then follows the last
        // game event on the chain, never a second event naming the same previous (spec §8.11.3).
        const who = useCyberspace.getState().identity.pubkey
        set({ busy: 'exiting', message: null })
        await settled()
        // The identity switched meanwhile (which ends in-game mode): the exit pressed was for the other one's chain.
        if (get().busy !== 'exiting' || useCyberspace.getState().identity.pubkey !== who) return EXIT_STOPPED_MESSAGE
      }
      const session = get().session
      // A game played here, or one this client ever played: never stranded by the switch (registry canLeave).
      const open = openBracket(useCyberspace.getState().actions())
      if (!session && !canLeave(open?.game?.pubkey)) { if (get().busy === 'exiting') set({ busy: null }); return GAME_NOT_HERE_MESSAGE }
      set({ busy: 'exiting', message: null })
      // The last game position, written in the exit's free `c` (DECK-0002 §7): where you are, or, left without going back
      // in (after a reload), the last one on the record of a game played here (review of #697).
      const game = session?.game ?? gameFor(open?.game?.pubkey)
      const lastAt = session ? (session.at ?? session.resumeAt) : open && game ? recordedPosition(useCyberspace.getState().actions(), open, game) : null
      const entryId = session?.entryId ?? open?.id
      let left: Awaited<ReturnType<CyberspaceState['exitGame']>>
      try {
        left = await useCyberspace.getState().exitGame(entryId, lastAt && game ? hexAt(game, lastAt) : undefined)
      } catch (err) {
        left = { refused: failed(err) }
      }
      if ('refused' in left) {
        // Refused because the bracket is no longer open at all (closed from another tab or device while this exit
        // waited): in-game mode ends, as the chain's own watch would have ended it had no exit been on its way.
        if (session && openBracket(useCyberspace.getState().actions())?.id !== session.entryId) {
          saveProgress(session.entryId, null)
          set({ session: null, busy: null, message: LEFT_ELSEWHERE_MESSAGE })
          return LEFT_ELSEWHERE_MESSAGE
        }
        set({ busy: null, message: left.refused })
        return left.refused
      }
      set({ session: null, busy: null })
      // That bracket is over: its key, gate and clock are of no more use here.
      if (entryId) saveProgress(entryId, null)
      // The view you entered from, exactly (DECK-0002 §7). The base position
      // needs nothing: the exit's C is the entry's c, so you stand where you did.
      if (session?.snapshot) useCyberspace.setState({ ...session.snapshot })
      return null
    },

    step: (axis, dir, now = perfNow()) => {
      const { session, busy } = get()
      // No world, or one that could not be read: no walls are known, so nobody moves.
      if (!session || busy || !session.world || session.worldError || !session.at || session.progress.clearedMs !== null) return
      const solid = solidOf(session)
      if (session.game.gravity) {
        if (axis === 'y') return
        const before = bodyOf(session, session.at)
        const body = moveBody(session.game, before, axis, dir, now, solid)
        if (body === before) return
        const next = { ...session, ...body }
        commit(next)
        onPad(next)
        return
      }
      const r = stepIn(session.game, session.at, axis, dir, solid)
      if (!r.moved) return
      commit({ ...session, at: r.at })
      if (r.pad) void teleport(session.game, session.entryId, r.pad.to, r.at, 'teleporting')
    },

    jump: (now = perfNow()) => {
      const { session, busy } = get()
      if (!session || busy || !session.game.gravity || !session.world || session.worldError || session.progress.clearedMs !== null) return
      if (!session.at) return
      const before = bodyOf(session, session.at)
      const body = jumpBody(session.game, before, now, solidOf(session))
      if (body !== before) commit({ ...session, ...body })
    },

    tick: (now = perfNow()) => {
      const { session, busy } = get()
      if (!session || busy || !session.game.gravity || !session.world || session.worldError || !session.at) return
      const { body, landed } = tickBody(session.game, bodyOf(session, session.at), now, solidOf(session))
      if (body.at === session.at && body.arc === session.arc) return
      const next = { ...session, ...body }
      commit(next)
      if (landed) onPad(next)
    },

    take: () => {
      const session = get().session
      if (!session?.at || get().busy) return
      if (!session.door) {
        // LEGACY: the game-only key into hand.
        const progress = takeKey(session.game, session.progress, session.at)
        if (progress) commit({ ...session, progress })
        return
      }
      if (session.progress.clearedMs !== null) return
      // A real key item: held like any other found key, into ITEMS, on this device. Nothing is published.
      const items = useInventory.getState().items
      const here = session.at
      const key = session.keys.find((k) => !keyItemHeld(items, k) && within(here, k.at, KEY_REACH))
      if (key) useInventory.getState().holdFinds([key])
    },

    open: () => {
      const session = get().session
      if (!session?.at || get().busy) return
      if (!session.door) {
        // LEGACY: the game-only gate, with the key in hand.
        const progress = openDoor(session.game, session.progress, session.at)
        if (progress) commit({ ...session, progress })
        return
      }
      const door = session.door
      if (session.progress.doorOpen || session.progress.clearedMs !== null || !within(session.at, door.at, DOOR_REACH)) return
      // The door, opened as any door is (DECK-0004 §3.7.3): its secret read with the held key item that is its lock.
      const key = doorKey(door, useInventory.getState().items, me())
      if (!key) return
      const secret = doorSecretWith(door, key)
      if (!secret) { set({ message: 'That key does not open this gate.' }); return }
      // Open at once; the room comes after, so no relay holds up the gate (store/rooms.ts openDoorNow, the same order).
      commit({ ...session, progress: { ...session.progress, doorOpen: true, doorId: door.eventId } })
      fillRoom(session, door, secret)
    },

    hide: () => { if (!get().busy) set({ session: null }) },

    clearMessage: () => set({ message: null }),
  }
})

/**
 * Why no game can be entered right now, whatever the game, or null: the
 * refusals of enter and of the chain (useCyberspace gameEventRefusal,
 * whyNoMove: away from your head, riding hyperspace, a move landing, a chain
 * that cannot move, already in a game), asked without signing anything. The
 * GAMES panel greys ENTER out by it (and by the tour, which it reads itself).
 */
export function enterBlocked(): string | null {
  const g = useGame.getState()
  if (g.session || g.busy) return GAME_ALREADY_MESSAGE
  if (walkBusy()) return WALK_BUSY_MESSAGE
  if (useWorkshop.getState().open || tvIsOn()) return COVERED_MESSAGE
  const cs = useCyberspace.getState()
  return gameEventRefusal(cs) ?? whyNoMove(cs.actions())
}

/**
 * THE ENTRY POINT for the first-arrival tutorial (Track A, step 10, DUNGEON):
 * enter the tutorial dungeon from where the player stands. Resolves to null
 * once they are in, or to the words it was refused with, for the tutorial to
 * show. Ask tutorialDungeonEnabled() first: with the game off it is refused.
 */
export function enterTutorialDungeon(): Promise<string | null> {
  return useGame.getState().enter(TUTORIAL_GAME)
}

/** Whether the tutorial dungeon is on here: everywhere once its key is the owner's, else by this device's switch (lib/games/flag.ts). */
export function tutorialDungeonEnabled(): boolean {
  return gameEnabled(TUTORIAL_GAME)
}

export { gamesEnabled }

// The session follows the chain: a bracket closed elsewhere (another tab or
// device published the exit, a respawn, an identity switch) ends in-game mode.
useCyberspace.subscribe((s, prev) => {
  const session = useGame.getState().session
  if (!session) return
  if (s.identity.pubkey !== prev.identity.pubkey) { useGame.setState({ session: null, busy: null, message: null }); return }
  if (s.events === prev.events) return
  const open = openBracket(useCyberspace.getState().actions())
  if (open?.id === session.entryId || useGame.getState().busy === 'exiting') return
  const respawned = s.genesisId !== prev.genesisId
  // That bracket is over, so its key, gate and clock are of no more use here (review of #668). An identity switch, above,
  // keeps them: that identity's game can still be gone back into.
  saveProgress(session.entryId, null)
  useGame.setState({ session: null, message: respawned ? 'Your respawn left the game.' : LEFT_ELSEWHERE_MESSAGE })
})

// DEV window handle, the house pattern (__store): the game session, for the LOCAL browser smoke (scripts/game-smoke.mjs).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __game?: unknown; __enterTutorialDungeon?: unknown }).__game = useGame
  ;(window as unknown as { __enterTutorialDungeon?: unknown }).__enterTutorialDungeon = enterTutorialDungeon
}
