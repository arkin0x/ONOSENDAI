/**
 * ToastChip.tsx - the chip for a cloud job that just finished, in the
 * instrument stack next to KEY FOUND: the provider's mark, the job, thanks.
 * Also the brief word that a place was starred, with a yellow star for a
 * mark, and the Builder's word, with its wrench, on why BUILD mode ended when
 * something other than EXIT ended it.
 * Its clock starts when it is on screen, so a job finishing behind the menu
 * is still announced when the scene comes back. Tap to dismiss.
 */

import { useCyberspace } from '../store/useCyberspace'
import { useEffect } from 'react'
import { Star, Wrench } from 'lucide-react'
import { TOAST_MS, useToast } from '../store/useToast'

export function ToastChip(): JSX.Element | null {
  const provider = useCyberspace((s) => s.cloud.provider)
  const toast = useToast((s) => s.toast)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => useToast.getState().dismiss(), toast.ms ?? TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (!toast) return null
  return (
    <div className={`hyperbar hyperbar--found hyperbar--toast${toast.mark === 'build' ? ' hyperbar--buildtoast' : ''}`} role="status" onClick={() => useToast.getState().dismiss()}>
      {toast.mark === 'build'
        ? <Wrench className="toast__build" size={16} strokeWidth={2.25} aria-hidden />
        : toast.mark === 'star'
        ? <Star className="hyperbar__mark hyperbar__mark--star" size={18} strokeWidth={2} fill="currentColor" aria-hidden />
        : <img className="hyperbar__mark" src={provider?.logo ?? '/hosaka-mark.png'} alt={provider?.name ?? 'HOSAKA'} width={308} height={334} decoding="async" />}
      <span className="hyperbar__text">
        <span className="hyperbar__label">{toast.label}</span>
        <span className="hyperbar__meta">{toast.meta}</span>
      </span>
    </div>
  )
}
