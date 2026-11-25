/**
 * CrewPanel.tsx - the Crew in TERRAIN's bag (store/terrainShare.ts), drawn
 * to be read at a glance (owner, 2026-11-25: "the layout is awful. have a
 * designer subagent redesign the crew area of the inventory").
 *
 * Your Crew are the people whose changes to blocks you built count as yours,
 * so everyone sees one shared build. One list for everything you build, and
 * changing it never asks a signer: this device's building key publishes your
 * blocks again with the new list.
 *
 * - The head: what a Crew is, in one line, and ADD TO YOUR CREW under it, in
 *   the same place whatever the lists hold.
 * - YOUR CREW (can build on yours) and CREWS YOU'RE IN (you build on theirs:
 *   builders whose layers list you). One row per person, every row the same
 *   height: their picture in a chamfered frame, their name (or a short npub),
 *   and a side slot of one width, so a row's controls never move. Someone in
 *   both lists wears MUTUAL; someone who lets you build on theirs but is not
 *   in yours has ADD BACK.
 * - Taking someone off is never one tap: the row's button opens a confirm
 *   that says what happens.
 * - The picker: a search over the people you follow by name, or any npub
 *   pasted, each with ADD; someone added stays in place, marked.
 *
 * The picker and the confirm sit over the bag, beside its card rather than
 * inside it (the card is clipped to its chamfer), as CrewLayer: the bag
 * renders it, and Esc closes it before the bag (closeCrewLayer).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { create } from 'zustand'
import { nip19 } from 'nostr-tools'
import { ArrowLeftRight, Check, Search, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { addCrew, removeCrew, useShare } from '../store/terrainShare'
import { useCyberspace } from '../store/useCyberspace'
import { useProfiles, type Profile } from '../store/useProfiles'
import { useProfile } from '../hooks/useProfile'
import { followsOf } from '../lib/contacts'
import { safeNpub } from '../lib/npub'
import { targetColor } from '../lib/targets'
import { COBUILDERS_MAX } from '../lib/terrain/blockLayer'
import { Chamfer } from '../hud/ui/Chamfer'
import { ModalClose } from '../hud/ui/ModalClose'

/** Every face in a Crew row, CSS pixels: one size for every row, the picker's too. */
export const CREW_FACE_PX = 40
/** How many people the picker lists at once (a long follow list is searched, not scrolled through). */
export const PICKER_SHOWN = 60
/** How many of the people you follow have their names looked up when the picker opens, so a name search reaches past the first screen. */
export const PICKER_NAMES = 1000

/** The one-line explanation under CREW. */
export const CREW_WHAT = 'Your crew’s changes to blocks you built count as yours: everyone sees one shared build. Changing it never asks your signer.'
/** What taking someone off does, said in the confirm. */
export const CREW_REMOVE_WHAT = 'Their edits stay theirs; they just stop counting on your builds.'

/** A pubkey from what was typed: an npub or 64 hex; null when it is neither. */
export function crewInput(text: string): string | null {
  const t = text.trim()
  if (/^[0-9a-f]{64}$/.test(t)) return t
  try {
    const d = nip19.decode(t)
    return d.type === 'npub' ? (d.data as string) : null
  } catch { return null }
}

/** A short npub for a row: its start and its end. */
export function shortNpub(pubkey: string): string {
  const n = safeNpub(pubkey)
  return n.length > 20 ? `${n.slice(0, 10)}…${n.slice(-4)}` : n
}

/** A person's name for a row: their profile's, else the short npub. */
export function crewLabel(pubkey: string, profile: Profile | null | undefined): string {
  return profile?.name?.trim() || shortNpub(pubkey)
}

/**
 * Whom the picker lists for what was typed: `direct` is a pubkey pasted (an
 * npub or hex), `list` the people you follow that match, in the order given
 * (the picker gives the newest follows first), never you, at most
 * PICKER_SHOWN. A name matches anywhere in it, whatever the case; an npub
 * only from its start, and only when what was typed starts npub1, so a short
 * name search does not find a crowd of keys.
 */
export function pickerMatches(typed: string, follows: string[], profiles: Record<string, Profile | null>, me: string): { direct: string | null; list: string[] } {
  const q = typed.trim()
  const others = follows.filter((p) => p !== me)
  const pasted = crewInput(q)
  if (pasted) return { direct: pasted === me ? null : pasted, list: [] }
  if (!q) return { direct: null, list: others.slice(0, PICKER_SHOWN) }
  const low = q.toLowerCase()
  const byKey = low.startsWith('npub1')
  const list = others.filter((p) => (byKey ? safeNpub(p).startsWith(low) : !!profiles[p]?.name?.toLowerCase().includes(low)))
  return { direct: null, list: list.slice(0, PICKER_SHOWN) }
}

// ---------------------------------------------------------------------------------------------------------------
// What is open over the bag: the picker, or the confirm for one person.

type CrewLayerState = { open: null | { kind: 'add' } | { kind: 'remove'; pubkey: string } }

export const useCrewLayer = create<CrewLayerState>(() => ({ open: null }))

/** Close the picker or the confirm, if one is open: TERRAIN's Esc does this before it closes the bag. True when one was. */
export function closeCrewLayer(): boolean {
  if (!useCrewLayer.getState().open) return false
  useCrewLayer.setState({ open: null })
  return true
}

// ---------------------------------------------------------------------------------------------------------------
// A person, the same way everywhere here.

/** Their kind 0 picture in a chamfered frame; with none, their initial in white on a tint of their own colour. */
function CrewFace({ pubkey, lit = false }: { pubkey: string; lit?: boolean }): JSX.Element {
  const profile = useProfile(pubkey)
  const [broken, setBroken] = useState(false)
  const pic = profile?.picture && !broken ? profile.picture : null
  const initial = crewLabel(pubkey, profile).replace(/^npub1/, '').slice(0, 1).toUpperCase()
  return (
    <Chamfer size={CREW_FACE_PX} className={`crew-face${lit ? ' is-lit' : ''}`}>
      {pic
        ? <img className="crew-face__pic" src={pic} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <span className="crew-face__initial" style={{ '--face': targetColor(pubkey) } as CSSProperties}>{initial}</span>}
    </Chamfer>
  )
}

function CrewName({ pubkey }: { pubkey: string }): JSX.Element {
  const profile = useProfile(pubkey)
  return <span className="crew-row__name" title={safeNpub(pubkey)}>{crewLabel(pubkey, profile)}</span>
}

/** Both of you list each other. */
function Mutual(): JSX.Element {
  return (
    <span className="crew-mutual" title="You’re in each other’s crews">
      <ArrowLeftRight size={11} strokeWidth={2.5} aria-hidden />MUTUAL
    </span>
  )
}

/** One person's row: face, name, short npub, and a side slot of one width. */
function CrewRow({ pubkey, lit, side }: { pubkey: string; lit?: boolean; side: ReactNode }): JSX.Element {
  return (
    <li className="crew-row">
      <CrewFace pubkey={pubkey} lit={lit} />
      <span className="crew-row__who">
        <CrewName pubkey={pubkey} />
        <span className="crew-row__npub">{shortNpub(pubkey)}</span>
      </span>
      <span className="crew-row__side">{side}</span>
    </li>
  )
}

function Group({ title, sub, count, children }: { title: string; sub: string; count: number; children: ReactNode }): JSX.Element {
  return (
    <div className="crew-group" role="group" aria-label={`${title}: ${sub}`}>
      <div className="crew-group__head">
        <span className="crew-group__title">{title}</span>
        <span className="crew-group__sub">{sub}</span>
        <span className="crew-group__count"><span aria-hidden>{count}</span><span className="crew-hidden">{count === 1 ? '1 person' : `${count} people`}</span></span>
      </div>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The bag's Crew.

export function CrewPanel(): JSX.Element {
  const crew = useShare((s) => s.crew)
  const crewOf = useShare((s) => s.crewOf)
  const full = crew.length >= COBUILDERS_MAX
  return (
    <section className="crew" aria-label="Crew">
      <header className="crew__head">
        <span className="crew__badge" aria-hidden><Users size={15} strokeWidth={2.25} /></span>
        <h3 className="crew__title">CREW</h3>
      </header>
      <p className="crew__what">{CREW_WHAT}</p>
      <button type="button" className="crew-btn crew-btn--wide" onClick={() => useCrewLayer.setState({ open: { kind: 'add' } })} aria-haspopup="dialog" disabled={full} title={full ? `Your crew is full: ${COBUILDERS_MAX} people` : undefined}>
        <UserPlus size={13} strokeWidth={2.5} aria-hidden />{full ? 'YOUR CREW IS FULL' : 'ADD TO YOUR CREW'}
      </button>

      <Group title="YOUR CREW" sub="Can build on yours" count={crew.length}>
        {crew.length === 0
          ? (
            <p className="crew-empty">
              <UserPlus size={16} strokeWidth={2} aria-hidden />
              <span>Nobody yet. Add someone with the button above, with ADD TO CREW on their player card, or with ADD when “Build with…” shows as they walk near.</span>
            </p>
          )
          : (
            <ul className="crew-list">
              {crew.map((pk) => (
                <CrewRow key={pk} pubkey={pk} lit side={(
                  <>
                    {crewOf.includes(pk) && <Mutual />}
                    <button type="button" className="crew-btn crew-btn--icon" onClick={() => useCrewLayer.setState({ open: { kind: 'remove', pubkey: pk } })} aria-haspopup="dialog" aria-label="Take off your crew…" title="Take off your crew…">
                      <UserMinus size={13} strokeWidth={2.25} aria-hidden />
                    </button>
                  </>
                )} />
              ))}
            </ul>
          )}
      </Group>

      <Group title="CREWS YOU’RE IN" sub="You build on theirs" count={crewOf.length}>
        {crewOf.length === 0
          ? (
            <p className="crew-empty">
              <Users size={16} strokeWidth={2} aria-hidden />
              <span>Nobody has added you yet. A friend adds you with ADD TO CREW on your player card.</span>
            </p>
          )
          : (
            <ul className="crew-list">
              {crewOf.map((pk) => (
                <CrewRow key={pk} pubkey={pk} side={crew.includes(pk)
                  ? <Mutual />
                  : <button type="button" className="crew-btn" onClick={() => { void addCrew(pk) }} disabled={full} title={full ? `Your crew is full: ${COBUILDERS_MAX} people` : 'Let them build on yours too'}>ADD BACK</button>} />
              ))}
            </ul>
          )}
      </Group>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Over the bag: the picker and the confirm.

/** Whether the device has a mouse: the search box takes the focus then (on a phone that would raise the keyboard unasked). */
const finePointer = (): boolean => { try { return window.matchMedia('(pointer: fine)').matches } catch { return false } }

function Picker(): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const crew = useShare((s) => s.crew)
  const profiles = useProfiles((s) => s.profiles)
  const [typed, setTyped] = useState('')
  const [follows, setFollows] = useState<string[] | null>(null)
  const [why, setWhy] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  const close = (): void => { useCrewLayer.setState({ open: null }) }
  // Newest follows first (a contact list adds at its end), and their names asked for now, in the profile store's batches.
  useEffect(() => {
    if (!me) { setFollows([]); return }
    let on = true
    followsOf(me).then((l) => {
      if (!on) return
      const newest = [...l].reverse()
      setFollows(newest)
      const { request } = useProfiles.getState()
      for (const pk of newest.slice(0, PICKER_NAMES)) if (pk !== me) request(pk)
    }).catch(() => { if (on) setFollows([]) })
    return () => { on = false }
  }, [me])
  useEffect(() => { if (finePointer()) input.current?.focus() }, [])
  const { direct, list } = useMemo(() => pickerMatches(typed, follows ?? [], profiles, me), [typed, follows, profiles, me])
  const full = crew.length >= COBUILDERS_MAX
  // Read back from the store once it is done: a second tap that found them already in is no failure.
  const add = (pk: string): void => {
    void addCrew(pk).then(() => {
      const now = useShare.getState().crew
      setWhy(now.includes(pk) ? '' : now.length >= COBUILDERS_MAX ? `Your crew is full: ${COBUILDERS_MAX} people.` : 'That one could not be added.')
    })
  }
  const side = (pk: string): ReactNode => crew.includes(pk)
    ? <span className="crew-added"><Check size={12} strokeWidth={2.75} aria-hidden />ADDED</span>
    : <button type="button" className="crew-btn" onClick={() => add(pk)} disabled={full} aria-label={`Add ${crewLabel(pk, profiles[pk])} to your crew`}>ADD</button>
  const q = typed.trim()
  const typedMe = !!q && crewInput(q) === me
  const label = direct ? 'PASTED KEY' : q ? 'PEOPLE YOU FOLLOW: MATCHES' : 'PEOPLE YOU FOLLOW'
  let empty: string | null = null
  if (typedMe) empty = 'That’s you: your own blocks are always yours.'
  else if (!direct && list.length === 0) {
    if (follows === null) empty = 'Looking up the people you follow…'
    else if (q && (follows.slice(0, PICKER_NAMES).some((p) => profiles[p] === undefined))) empty = 'Nobody yet: still looking up names. Or paste their npub to add anyone.'
    else if (q) empty = 'Nobody you follow matches. Paste their npub to add anyone.'
    else empty = 'You don’t follow anyone yet. Paste an npub above to add anyone.'
  }
  return (
    <div className="terrain-sheet__card crew-layer__card crew-layer__card--picker" role="dialog" aria-modal="true" aria-label="Add to your crew">
      <div className="terrain-sheet__head">
        <UserPlus size={16} strokeWidth={2} aria-hidden />
        <h2>ADD TO YOUR CREW</h2>
        <ModalClose onClose={close} title="Close (Esc)" />
      </div>
      <p className="crew-layer__sub">Search the people you follow by name, or paste anyone’s npub.</p>
      <div className="crew-search" role="search">
        <Search className="crew-search__icon" size={14} strokeWidth={2.25} aria-hidden />
        <input
          ref={input}
          className="crew-search__input"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={typed}
          placeholder="Name or npub1…"
          aria-label="Search by name, or paste an npub"
          onChange={(e) => { setTyped(e.target.value); setWhy('') }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (typed) setTyped(''); else close() }
            else if (e.key === 'Enter') { if (direct) add(direct); else (e.target as HTMLInputElement).blur() }
          }}
        />
        {/* Over the box, so it coming and going moves nothing. */}
        {typed !== '' && (
          <button type="button" className="crew-search__clear" onClick={() => { setTyped(''); input.current?.focus() }} aria-label="Clear the search" title="Clear the search">
            <X size={13} strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>
      <p className="crew-layer__status" role="status">{why}</p>
      <div className="crew-group crew-group--fill">
        <div className="crew-group__head">
          <span className="crew-group__title">{label}</span>
        </div>
        <div className="crew-layer__scroll">
          {empty
            ? <p className="crew-empty"><Users size={16} strokeWidth={2} aria-hidden /><span>{empty}</span></p>
            : (
              <ul className="crew-list">
                {direct && <CrewRow key={direct} pubkey={direct} lit={crew.includes(direct)} side={side(direct)} />}
                {list.map((pk) => <CrewRow key={pk} pubkey={pk} lit={crew.includes(pk)} side={side(pk)} />)}
              </ul>
            )}
        </div>
      </div>
    </div>
  )
}

function Confirm({ pubkey }: { pubkey: string }): JSX.Element {
  const profile = useProfile(pubkey)
  const name = crewLabel(pubkey, profile)
  const keep = useRef<HTMLButtonElement | null>(null)
  const close = (): void => { useCrewLayer.setState({ open: null }) }
  // KEEP takes the focus (Enter then keeps them); the button that opened the confirm gets it back on closing.
  useEffect(() => {
    const opener = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null
    keep.current?.focus()
    return () => { if (opener?.isConnected) opener.focus() }
  }, [])
  const takeOff = (): void => { void removeCrew(pubkey); close() }
  return (
    <div className="terrain-sheet__card crew-layer__card crew-layer__card--confirm" role="alertdialog" aria-modal="true" aria-label={`Take ${name} off your crew?`} aria-describedby="crew-confirm-what">
      <div className="terrain-sheet__head">
        <UserMinus size={16} strokeWidth={2} aria-hidden />
        <h2>TAKE OFF YOUR CREW</h2>
        <ModalClose onClose={close} title="Keep them (Esc)" label="Keep them" />
      </div>
      <div className="crew-confirm__who">
        <CrewFace pubkey={pubkey} lit />
        <span className="crew-row__who">
          <span className="crew-row__name">{name}</span>
          <span className="crew-row__npub">{shortNpub(pubkey)}</span>
        </span>
      </div>
      <p className="crew-confirm__ask">Take {name} off your crew?</p>
      <p className="crew-layer__sub" id="crew-confirm-what">{CREW_REMOVE_WHAT}</p>
      <div className="crew-pair">
        <button ref={keep} type="button" className="crew-btn" onClick={close}>KEEP</button>
        <button type="button" className="crew-btn crew-btn--danger" onClick={takeOff}><UserMinus size={13} strokeWidth={2.5} aria-hidden />TAKE OFF</button>
      </div>
    </div>
  )
}

/** The picker or the confirm over the bag; a tap on the dark around it closes it. Gone with the bag. */
export function CrewLayer(): JSX.Element | null {
  const open = useCrewLayer((s) => s.open)
  useEffect(() => () => { useCrewLayer.setState({ open: null }) }, [])
  if (!open) return null
  return (
    // On the click, not the press: closing on the press would hand a phone's click to whatever of the bag is under the finger then.
    <div className="crew-layer" onClick={(e) => { if (e.target === e.currentTarget) closeCrewLayer() }}>
      {open.kind === 'add' ? <Picker /> : <Confirm key={open.pubkey} pubkey={open.pubkey} />}
    </div>
  )
}
