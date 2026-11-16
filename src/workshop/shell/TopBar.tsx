/**
 * TopBar.tsx - the top bar, one of the workshop's five fixed places (workshop
 * redesign, phase 1): the way out, then the top-level areas MENU, SHARD,
 * MOTION, AVATAR and GRID (arkinox, 2026-11-15), each opening its own sheet,
 * then DEPLOY. One row
 * that never wraps and never hides, in that order on every tool and every
 * state; a button is greyed out rather than taken away.
 *
 * A big feature area gets its own button here rather than a section at the
 * bottom of another panel (arkinox, 2026-11-14, of MOTION: "It's too much
 * for appending to the bottom of the shard menu"). An avatar waiting for its
 * signer or the relays, which had a chip of its own that wrapped the old row,
 * is a ring on AVATAR.
 */

import { Box, Grid3x3, Menu, Orbit, Play, VenetianMask, X, type LucideIcon } from 'lucide-react'
import { useAvatars } from '../../store/useAvatars'
import { useShards } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { useBeginner } from '../beginner'
import { MOTION_READY, type Area } from '../sheets/areas'

const AREAS: Array<{ area: Area; label: string; icon: LucideIcon }> = [
  { area: 'menu', label: 'MENU', icon: Menu },
  { area: 'shard', label: 'SHARD', icon: Box },
  { area: 'motion', label: 'MOTION', icon: Orbit },
  { area: 'avatar', label: 'AVATAR', icon: VenetianMask },
  { area: 'grid', label: 'GRID', icon: Grid3x3 },
]

export function TopBar({ open, onArea }: { open: Area | null; onArea: (a: Area) => void }): JSX.Element {
  const hasContent = useWorkshop((s) => { const c = s.current(); return c !== null && (c.vertices.length > 0 || (c.parts?.length ?? 0) > 0) })
  const phase = useAvatars((s) => s.phase)
  // The first-visit guide, done: DEPLOY lights up for a moment (shell/Guide).
  const deployGlow = useBeginner((b) => b.glow === 'deploy')
  const w = useWorkshop.getState
  const work = phase === 'signing' ? 'SIGN IT' : phase === 'publishing' ? 'PUBLISHING' : null
  return (
    <header className="ws__topbar" role="toolbar" aria-label="Workshop">
      <button className="ws__topbtn ws__topbtn--close" onClick={() => w().closeWorkshop()} title="Close the workshop (Esc)" aria-label="Close the workshop">
        <X size={20} strokeWidth={2.25} aria-hidden />
      </button>
      {AREAS.map(({ area, label, icon: Icon }) => {
        const off = area === 'motion' && !MOTION_READY
        const busy = area === 'avatar' && work !== null
        return (
          <button
            key={area}
            className={`ws__topbtn${open === area ? ' is-on' : ''}${busy ? ` is-working is-${phase}` : ''}`}
            aria-pressed={open === area}
            disabled={off}
            onClick={() => onArea(area)}
            title={off ? 'MOTION: coming soon' : busy ? `${work}: see AVATAR` : label}
            aria-label={busy ? `${label}, ${work}` : undefined}
          >
            <Icon size={18} strokeWidth={2} aria-hidden />
            <span>{label}</span>
            {busy && <span className="ws__topbtn-ring" aria-hidden />}
          </button>
        )
      })}
      <button
        className={`ws__topbtn ws__topbtn--deploy${deployGlow ? ' is-guide' : ''}`}
        disabled={!hasContent}
        onClick={() => { const s = w().current(); if (s) { useShards.getState().startDeployShard(s.id, 'workshop'); w().closeWorkshop() } }}
        title="Place this object in the world"
      >
        <Play size={18} strokeWidth={2} aria-hidden />
        <span>DEPLOY</span>
      </button>
    </header>
  )
}
