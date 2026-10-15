/**
 * pressGuard.ts - a click counts only if the press began on the element.
 *
 * On a phone the click that ends a tap goes to whatever is under the finger
 * when the click is sent, which is after the press and release have already
 * been handled. If handling them draws a new control at that spot, the click
 * lands on the new control though nobody pressed it. The CHAT chip is that
 * control: a tap on the scene where the chip sits folds the open chat, the
 * chip is drawn back under the finger, and the click reopened the chat
 * (arkinox, 2026-10-08: "the chat will flash and fail to close").
 *
 * Call press() from the element's onPointerDown and real() from its onClick.
 * A click from the keyboard (detail 0) needs no press.
 */

/** How long after its press a click still belongs to it. */
const WINDOW_MS = 1500

export function pressGuard(): { press: (t: number) => void; real: (detail: number, t: number) => boolean } {
  let at = -Infinity
  return {
    press: (t) => { at = t },
    real: (detail, t) => {
      const ok = detail === 0 || t - at <= WINDOW_MS
      at = -Infinity
      return ok
    },
  }
}
