/**
 * Sheet.tsx - what a top-level area, the palette or the object picker opens
 * in (workshop redesign, phase 1): a sheet risen from the bottom, over the
 * strip but never over the dock, and never over the top bar or the rail, so
 * the object stays in sight above it (the bench frames it there). One at a
 * time. Its header says which area and which shard; X, the area's button
 * again, Esc, or a swipe down on the header puts it away.
 */

import { useRef, type ReactNode, type Ref } from 'react'
import { ModalClose } from '../../hud/ui/ModalClose'

/** How far down a swipe on the header must travel, in CSS pixels, to put the sheet away. */
const SWIPE_CLOSE_PX = 56

interface SheetProps {
  /** The region's accessible name: Menu, Shard, Grid, Avatar, Motion. */
  name: string
  /** The words in the header. */
  title: string
  /** After the title, dimmer: the shard's name, a count. */
  sub?: ReactNode
  onClose: () => void
  /** `tall` stands on the strip rather than covering it (the palette, the object picker). */
  tall?: boolean
  /** The scrolling body, for a sheet that remembers where it was scrolled to. */
  bodyRef?: Ref<HTMLDivElement>
  className?: string
  children: ReactNode
}

export function Sheet({ name, title, sub, onClose, tall = false, bodyRef, className, children }: SheetProps): JSX.Element {
  const swipe = useRef<{ id: number; y: number } | null>(null)
  return (
    <section className={`ws__sheet${tall ? ' ws__sheet--tall' : ''}${className ? ` ${className}` : ''}`} role="region" aria-label={name}>
      <div
        className="ws__sheet-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          swipe.current = { id: e.pointerId, y: e.clientY }
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* followed while over the header anyway */ }
        }}
        onPointerMove={(e) => { const s = swipe.current; if (s && s.id === e.pointerId && e.clientY - s.y > SWIPE_CLOSE_PX) { swipe.current = null; onClose() } }}
        onPointerUp={() => { swipe.current = null }}
        onPointerCancel={() => { swipe.current = null }}
      >
        <span className="ws__sheet-grab" aria-hidden />
        <h2 className="ws__sheet-title">{title}</h2>
        {sub !== undefined && <span className="ws__sheet-sub">{sub}</span>}
        <ModalClose onClose={onClose} label={`Close ${title}`} title={`Close ${title} (Esc)`} />
      </div>
      <div className="ws__sheet-body" ref={bodyRef}>
        {children}
      </div>
    </section>
  )
}
