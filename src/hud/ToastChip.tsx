/**
 * ToastChip.tsx - the chip for a cloud job that just finished, in the
 * instrument stack next to KEY FOUND: the provider's mark, the job, thanks.
 * Its clock starts when it is on screen, so a job finishing behind the menu
 * is still announced when the scene comes back. Tap to dismiss.
 */

import { useEffect } from 'react'
import { TOAST_MS, useToast } from '../store/useToast'

export function ToastChip(): JSX.Element | null {
  const toast = useToast((s) => s.toast)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => useToast.getState().dismiss(), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (!toast) return null
  return (
    <div className="hyperbar hyperbar--found hyperbar--toast" role="status" onClick={() => useToast.getState().dismiss()}>
      <img className="hyperbar__mark" src="/hosaka-mark.png" alt="HOSAKA" width={308} height={334} decoding="async" />
      <span className="hyperbar__text">
        <span className="hyperbar__label">{toast.label}</span>
        <span className="hyperbar__meta">{toast.meta}</span>
      </span>
    </div>
  )
}
