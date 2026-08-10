/**
 * PROTOTYPE — throwaway. Ticket 03 of the spatial-perception map.
 *
 * Three variants of the spatial model, switchable via ?variant= on the existing
 * route, so each is judged against real terrain, a real cursor and real HUD
 * density rather than in a vacuum.
 *
 * Delete this directory when 03 resolves. The full variant set lives on the
 * throwaway branch `prototype/03-spatial-model`; main keeps only the winner.
 */

import { useEffect } from 'react'

export const VARIANTS = {
  A: 'Light only — flat slice, bloom + fog',
  B: 'Rooms — aligned-subtree containment',
  C: 'Perspective room — B with a real rig',
} as const

export type VariantKey = keyof typeof VARIANTS

const KEYS = Object.keys(VARIANTS) as VariantKey[]

export function currentVariant(): VariantKey {
  const v = new URLSearchParams(window.location.search).get('variant')?.toUpperCase()
  return (v && v in VARIANTS ? v : 'A') as VariantKey
}

function goTo(key: VariantKey): void {
  const url = new URL(window.location.href)
  url.searchParams.set('variant', key)
  window.location.href = url.toString()
}

/**
 * Fixed bar, bottom centre. Deliberately ugly and high-contrast so it reads as
 * scaffolding rather than as part of the design being judged.
 */
export function PrototypeSwitcher(): JSX.Element | null {
  const current = currentVariant()
  const idx = KEYS.indexOf(current)

  const cycle = (delta: number): void => {
    goTo(KEYS[(idx + delta + KEYS.length) % KEYS.length])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); cycle(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); cycle(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!import.meta.env.DEV) return null

  return (
    <div className="proto-switcher">
      <button onClick={() => cycle(-1)} aria-label="Previous variant">←</button>
      <span>{current} — {VARIANTS[current]}</span>
      <button onClick={() => cycle(1)} aria-label="Next variant">→</button>
    </div>
  )
}
