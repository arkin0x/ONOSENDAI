/**
 * dungeon.ts - the tutorial's DUNGEON choice (Track C, step C4): PLAY THE
 * DUNGEON on the final card enters the tutorial dungeon (DECK-0002) from
 * where the player stands.
 *
 * Offered only with the tutorial dungeon on (useGame tutorialDungeonEnabled):
 * everywhere once its key is the owner's, else by this device's ?games=1,
 * never on the production host while the game is a placeholder
 * (lib/games/flag.ts). With it off nothing is registered and the card does
 * not offer DUNGEON.
 *
 * The card waits while the entry publishes and goes away once the game is on
 * screen. A refusal stays on the card in plain words: game mode's and the
 * chain's refusals are written for the player already (finish your walk,
 * wait for your move to land, RELOAD) and are shown as they are; only a raw
 * error (a signer's or relay's own words, wrapped as "Signing failed:" or
 * "Something went wrong:") is said as DUNGEON_FAILED_MESSAGE, and left in
 * full in the console.
 *
 * Leaving brings the tutorial back (owner, 2026-11-13: "if you quit the game
 * early, you don't go back to the tutorial menu"): a dungeon entered from the
 * card is noted, by its entry, for the identity that entered it (kept on this
 * device, so a reload in the game still counts), and EXIT GAME on it puts the
 * "Where next?" card up again, as the other routes come back to it. DUNGEON is
 * checked off only if the player cleared it; left early, it stays unchecked
 * so they can try again. A dungeon entered any other way is left as before.
 */

import { enterTutorialDungeon, loadProgress, tutorialDungeonEnabled, useGame } from '../store/useGame'
import { choiceOffered, registerTutorialChoice, useTutorial } from '../store/useTutorial'
import { noteFoundGame } from '../lib/games/discovered'
import { TUTORIAL_GAME } from '../lib/games/tutorialGame'
import { useCyberspace } from '../store/useCyberspace'
import { readProgress, tutorialOn, writeProgress } from './gate'

/** The `when` the script's dungeon choice names (tutorial/script.ts CHOICE). */
export const DUNGEON_CHOICE = 'dungeon'
export const DUNGEON_FAILED_MESSAGE = 'The dungeon did not open. Try again.'

/** A raw error, not a refusal written for the player (lib/signWithin.ts signingFailed, useGame failed). */
const RAW_ERROR = /^(Signing failed|Something went wrong):/

/** What the card says for a refusal. */
export function dungeonRefusal(why: string): string {
  if (!RAW_ERROR.test(why)) return why
  console.warn('[tutorial] the dungeon did not open:', why)
  return DUNGEON_FAILED_MESSAGE
}

/**
 * Enter the dungeon for the tutorial: null once the game is on screen (not
 * after the world is read, so the card does not sit over the game), or
 * the words for the card.
 */
export function enterDungeonFromTutorial(): Promise<string | null> {
  return new Promise((resolve) => {
    const unsubscribe = useGame.subscribe((s, prev) => {
      if (!s.session || prev.session) return
      // Noted only while the card still waits on it: closed meanwhile, leaving brings nothing back.
      const t = useTutorial.getState()
      if (t.active && t.choosing !== null) noteFromTutorial(s.session.entryId)
      settle(null)
    })
    function settle(note: string | null): void { unsubscribe(); resolve(note) }
    enterTutorialDungeon().then(
      (why) => settle(why ? dungeonRefusal(why) : null),
      (err: unknown) => { console.warn('[tutorial] the dungeon did not open:', err); settle(DUNGEON_FAILED_MESSAGE) },
    )
  })
}

/** Offer the dungeon on the final card when the tutorial dungeon is on here; whether it was. */
export function registerDungeonChoice(): boolean {
  if (!tutorialDungeonEnabled()) return false
  registerTutorialChoice(DUNGEON_CHOICE, { run: enterDungeonFromTutorial })
  return true
}

/** Where the dungeon entered from the tutorial is noted, per identity: its entry's id and that identity. */
export const FROM_TUTORIAL_PREFIX = 'onosendai:tutorial:dungeon:'

interface FromTutorial { entryId: string; pubkey: string }

/** This page's note, only for a device that would not keep it (private mode); the stored one otherwise. */
let unkept: FromTutorial | null = null

function noteFromTutorial(entryId: string): void {
  const note = { entryId, pubkey: useCyberspace.getState().identity.pubkey }
  unkept = null
  try { localStorage.setItem(FROM_TUTORIAL_PREFIX + note.pubkey, JSON.stringify(note)) } catch { unkept = note }
}

/** The note of `pubkey`, the identity on screen. */
function noted(pubkey: string): FromTutorial | null {
  if (unkept) return unkept.pubkey === pubkey ? unkept : null
  try {
    const raw = JSON.parse(localStorage.getItem(FROM_TUTORIAL_PREFIX + pubkey) ?? 'null') as Partial<FromTutorial> | null
    if (raw && typeof raw.entryId === 'string' && raw.pubkey === pubkey) return { entryId: raw.entryId, pubkey }
  } catch { /* nothing readable */ }
  return null
}

function forget(pubkey: string): void {
  if (unkept?.pubkey === pubkey) unkept = null
  try { localStorage.removeItem(FROM_TUTORIAL_PREFIX + pubkey) } catch { /* nothing kept */ }
}

/**
 * Back to the "Where next?" card for `pubkey`, DUNGEON checked off when
 * `cleared`: the run resumes on the card (useTutorial start `at`), laid out
 * where it was. Not with the tutorial switched off, for another identity, or
 * over a run already going; never over the tour or TV (start refuses).
 */
export function backToTheCard(pubkey: string, cleared: boolean): void {
  const t = useTutorial.getState()
  if (!tutorialOn() || t.active || useCyberspace.getState().identity.pubkey !== pubkey) return
  const card = t.script.steps.find((st) => st.choices?.some((c) => c.when === DUNGEON_CHOICE))
  const choice = card?.choices?.find((c) => c.when === DUNGEON_CHOICE)
  if (!card || !choice) return
  const p = readProgress(pubkey)
  if (cleared && p && !p.choices?.includes(choice.id)) writeProgress(pubkey, { ...p, choices: [...(p.choices ?? []), choice.id] })
  t.start({ at: card.id })
}

// EXIT GAME on a dungeon entered from the card: once its exit is signed, the
// card comes back, after the view is put back (useGame exit does that right after).
useGame.subscribe((s, prev) => {
  if (prev.busy !== 'exiting' || s.busy === 'exiting') return
  const note = noted(useCyberspace.getState().identity.pubkey)
  // Only the exit of that very entry, just signed: the chain's last action closes its bracket.
  const chain = useCyberspace.getState().actions()
  const last = chain[chain.length - 1]
  if (!note || last?.role !== 'exit' || last.bracketId !== note.entryId) return
  // Read before useGame forgets the entry's progress: the session as it stood, or what this device kept for it.
  const progress = prev.session?.entryId === note.entryId ? prev.session.progress : loadProgress(note.entryId)
  const cleared = progress?.clearedMs != null
  forget(note.pubkey)
  queueMicrotask(() => backToTheCard(note.pubkey, cleared))
})

// The card offering DUNGEON is how a player finds the dungeon: from then on
// it is in the GAMES panel for them (lib/games/discovered.ts).
useTutorial.subscribe((s, prev) => {
  if (!s.active || !s.pubkey || (s.active === prev.active && s.index === prev.index && s.pubkey === prev.pubkey && s.choicesVersion === prev.choicesVersion)) return
  if (s.script.steps[s.index]?.choices?.some((c) => c.when === DUNGEON_CHOICE && choiceOffered(c))) noteFoundGame(s.pubkey, TUTORIAL_GAME.pubkey)
})

registerDungeonChoice()
