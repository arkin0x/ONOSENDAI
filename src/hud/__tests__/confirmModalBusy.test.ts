/**
 * confirmModalBusy.test.ts - a busy confirm cannot be dismissed (final
 * review of #227).
 *
 * RESPAWN NOW with a bunker signer waits for an approval on a phone. A tap
 * on the backdrop used to close the modal while it waited, which let the
 * person switch identity with the old identity's signature still pending.
 * While busy, neither the backdrop nor Escape closes the modal.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'

// The modal renders through a portal into document.body; here there is no
// document, and the element itself is what is looked at.
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (el: ReactElement) => el,
}))

import { ConfirmModal } from '../ConfirmModal'

// The portal's target is named before the portal is made.
if (typeof document === 'undefined') (globalThis as { document?: unknown }).document = { body: {} }

/** The modal's outer element, rendered with these props. */
function backdrop(busy: boolean, onCancel: () => void, onBackdrop?: () => void): ReactElement<{ onPointerDown: () => void }> {
  let out: ReactElement | null = null
  renderToString(createElement(() => {
    out = ConfirmModal({ title: 'Respawn?', body: 'x', confirmLabel: 'RESPAWN NOW', busy, onConfirm: () => {}, onCancel, onBackdrop })
    return null
  }))
  return out as unknown as ReactElement<{ onPointerDown: () => void }>
}

describe('ConfirmModal while busy', () => {
  it('a tap on the backdrop does nothing while busy, and cancels when not', () => {
    const cancel = vi.fn()
    const aside = vi.fn()
    backdrop(true, cancel, aside).props.onPointerDown()
    backdrop(true, cancel).props.onPointerDown()
    expect(cancel).not.toHaveBeenCalled()
    expect(aside).not.toHaveBeenCalled()
    backdrop(false, cancel).props.onPointerDown()
    expect(cancel).toHaveBeenCalledTimes(1)
    backdrop(false, cancel, aside).props.onPointerDown()
    expect(aside).toHaveBeenCalledTimes(1)
  })
})
