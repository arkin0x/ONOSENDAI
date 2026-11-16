/**
 * AssistBox.tsx - the aim assist's box on a touch screen: a square centred
 * on the reticle, drawn as four orange rounded corner brackets over a very
 * faint orange fill, the reticle in its middle.
 *
 * - Its side is between FIRE's and the MOVE stick's (styles.css
 *   --drun-assist: the mean of --drun-fire and --drun-stick), so it scales
 *   with the controls.
 * - It measures itself as drawn (ResizeObserver) and tells the assist
 *   (assist.ts setAssistBox) half its side in CSS px; when it is not shown
 *   it tells it null, and the assist stops.
 * - Shown only on touch screens whose last pointer was a finger, with a gun
 *   whose def has assist "auto" in hand (the PULSE RIFLE), no card up and
 *   the game not exiting (model.ts assistShown). The element stays in place
 *   either way (hidden, not removed), so nothing moves.
 * - While the assist has a drone (assistState.target) the brackets brighten
 *   a little; read each screen frame, set as a class, never through React.
 */

import { useEffect, useRef } from 'react'
import { assistState, setAssistBox } from '../assist'
import { ASSIST_PX } from './model'

/** Half the box's side, from its measured size: the drawn square's half, or the layout's default before it is measured. */
export function assistHalf(width: number | undefined): number {
  return width && width > 0 ? width / 2 : ASSIST_PX / 2
}

export function AssistBox({ shown }: { shown: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  // Its size to the assist while shown; null when not, and when it goes.
  useEffect(() => {
    if (!shown) { setAssistBox(null); return }
    const el = ref.current as (HTMLDivElement & Partial<Pick<HTMLElement, 'getBoundingClientRect'>>) | null
    const measured = (): number | undefined => (el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect().width : undefined)
    setAssistBox(assistHalf(measured()))
    const ro = el && typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => { setAssistBox(assistHalf(entries[0]?.contentRect?.width ?? measured())) })
      : null
    if (ro && el) ro.observe(el)
    return () => { ro?.disconnect(); setAssistBox(null) }
  }, [shown])

  // Brighter while a drone is locked.
  useEffect(() => {
    const el = ref.current
    if (!shown || !el || !el.classList || typeof requestAnimationFrame !== 'function') return
    let on = false
    let id = 0
    const frame = (): void => {
      const now = assistState.target !== null
      if (now !== on) { on = now; el.classList.toggle('is-locked', on) }
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(id); el.classList.remove('is-locked') }
  }, [shown])

  return (
    <div ref={ref} className={`drun-assist${shown ? '' : ' is-off'}`} aria-hidden>
      <span className="drun-assist__c drun-assist__c--tl" />
      <span className="drun-assist__c drun-assist__c--tr" />
      <span className="drun-assist__c drun-assist__c--bl" />
      <span className="drun-assist__c drun-assist__c--br" />
    </div>
  )
}
