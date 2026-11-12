/**
 * GoArrow.tsx - the arrow at the end of a button that goes somewhere or does
 * the thing (VIEW, PLACE ITEM, DEPLOY), one for the whole app.
 *
 * arkinox, 2026-11-12: "the arrow in the VIEW button here is way too small,
 * and I noticed that across the app." The text glyph it replaces drew at a
 * fraction of the label's height; this one is sized in em, so it scales with
 * whatever label it ends, and its line box stays inside the label's, so no
 * button grows taller (styles.css .go-arrow).
 */

export function GoArrow(): JSX.Element {
  return (
    <svg className="go-arrow" viewBox="0 0 8 10" aria-hidden focusable="false">
      <path fill="currentColor" d="M0 0 L8 5 L0 10 Z" />
    </svg>
  )
}
