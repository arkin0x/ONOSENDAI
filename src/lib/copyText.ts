/**
 * copyText.ts: put text on the clipboard from a tap, on any phone (owner,
 * 2026-11-16: "I can't copy his sector or coordinate ... I want those to be
 * tap to copy").
 *
 * The Clipboard API first. Where it is missing (a page served over plain
 * http on a LAN, an old WebView) or refuses (no permission, the document not
 * focused), the old way: the text in an off-screen, read-only textarea,
 * selected, and document.execCommand('copy'). Read-only so a phone does not
 * open its keyboard for it; a selection range rather than select() because
 * iOS Safari ignores select() on such a field. Whatever had focus before
 * gets it back.
 *
 * Resolves true when the text went on the clipboard, false when neither way
 * worked; never rejects, so a tap handler can fire and forget.
 */

/** Whether focusing it would bring up a phone's keyboard. */
function isEditable(el: HTMLElement): boolean {
  const tag = (el.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

/** The old way: a hidden field, selected, copied. True when the browser says it copied. */
export function copyByCommand(text: string, doc: Document = document): boolean {
  const body = doc.body
  if (!body) return false
  const field = doc.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.setAttribute('aria-hidden', 'true')
  // On screen as far as the browser knows (iOS will not select an element it
  // thinks is hidden), invisible and out of the way as far as anyone sees.
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none'
  const before = doc.activeElement as HTMLElement | null
  body.appendChild(field)
  let ok = false
  try {
    field.focus({ preventScroll: true })
    field.select()
    field.setSelectionRange(0, text.length)
    ok = doc.execCommand('copy')
  } catch {
    ok = false
  } finally {
    body.removeChild(field)
    // Focus goes back, except to a field a phone would open its keyboard for again.
    if (before && !isEditable(before)) {
      try { before.focus?.({ preventScroll: true }) } catch { /* nothing to give focus back to */ }
    }
  }
  return ok
}

/** Put `text` on the clipboard; true when it got there. */
export async function copyText(text: string): Promise<boolean> {
  const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
  // No Clipboard API: the old way, now, while the tap still counts as a gesture.
  if (!clip?.writeText) return copyByCommand(text)
  try {
    await clip.writeText(text)
    return true
  } catch {
    // Refused: the old way still works in most browsers that refuse.
    return copyByCommand(text)
  }
}
