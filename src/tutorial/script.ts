/**
 * script.ts: the first-arrival tutorial, as data (first-arrival tutorial
 * design, 2026-11-10, §3; owner feedback 2026-11-11).
 *
 * Captions are in the owner's voice, short and plain. The welcome line and the
 * course line are the owner's own (feedback 2026-11-11, items 5 and 13).
 */

import type { TutorialScript, TutorialStep } from './types'
import { TUTORIAL_BUD_PICTURE, TUTORIAL_DNA } from './dna'

/** The tutorial tree's name as the SEED composer shows it. */
const TREE = TUTORIAL_DNA.name.toUpperCase()

/**
 * The COMMIT button alone (feedback items 5 and 14): the mode button beside it
 * shares the class, wearing is-hop, is-view, is-walk or is-build.
 */
export const COMMIT = '.touchops__commit:not(.is-hop):not(.is-view):not(.is-walk):not(.is-build)'

export const WELCOME: TutorialStep = {
  id: 'welcome',
  title: 'Welcome!',
  caption: "A treasure chest has appeared near your location. Go see what's in it! 🪎👀",
  modal: true,
  go: 'FIND IT',
}

/** Move into the green box: being there reveals the chest (the scan does it, no button). */
export const BOX: TutorialStep = {
  id: 'box',
  title: 'The green box',
  caption: "The chest is in the green box. Being somewhere is how you find what's hidden there.",
  captionDone: "You're in.",
  hint: 'Tap COMMIT to move into the box.',
  explain: 'Every place in cyberspace has a key, and the only way to get it is to be there or to do the work of being there. Things are hidden at a place under its key, so you find them by going there. The box is one region, 8 gibsons on a side.',
  // The COMMIT button glows so a newcomer knows where to press; the camera
  // idles a slow spin around the cursor (tutorial/director.ts aim-box).
  scene: { target: 'self', highlight: COMMIT, pad: true },
  wait: 'see-chest',
  // No SKIP here (feedback item 17): NEXT waits for the box, and the X closes the tutorial.
  gate: true,
  effect: 'aim-box',
}

/** OPEN is a tap, never automatic (owner, 2026-10-26). */
export const OPEN: TutorialStep = {
  id: 'open',
  title: 'Open it',
  caption: 'Tap the chest, then OPEN.',
  hint: 'Tap the chest (or FOUND HERE), then OPEN.',
  explain: "Nothing opens by itself. This chest is locked to the box's region, and standing in the box gave you its key.",
  keepChips: ['found'],
  scene: { target: 'keep', highlight: '.foundchip' },
  wait: 'open-chest',
}

/** TAKE is a tap too. */
export const TAKE: TutorialStep = {
  id: 'take',
  title: 'Take it',
  caption: "What's in the chest is yours once you TAKE it.",
  hint: 'Tap the chest again, then TAKE ALL.',
  keepChips: ['found'],
  scene: { target: 'keep', highlight: '.foundchip' },
  explain: 'What you take goes in your ITEMS, in the menu. A shard you take can be placed in the world, built with, or changed in the workshop.',
  wait: 'take',
}

/** To the dirt plot (A5): one COMMIT, the cursor already on it. */
export const TO_PLOT: TutorialStep = {
  id: 'to-plot',
  title: 'The dirt',
  caption: 'The dirt is for a seed. Go stand on it.',
  hint: 'Tap COMMIT to move there.',
  scene: { target: 'self' },
  wait: 'at-plot',
  effect: 'aim-plot',
}

/**
 * Plant it: PLANT THE SEED lines the tutorial tree up in BUILD, where the
 * player stands on the dirt, and HIDE plants it. Planting is the player's,
 * mined on their device.
 */
export const PLANT: TutorialStep = {
  id: 'plant',
  title: 'Plant it',
  caption: `Plant the ${TREE} on the dirt.`,
  hint: 'PLANT THE SEED, then HIDE.',
  action: { label: 'PLANT THE SEED', effect: 'plant-tutorial-seed' },
  explain: 'A seed is yours. You sign it and do a little work for it on this device, and it stays where you plant it. Everyone who finds it grows the same tree, a little more every day.',
  wait: 'plant',
}

/** The bud preview: a reason to come back. */
export const BUD: TutorialStep = {
  id: 'bud',
  title: 'It grows',
  caption: 'It will grow over time. Check back later.',
  effect: 'leave-build',
  image: { src: TUTORIAL_BUD_PICTURE, alt: `The ${TUTORIAL_DNA.name} as it starts to bud` },
}

/** The items you hold: open the menu, ITEMS at the top of it (feedback item 2). */
export const INVENTORY: TutorialStep = {
  id: 'inventory',
  title: 'Your items',
  caption: "What you took is in ITEMS, in the menu. That's your stuff.",
  hint: 'Look in ITEMS at the top of the menu.',
  explain: 'A shard in ITEMS can be placed in the world, built with, or changed in the workshop.',
  // The ITEMS panel by its slot id: DISCOVERED shares the .panel--loot class.
  scene: { target: 'keep', highlight: '[data-panel-id="items"]' },
  effect: 'teach-inventory',
}

/** To the start of the course: one COMMIT, the cursor already on the start square. */
export const TO_COURSE: TutorialStep = {
  id: 'to-course',
  title: 'The course',
  caption: 'HOPs are the basic way to move through cyberspace, but running and jumping is a bit more fun! See the platform course? Let\'s HOP over it and try it. Tap COMMIT in CONTROLS to HOP there.',
  hint: 'Tap COMMIT to HOP to the start.',
  scene: { target: 'self', highlight: COMMIT, pad: true },
  wait: 'at-start',
  effect: 'to-course',
}

/** WALK: the WALK button in RECALL's slot, at rest in HOP. */
export const WALK: TutorialStep = {
  id: 'walk',
  title: 'Walk',
  caption: 'Switch to WALK. Every step you take is a real move.',
  hint: 'Tap WALK under the pad.',
  explain: 'In WALK you see through your own eyes, and every step is proved and signed like a hop.',
  scene: { target: 'keep', highlight: '.touchops__walk' },
  wait: 'walk',
}

/** GRAVITY in WALK: fall, land, jump. */
export const GRAVITY: TutorialStep = {
  id: 'gravity',
  title: 'Gravity',
  caption: 'Now turn GRAVITY on.',
  hint: 'Tap GRAVITY (or press Z).',
  scene: { target: 'keep', highlight: '.touchpad__key--gravity' },
  wait: 'gravity',
  needsWalk: 'walk',
}

/** The run: three gaps and the trampoline up to the finish deck. */
export const RUN: TutorialStep = {
  id: 'run',
  title: 'Run it',
  caption: 'Jump the gaps to the trampoline. It throws you up to the finish.',
  hint: 'JUMP (Space) to jump, again in the air to jump higher.',
  needsWalk: 'walk',
  explain: 'A jump takes you 5 up and as far as you press forward in the air. Press JUMP again in the air for 3 more. The finish is too high to jump to: land on the trampoline and press forward while it throws you. Fall off and you land on the floor below; walk to the step behind the start to climb back up.',
  wait: 'see-finish',
}

/** The finish chest: pieces to build a course of your own. */
export const FINISH: TutorialStep = {
  id: 'finish',
  title: 'You made it',
  caption: 'Another chest, with pieces to build a course of your own. OPEN it and TAKE them.',
  hint: 'Tap the chest to OPEN it, then again to TAKE ALL.',
  keepChips: ['found'],
  scene: { target: 'keep', highlight: '.foundchip' },
  wait: 'take-finish',
}

/** The workshop: change what you found, or make something new. Opened by its button, never by itself. */
export const WORKSHOP: TutorialStep = {
  id: 'workshop',
  title: 'The workshop',
  caption: 'Change what you found, or make something new.',
  hint: 'OPEN WORKSHOP. Close it when you are done.',
  explain: 'The workshop is where shards are made, on a grid. Anything you make there can go into the world: place it in BUILD.',
  action: { label: 'OPEN WORKSHOP', effect: 'open-workshop' },
  wait: 'workshop',
}

/**
 * Where next (T9). Each choice is the player's; nothing here costs work or
 * sats. After a route they come back here with it checked off, so they can do
 * the rest (feedback item 10); DONE ends the run.
 */
export const CHOICE: TutorialStep = {
  id: 'choice',
  title: 'Where next?',
  caption: 'That was the basics. Try as many as you like.',
  modal: true,
  go: 'DONE',
  choices: [
    { id: 'hyperspace', label: 'TRAVEL TO EARTH', about: 'Ride hyperspace to a place on Earth.', step: 'earth' },
    { id: 'dungeon', label: 'PLAY THE DUNGEON', about: 'A game inside cyberspace, with its own rules.', when: 'dungeon' },
    { id: 'agents', label: 'BRING YOUR AI', about: 'Add your AI to cyberspace and talk to it here.', step: 'agents' },
    { id: 'friend', label: 'SEE A FRIEND', about: 'Add a friend and watch where they have been.', step: 'friend' },
    { id: 'build', label: 'BUILD SOMETHING', about: 'Place a shard from your ITEMS in the world.', step: 'build-place' },
  ],
}

/** HYPERSPACE: Earth through the free view first, then where BOARD is. */
export const EARTH: TutorialStep = {
  id: 'earth',
  title: 'Earth',
  caption: 'That is Earth. Bitcoin blocks land all over it. Looking is free.',
  hint: 'To go: menu, HYPERSPACE, pick a block, BOARD, then RIDE.',
  explain: 'A hyperspace ride follows the chain of Bitcoin blocks. It costs work for every block you pass, done on this device, or sats if HOSAKA does the work for you. Nothing is spent until you RIDE.',
  scene: { target: 'keep', highlight: '.hamburger-menu' },
  effect: 'view-earth',
  branch: true,
}

/** AGENTS: the existing panel, in the menu, open to the key you are on (feedback item 7). */
export const AGENTS: TutorialStep = {
  id: 'agents',
  title: 'Your AI',
  caption: 'Your AI can be in cyberspace with you, and you can give it commands through ONOSENDAI.',
  hint: 'Open the menu, then AGENTS.',
  scene: { target: 'keep', highlight: '.hamburger-menu' },
  branch: true,
}

/** A friend in cyberspace: add the owner as a TARGET, spectate his chain (feedback item 11a). */
export const FRIEND: TutorialStep = {
  id: 'friend',
  title: 'See a friend',
  caption: "I'm in cyberspace too. I added myself to your TARGET panel. Watch where I have been.",
  hint: 'Open TARGET, then tap the chain chip to SPECTATE me.',
  explain: 'A TARGET is anyone you want to keep an eye on. The chain chip walks their moves, oldest to newest. SPECTATE rides along from your own head.',
  keepChips: ['chain'],
  scene: { target: 'keep', highlight: '.hamburger-menu' },
  effect: 'add-friend',
  branch: true,
}

/** BUILD: move a shard from ITEMS to the workshop, then place it with BUILD's OBJECT (feedback item 11b). */
export const BUILD_PLACE: TutorialStep = {
  id: 'build-place',
  title: 'Build something',
  caption: 'Move a shard from ITEMS to your workshop, then place it in BUILD.',
  hint: 'ITEMS: MOVE TO WORKSHOP. Then BUILD, OBJECT, pick it, PLACE.',
  explain: 'BUILD puts what you hold into the world where the cursor is. The workshop is where you change or make a shard; it will not interrupt this.',
  scene: { target: 'keep', highlight: '.hamburger-menu' },
  effect: 'teach-build',
  branch: true,
}

/** The last word: how to open the tutorial again (feedback items 10 and 17). */
export const FAREWELL: TutorialStep = {
  id: 'done',
  title: "That's the tour",
  caption: 'Want it again? Open the menu and tap TUTORIAL.',
  modal: true,
  go: 'FINISH',
}

export const TUTORIAL_SCRIPT: TutorialScript = {
  steps: [WELCOME, BOX, OPEN, TAKE, TO_PLOT, PLANT, BUD, INVENTORY, TO_COURSE, WALK, GRAVITY, RUN, FINISH, WORKSHOP, CHOICE, EARTH, AGENTS, FRIEND, BUILD_PLACE, FAREWELL],
}
