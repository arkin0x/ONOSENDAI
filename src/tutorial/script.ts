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

export const TUTORIAL_SCRIPT: TutorialScript = {
  steps: [WELCOME],
}
