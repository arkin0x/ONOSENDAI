/**
 * TerrainCrew.tsx - the Crew in TERRAIN's scene (store/terrainShare.ts):
 *
 * - "Build with <name>?" when another player is within about 8 gibsons and
 *   not in your Crew: ADD (Enter), or the shared ✕ (Backspace, or Esc
 *   while the mouse is free: a captured mouse takes Esc for itself). Once
 *   per person per visit; ✕ hides it for that person. Answered by its keys,
 *   so a walker whose mouse is captured never has to free it. It is not on
 *   the Escape stack, which would free a captured mouse (TerrainView).
 *   Above the cross, over the scene, never over the menu or the controls.
 * - A small Crew mark beside the cross while you aim at a block whose
 *   builder lists you (the outline is mint then too).
 * - The first time you aim at someone else's block (an amber outline), one
 *   line under the cross, once per builder: whose build it is, and how to
 *   be let in.
 *
 * None of it asks a signer for anything: the builder key writes the list.
 */

import { useEffect, useState } from 'react'
import { Users, UserPlus } from 'lucide-react'
import { addCrew, hintOnce, useAim, useShare } from '../store/terrainShare'
import { useCyberspace } from '../store/useCyberspace'
import { usePresence } from '../store/usePresence'
import { useTerrain } from '../store/useTerrain'
import { useProfile } from '../hooks/useProfile'
import { useProfiles } from '../store/useProfiles'
import { safeNpub } from '../lib/npub'
import { ModalClose } from '../hud/ui/ModalClose'
import { topEscape } from '../hooks/useEscape'
import { walkMenuCovering } from '../store/walkInput'

/** How near another player is, in gibsons, for the chip to ask. */
export const CREW_NEAR = 8

/** A short name for a pubkey: its profile name, else the start of its npub. */
export function crewName(pubkey: string): string {
  const p = useProfiles.getState().profiles[pubkey]
  if (p?.name) return p.name
  useProfiles.getState().request(pubkey)
  return `${safeNpub(pubkey).slice(0, 12)}…`
}

function useName(pubkey: string | null): string {
  const p = useProfile(pubkey)
  return pubkey ? p?.name || `${safeNpub(pubkey).slice(0, 12)}…` : ''
}

/** Asked or dismissed this visit, per person. */
const offered = new Set<string>()
/** Whom the chip asks about now, or null: TERRAIN's Esc leaves the chip its key while it asks. */
let asking: string | null = null

/** Whether the chip is up (terrain/TerrainView.tsx: Esc then dismisses it rather than leaving TERRAIN). */
export function crewChipAsking(): boolean {
  return asking !== null
}

/** For tests: forget who was asked. */
export function resetCrewOffers(): void {
  offered.clear()
  asking = null
}

/** The nearest player within CREW_NEAR gibsons, not you, not in your Crew, not asked this visit; null when none. */
export function nearbyToAsk(): string | null {
  const cs = useCyberspace.getState()
  const at = cs.walking ? cs.cursor : cs.position
  const crew = useShare.getState().crew
  const far = BigInt(CREW_NEAR)
  const abs = (v: bigint): bigint => (v < 0n ? -v : v)
  let best: { pk: string; d: bigint } | null = null
  for (const p of usePresence.getState().others()) {
    if (p.pubkey === cs.identity.pubkey || p.plane !== cs.plane || crew.includes(p.pubkey) || offered.has(p.pubkey)) continue
    const d = [p.position.x - at.x, p.position.y - at.y, p.position.z - at.z].map(abs).reduce((a, b) => (a > b ? a : b))
    if (d <= far && (!best || d < best.d)) best = { pk: p.pubkey, d }
  }
  return best?.pk ?? null
}

/** Whether the device has a mouse, so the chip's keys are shown beside its buttons. */
const finePointer = (): boolean => { try { return window.matchMedia('(pointer: fine)').matches } catch { return false } }

/**
 * The chip's keys while it asks: Enter adds them; Backspace dismisses, and so
 * does Esc while the mouse is free (heard ahead of TERRAIN's own Escape,
 * which would otherwise leave TERRAIN). Nothing is taken while anything is
 * on the Escape stack (a modal, the menu), while the bag is open or the menu
 * covers the scene, or from a key typed into a field or pressed on a button.
 */
export function crewChipKeys(on: EventTarget, add: () => void, dismiss: () => void, mouseCaptured: () => boolean = () => !!document.pointerLockElement): () => void {
  const down = (ev: Event): void => {
    const e = ev as KeyboardEvent
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    const act = e.key === 'Enter' ? add : e.key === 'Backspace' || (e.key === 'Escape' && !mouseCaptured()) ? dismiss : null
    if (!act) return
    const t = e.target as HTMLElement | null
    if (t?.closest?.('input, textarea, select, button, [contenteditable="true"]')) return
    if (topEscape() !== null || useTerrain.getState().sheet || walkMenuCovering()) return
    e.preventDefault()
    e.stopImmediatePropagation()
    act()
  }
  on.addEventListener('keydown', down, true)
  return () => on.removeEventListener('keydown', down, true)
}

function CrewChip(): JSX.Element | null {
  const [who, setWho] = useState<string | null>(null)
  const name = useName(who)
  useEffect(() => {
    const t = window.setInterval(() => { if (!who) setWho(nearbyToAsk()) }, 1000)
    return () => clearInterval(t)
  }, [who])
  const done = (): void => { if (who) offered.add(who); setWho(null) }
  useEffect(() => { asking = who; return () => { if (asking === who) asking = null } }, [who])
  useEffect(() => (who ? crewChipKeys(window, () => { void addCrew(who); offered.add(who); setWho(null) }, () => { offered.add(who); setWho(null) }) : undefined), [who])
  if (!who) return null
  const keys = finePointer()
  return (
    <div className="terrain-crew-chip" role="group" aria-label={`Build with ${name}?`}
      style={{ position: 'absolute', left: '50%', top: 'calc(50% - 96px)', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 12px', background: 'rgba(0,0,0,0.55)', color: '#fff', textShadow: '0 1px 2px #000', fontSize: 13, pointerEvents: 'auto', clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)' }}>
      <UserPlus size={14} strokeWidth={2.25} aria-hidden />
      <span>Build with {name}?</span>
      <button type="button" className="terrain-key" style={{ cursor: 'pointer', background: 'transparent' }} onClick={() => { void addCrew(who); done() }} aria-keyshortcuts="Enter">ADD{keys ? ' (ENTER)' : ''}</button>
      <ModalClose onClose={done} label={`Not now: ${name}`} title={keys ? 'Not now (Backspace, or Esc)' : 'Not now'} />
      {keys && <kbd className="terrain-key" aria-hidden>⌫</kbd>}
    </div>
  )
}

function CrewMark(): JSX.Element | null {
  const kind = useAim((a) => a.kind)
  if (kind !== 'crew') return null
  return (
    <span className="terrain-crew-mark" aria-label="Their crew: your changes are shared" title="Their crew: your changes are shared"
      style={{ position: 'absolute', left: 'calc(50% + 14px)', top: 'calc(50% + 6px)', color: '#7cffc4', pointerEvents: 'none', filter: 'drop-shadow(0 1px 1px #000)' }}>
      <Users size={12} strokeWidth={2.5} aria-hidden />
    </span>
  )
}

/** The one-line hint the first time you aim at someone else's block, per builder. */
function useAmberHint(): void {
  useEffect(() => useAim.subscribe((a, was) => {
    if (a.kind !== 'other' || !a.author || (was.kind === a.kind && was.author === a.author)) return
    const author = a.author
    void hintOnce(author).then((show) => {
      if (!show) return
      const n = crewName(author)
      useTerrain.getState().say(`${n}'s build. Your changes show for you. Ask ${n} to add you to their crew.`)
    })
  }), [])
}

export function TerrainCrew(): JSX.Element {
  useAmberHint()
  return (
    <>
      <CrewChip />
      <CrewMark />
    </>
  )
}
