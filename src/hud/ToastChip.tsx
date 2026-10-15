/**
 * ToastChip.tsx - the chip for a cloud job that just finished, in the
 * instrument stack next to KEY FOUND: the provider's mark, the job, thanks.
 * Also the brief word that a place was starred, with a yellow star for a
 * mark, the Builder's word, with its wrench, on why BUILD mode ended when
 * something other than EXIT ended it, and WALK's, with footprints, on why a
 * walk stopped short, a /C/ link's, with a pin, on what the link named, and
 * the signer's, with a crossed-out person, when it is on another account.
 * Its clock starts when it is on screen, so a job finishing behind the menu
 * is still announced when the scene comes back. Tap to dismiss. A sticky
 * one (a /C/ link's block) has no clock and shows its ✕.
 */

import { useCyberspace } from '../store/useCyberspace'
import { useEffect } from 'react'
import { Footprints, Goal, MapPin, Star, UserX, Wrench } from 'lucide-react'
import { toastClockMs, useToast } from '../store/useToast'

export function ToastChip(): JSX.Element | null {
  const provider = useCyberspace((s) => s.cloud.provider)
  const toast = useToast((s) => s.toast)

  useEffect(() => {
    const ms = toast ? toastClockMs(toast) : null
    if (ms === null) return
    const timer = window.setTimeout(() => useToast.getState().dismiss(), ms)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (!toast) return null
  return (
    <div className={`hyperbar hyperbar--found hyperbar--toast${toast.mark === 'build' ? ' hyperbar--buildtoast' : toast.mark === 'walk' ? ' hyperbar--buildtoast hyperbar--walktoast' : toast.mark === 'place' || toast.mark === 'goal' ? ' hyperbar--buildtoast' : toast.mark === 'signer' ? ' hyperbar--buildtoast hyperbar--signertoast' : ''}`} role="status" onClick={() => useToast.getState().dismiss()} title="Tap to dismiss">
      {toast.mark === 'build'
        ? <Wrench className="toast__build" size={16} strokeWidth={2.25} aria-hidden />
        : toast.mark === 'walk'
        ? <Footprints className="toast__build toast__walk" size={16} strokeWidth={2.25} aria-hidden />
        : toast.mark === 'place'
        ? <MapPin className="toast__build" size={16} strokeWidth={2.25} aria-hidden />
        : toast.mark === 'goal'
        ? <Goal className="toast__build" size={16} strokeWidth={2.25} aria-hidden />
        : toast.mark === 'signer'
        ? <UserX className="toast__build toast__signer" size={16} strokeWidth={2.25} aria-hidden />
        : toast.mark === 'star'
        ? <Star className="hyperbar__mark hyperbar__mark--star" size={18} strokeWidth={2} fill="currentColor" aria-hidden />
        : <img className="hyperbar__mark" src={provider?.logo ?? '/hosaka-mark.png'} alt={provider?.name ?? 'HOSAKA'} width={308} height={334} decoding="async" />}
      <span className="hyperbar__text">
        <span className="hyperbar__label">{toast.label}</span>
        <span className="hyperbar__meta">{toast.meta}</span>
      </span>
      {toast.sticky && <span className="toast__dismiss" aria-hidden="true">✕</span>}
    </div>
  )
}
