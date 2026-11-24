/**
 * preflight.ts: what index.html's preflight script leaves on the page for the
 * app (README "Browsers"). The script itself is inline in index.html's head,
 * kept short because every visitor downloads it, and explained here.
 *
 * It is plain ES5 on purpose, so it runs on the oldest iPad and says in words
 * that the app cannot run there, where the app's own script would stop at its
 * first unknown word and leave the wordmark spinning forever, or draw the
 * panels and then go black (arkinox, 2026-11-23, an old iPad: "the tour
 * basically didnt draw everything").
 *
 * Two things are required. WebGL 2, which three.js needs to draw anything
 * (Safari 15 and later); without it the first canvas throws "Error creating
 * WebGL context." and React unmounted the whole page. And the JavaScript of
 * Safari 15.4 (Object.hasOwn, Array at and findLast, structuredClone), which
 * the app calls without a fallback: the tutorial's captions call
 * Object.hasOwn as they draw. Lacking either, it puts its page in place of
 * the wordmark and sets __onosendaiUnsupported, and main.tsx starts nothing.
 *
 * The WebGL check reads only whether the browser has WebGL 2, without opening
 * a context: a throwaway context is a long task at boot (vite.config.ts
 * composerKnowsWebGL2). A context that still fails to open later (memory,
 * too many tabs) is the app's to say: hud/CrashNote around the 3D view.
 *
 * Then the watch. If the app's first script never runs (a script the browser
 * cannot read, a chunk that never arrives), the page says the app could not
 * start, with the reason and RELOAD, instead of the wordmark forever.
 * main.tsx marks that it ran and hands a failed load of the app's chunk to
 * onosendaiCannotStart. The page goes only over the wordmark, never over an
 * app that has drawn (boot.tsx sets __onosendaiDrawn). Its styles are the
 * .cannot-run rules after the script in index.html's head. Tested in lib/__tests__/preflight.test.ts.
 */

export interface PreflightPage {
  /** What this browser lacks, set by the preflight when it cannot run the app; nothing starts then. */
  __onosendaiUnsupported?: string[]
  /** Set by main.tsx once its first line runs; the preflight's watch says the app could not start without it. */
  __onosendaiRan?: boolean
  /** Set by boot.tsx as the app first draws: from then on the preflight never puts its page in place of the app. */
  __onosendaiDrawn?: boolean
  /** The preflight's "could not start" page, over the wordmark only (never over a drawn app). */
  onosendaiCannotStart?: (reason?: string) => void
}

/** The page, as the preflight leaves it. */
export function preflightPage(): PreflightPage {
  return window as unknown as PreflightPage
}
