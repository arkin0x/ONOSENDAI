/**
 * script.ts: the first-arrival tutorial, as data (first-arrival tutorial
 * design, 2026-11-10, §3).
 *
 * Captions are drafts in the owner's voice, short and plain, waiting on the
 * owner's read of the whole script (design §7, question 7). The welcome line
 * is the owner's own.
 */

import type { TutorialScript, TutorialStep } from './types'

export const WELCOME: TutorialStep = {
  id: 'welcome',
  title: 'Welcome!',
  caption: "A treasure chest has appeared near your location. You should see what's in it.",
  modal: true,
  go: 'FIND IT',
}

/** Move into the blue box: being there reveals the chest (the scan does it, no button). */
export const BOX: TutorialStep = {
  id: 'box',
  title: 'The blue box',
  caption: "The chest is in the blue box. Being somewhere is how you find what's hidden there.",
  captionDone: "You're in.",
  hint: 'Tap COMMIT to move into the box.',
  explain: 'Every place in cyberspace has a key, and the only way to get it is to be there or to do the work of being there. Things are hidden at a place under its key, so you find them by going there. The box is one region, 8 gibsons on a side.',
  scene: { target: 'self' },
  wait: 'see-chest',
  effect: 'aim-box',
}

/** OPEN is a tap, never automatic (owner, 2026-10-26). */
export const OPEN: TutorialStep = {
  id: 'open',
  title: 'Open it',
  caption: 'Tap the chest, then OPEN.',
  hint: 'Tap the chest (or FOUND HERE), then OPEN.',
  explain: "Nothing opens by itself. This chest is locked to the box's region, and standing in the box gave you its key.",
  scene: { target: 'keep', highlight: '.foundchip' },
  wait: 'open-chest',
}

/** TAKE is a tap too. */
export const TAKE: TutorialStep = {
  id: 'take',
  title: 'Take it',
  caption: "What's in the chest is yours once you TAKE it.",
  hint: 'Tap the chest again, then TAKE ALL.',
  scene: { target: 'keep', highlight: '.foundchip' },
  explain: 'What you take goes in your ITEMS, in the menu. A shard you take can be placed in the world, built with, or changed in the workshop.',
  wait: 'take',
}

/** To the start of the course: one COMMIT, the cursor already on the start square. */
export const TO_COURSE: TutorialStep = {
  id: 'to-course',
  title: 'The course',
  caption: 'See the platforms? Go to the start line.',
  hint: 'Tap COMMIT to move there.',
  scene: { target: 'self' },
  wait: 'at-start',
  effect: 'aim-start',
}

/** WALK: the mode button goes round HOP, VIEW, WALK, BUILD. */
export const WALK: TutorialStep = {
  id: 'walk',
  title: 'Walk',
  caption: 'Switch to WALK. Every step you take is a real move.',
  hint: 'Tap the mode button (HOP) until it says WALK.',
  explain: 'In WALK you see through your own eyes, and every step is proved and signed like a hop.',
  scene: { target: 'keep', highlight: '.touchops__commit.is-hop, .touchops__commit.is-view' },
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
}

/** The run: three gaps and the trampoline up to the finish deck. */
export const RUN: TutorialStep = {
  id: 'run',
  title: 'Run it',
  caption: 'Jump the gaps to the trampoline. It throws you up to the finish.',
  hint: 'JUMP (Space) to jump, again in the air to jump higher.',
  explain: 'A jump takes you 5 up and as far as you press forward in the air. Press JUMP again in the air for 3 more. The finish is too high to jump to: land on the trampoline and press forward while it throws you. Fall off and you land on the floor below; the step at the back takes you up to the start.',
  wait: 'see-finish',
}

/** The finish chest: pieces to build a course of your own. */
export const FINISH: TutorialStep = {
  id: 'finish',
  title: 'You made it',
  caption: 'Another chest. OPEN it and TAKE what is inside: pieces to build your own course.',
  hint: 'Tap the chest, OPEN, then TAKE ALL.',
  scene: { target: 'keep', highlight: '.hyperbar--found' },
  wait: 'take-finish',
}

export const TUTORIAL_SCRIPT: TutorialScript = {
  steps: [WELCOME, BOX, OPEN, TAKE, TO_COURSE, WALK, GRAVITY, RUN, FINISH],
}
