/**
 * BlueprintsModal.tsx - ITEMS › BLUEPRINTS: the blueprints this identity
 * holds, and the prizes its builds made (design page craft-design/block-uses,
 * section 4 and 4.5). Opened by the panel's third button or one of its tiles
 * (BlueprintsGrid), stacked over the menu as KEY ITEMS and OTHER LOOT are
 * (modalStack), and closed by the shared ✕, a tap outside or Escape.
 *
 * Tabs, as the design page has them (FEED comes later):
 * - MINE: the blueprints you made. You see the whole arrangement; SEE AS A
 *   FINDER flips the picture and EXAMINE to what a finder is shown.
 * - HELD: the blueprints you found, in the world, a chest or behind a door.
 * - BUILT: prizes from your smashes still waiting to be taken, each with
 *   TAKE, then the blueprints you have built and how many times.
 * - ARCHIVED, once something is filed away: UNARCHIVE brings it back. A
 *   blueprint is never deleted by a tap here.
 *
 * Each row: the 80px chamfered smoke model, the title, who made it and who
 * left it there, its three settings in one short line, and one ACTIONS
 * button opening EXAMINE, PLACE HERE, PUT IN A CHEST and ARCHIVE under the
 * row (InventoryPanel useRowActions: one row's actions open at a time across
 * ITEMS).
 *
 * Opening the list is looking at it: every card in it is seen (NEW, kept per
 * identity by store/useItemsSeen). The rows that were NEW when it opened
 * keep saying so while it stays open.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Hammer, PackageCheck, DraftingCompass } from 'lucide-react'
import { create } from 'zustand'
import { fromPayload } from 'sno-core/shards'
import { useProfile } from '../../hooks/useProfile'
import { keepOwnTable } from '../../lib/carried'
import { nameLabel } from '../../lib/nameLabel'
import { formatAgo, formatStamp } from '../../lib/time'
import { blueprintSeenAs, isNewBlueprint } from '../../lib/itemsSeen'
import type { BlueprintCard, ToyRow } from '../../lib/blueprint/blueprintDb'
import {
  cellsFromBytes, finderView, fromBase64, fullView, readRecord,
  type FinderView, type LockKind, type PrizeReveal, type RecordView,
} from '../../lib/blueprint/format'
import { takeToy } from '../../lib/blueprint/smashRun'
import { startPlaceBlueprint } from '../../lib/blueprint/place'
import { useBlueprints } from '../../store/useBlueprints'
import { useCyberspace } from '../../store/useCyberspace'
import { useItemsSeen } from '../../store/useItemsSeen'
import { ItemThumb } from '../ItemThumb'
import { NewChip, useOpenActions, useRowActions } from '../InventoryPanel'
import { Chamfer, THUMB_PX } from '../ui/Chamfer'
import { ModalClose } from '../ui/ModalClose'
import { Stacked, useModalStack } from '../modalStack'
import { BlueprintModel } from './BlueprintModel'
import { ExamineSheet } from './ExamineSheet'

/** The panel's third button and the modal's title. */
export const BLUEPRINTS_LABEL = 'BLUEPRINTS'
export const BLUEPRINTS_ICON = DraftingCompass
export const NO_BLUEPRINTS = 'No blueprints yet.'
export const NO_MINE = 'None of your own yet. Make one in BUILD with the BLUEPRINT tool.'
export const NO_HELD = 'None found yet. Blueprints wait in the world, in chests and behind doors.'
export const NO_BUILT = 'Nothing built yet. Build a blueprint and smash it with the Compiler.'

/** Whether BLUEPRINTS is open, and the row a tile was tapped for. A store, so a tile, the tutorial or a test can open it. */
export const useBlueprintsModal = create<{ open: boolean; focus: string | null }>(() => ({ open: false, focus: null }))

export type BlueprintsTab = 'mine' | 'held' | 'built' | 'archived'

/** A card read for drawing: its record, what a finder sees, and for its maker the whole arrangement. */
export interface CardViews {
  record: RecordView
  finder: FinderView
  /** The maker's own view, every block shown; null for a card you found. */
  full: FinderView | null
}

/** The whole arrangement from the maker's secret, or null when there is none or it does not fit its box. */
export function makerView(secret: BlueprintCard['secret']): FinderView | null {
  if (!secret) return null
  const bytes = fromBase64(secret.cells)
  if (!bytes) return null
  const cells = cellsFromBytes(bytes)
  const [x, y, z] = secret.size
  if (cells.length !== x * y * z || !cells.some((id) => id > 0)) return null
  return fullView({ size: [x, y, z], cells })
}

/** A card as the rows and tiles draw it, or null when its record does not read (it is then not listed). */
export function cardViews(card: BlueprintCard): CardViews | null {
  const record = readRecord(card.record)
  if (!record) return null
  return { record, finder: finderView(record), full: card.source === 'made' ? makerView(card.secret) : null }
}

const PRIZE_SHORT: Record<PrizeReveal, string> = {
  hidden: 'prize kept secret',
  description: 'prize described',
  silhouette: 'prize as a silhouette',
  render: 'prize in pictures',
}
const LOCK_SHORT: Record<LockKind, string> = { standard: 'works anywhere', location: 'only in its region' }

/** The three settings in one short line, as a finder sees them: "45 of 47 blocks shown · prize as a silhouette · works anywhere". */
export function settingsLine(v: Pick<CardViews, 'record' | 'finder'>): string {
  const total = v.finder.occupied.reduce((n, o) => n + (o ? 1 : 0), 0)
  const shown = v.finder.revealed.size
  return `${shown} of ${total} blocks shown · ${PRIZE_SHORT[v.record.sheet.prize.reveal]} · ${LOCK_SHORT[v.record.sheet.lock]}`
}

/** Which tab a card is listed under. */
export function tabOf(card: Pick<BlueprintCard, 'source' | 'archived'>): BlueprintsTab {
  if (card.archived) return 'archived'
  return card.source === 'made' ? 'mine' : 'held'
}

/** A person's name over a blueprint: "you", their display name, or a short npub. */
function Who({ pubkey }: { pubkey: string }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const profile = useProfile(pubkey && pubkey !== me ? pubkey : null)
  return <>{nameLabel(pubkey, me, profile?.name)}</>
}

/** A row a tile was tapped for: scrolled to the middle of the list, so the eye lands on it. */
function useFocused(focused: boolean): RefObject<HTMLLIElement> {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => { if (focused) ref.current?.scrollIntoView?.({ block: 'center' }) }, [focused])
  return ref
}

/** One blueprint: its smoke model, its words and settings, and its ACTIONS. */
export function BlueprintRow({ card, views, fresh = false, focused = false }: { card: BlueprintCard; views: CardViews; fresh?: boolean; focused?: boolean }): JSX.Element {
  const actions = useRowActions(card.rowKey, views.record.title)
  const ref = useFocused(focused)
  const [asFinder, setAsFinder] = useState(false)
  const [examining, setExamining] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const makerName = useProfile(card.record.pubkey)?.name
  const me = useCyberspace((s) => s.identity.pubkey)
  // The maker sees the whole arrangement until SEE AS A FINDER is on.
  const view = views.full && !asFinder ? views.full : views.finder
  const name = views.record.title
  const place = (where: 'here' | 'chest'): void => {
    setRefusal(null)
    const why: unknown = startPlaceBlueprint(card, where)
    if (typeof why === 'string' && why) setRefusal(why)
  }
  const archive = (on: boolean): void => {
    actions.close()
    useBlueprints.getState().archive(card.rowKey, on)
  }
  const prize = views.record.sheet.prize
  return (
    <li ref={ref} className={`secrets__row held__row held__row--loot bp-items__row${focused ? ' held__row--focus' : ''}`} data-actions-row={card.rowKey} data-blueprint={card.rowKey}>
      <Chamfer className="bp-items__thumb" decorative={false}>
        <BlueprintModel view={view} size={THUMB_PX} label={views.full && !asFinder ? `${name}: every block, as you made it` : `${name}: as a finder sees it`} />
      </Chamfer>
      <span className="item__line held__line">
        <span className="item__name" title={name}>{name}</span>
        <span className="item__meta held__meta">
          <span className="held__src">by <Who pubkey={card.record.pubkey} /></span>
          <span className="held__age">{' · '}<span title={formatStamp(card.at)}>{formatAgo(card.at)}</span></span>
        </span>
        {/* On a line of its own, so neither name is cut to make room for the other. */}
        {card.leftBy && <span className="item__meta held__meta"><span className="held__src">left here by <Who pubkey={card.leftBy} /></span></span>}
        <span className="bp-items__settings">{settingsLine(views)}</span>
        <span className="held__chips">
          {fresh && <NewChip />}
          {!!card.built && <span className="item__chip secrets__found" title="Times you have built it">BUILT {card.built === 1 ? 'ONCE' : `${card.built} TIMES`}</span>}
          {views.full && asFinder && <span className="item__chip" title="Shown as a finder sees it">AS A FINDER</span>}
          {card.archived && <span className="item__chip item__chip--dim" title="Filed away under ARCHIVED">ARCHIVED</span>}
        </span>
      </span>
      <span className="held__acts">{actions.button}</span>
      {actions.group(
        <>
          <button className="chest__act" onClick={() => setExamining(true)} title="Every clue on one drafting sheet">EXAMINE</button>
          {views.full && (
            <button className={`chest__act ${asFinder ? 'is-on' : ''}`} onClick={() => setAsFinder((f) => !f)} aria-pressed={asFinder} title="Show it as a finder sees it, or every block as you made it">SEE AS A FINDER</button>
          )}
          {!card.archived && <button className="chest__act" onClick={() => place('here')} title="Leave it where you stand, for others to find. They each take a copy">PLACE HERE</button>}
          {!card.archived && <button className="chest__act" onClick={() => place('chest')} title="Put a copy in one of your chests">PUT IN A CHEST</button>}
          {card.archived
            ? <button className="chest__act" onClick={() => archive(false)} title="Back to its list">UNARCHIVE</button>
            : <button className="chest__act" onClick={() => archive(true)} title="File it away under ARCHIVED">ARCHIVE</button>}
        </>,
      )}
      {refusal && <span className="held__refusal" role="status">{refusal}</span>}
      {examining && (
        <ExamineSheet
          onClose={() => setExamining(false)}
          bp={{
            name,
            maker: nameLabel(card.record.pubkey, me, makerName),
            description: prize.text ?? '',
            view,
            prize: { reveal: prize.reveal, text: prize.text, views: views.record.views, title: name },
            lock: views.record.sheet.lock,
            height: views.record.sheet.height,
            drawnAt: card.record.created_at,
            revision: 1,
          }}
        />
      )}
    </li>
  )
}

/** A prize's model, when it is a shard. */
function prizeModel(toy: ToyRow): ReturnType<typeof fromPayload> | null {
  if (toy.prize.type !== 'sno') return null
  const s = fromPayload(toy.prize.payload, toy.rowKey)
  return s ? keepOwnTable(s, toy.maker) : null
}

/** A prize waiting to be taken: its picture, name, maker, and TAKE. */
export function PrizeRow({ toy }: { toy: ToyRow }): JSX.Element {
  const shard = useMemo(() => prizeModel(toy), [toy])
  const [refusal, setRefusal] = useState<string | null>(null)
  const tool = toy.prize.type === 'tool'
  return (
    <li className="secrets__row held__row held__row--loot bp-items__row bp-items__row--prize" data-prize={toy.rowKey}>
      {shard
        ? <ItemThumb type="shard" shard={shard} />
        : <Chamfer className="bp-items__thumb"><Hammer className="bp-items__tool" size={34} strokeWidth={1.5} aria-hidden /></Chamfer>}
      <span className="item__line held__line">
        <span className="item__name" title={toy.name}>{toy.name}</span>
        <span className="item__meta held__meta">
          <span className="held__src">by {toy.maker === 'game' ? 'a starter recipe' : <Who pubkey={toy.maker} />}</span>
          <span className="held__age">{' · built '}<span title={formatStamp(toy.made)}>{formatAgo(toy.made)}</span></span>
        </span>
        <span className="bp-items__settings">{tool ? 'A tool. It sits in slot 1 for good.' : 'A shard. TAKE puts it in OTHER LOOT.'}</span>
      </span>
      <span className="held__acts">
        <button className="chest__act bp-items__take" onClick={() => { if (!takeToy(toy.rowKey)) setRefusal('This prize could not be taken.') }} title="Take it into your ITEMS">
          <PackageCheck size={12} strokeWidth={2.25} aria-hidden />TAKE
        </button>
      </span>
      {refusal && <span className="held__refusal" role="status">{refusal}</span>}
    </li>
  )
}

/** A card with what it draws, or nothing when its record does not read. */
interface Listed { card: BlueprintCard; views: CardViews }

/** Every card that reads, newest first. */
export function useListedCards(): Listed[] {
  const cards = useBlueprints((s) => s.cards)
  return useMemo(() => {
    const out: Listed[] = []
    for (const card of [...cards].sort((a, b) => b.at - a.at)) {
      const views = cardViews(card)
      if (views) out.push({ card, views })
    }
    return out
  }, [cards])
}

export function BlueprintsModal(): JSX.Element {
  const close = useCallback((): void => useBlueprintsModal.setState({ open: false, focus: null }), [])
  useModalStack(true, close)
  const listed = useListedCards()
  const toys = useBlueprints((s) => s.toys)
  const owner = useBlueprints((s) => s.owner)
  const by = useMemo(() => {
    const t: Record<BlueprintsTab, Listed[]> = { mine: [], held: [], built: [], archived: [] }
    for (const l of listed) {
      t[tabOf(l.card)].push(l)
      if (!l.card.archived && l.card.built) t.built.push(l)
    }
    return t
  }, [listed])
  const [focus] = useState(() => useBlueprintsModal.getState().focus ?? null)
  const [tab, setTab] = useState<BlueprintsTab>(() => {
    const f = focus ? listed.find((l) => l.card.rowKey === focus) : undefined
    if (f) return tabOf(f.card)
    if (by.mine.length) return 'mine'
    if (by.held.length) return 'held'
    if (toys.length || by.built.length) return 'built'
    return 'mine'
  })
  const showing: BlueprintsTab = tab === 'archived' && by.archived.length === 0 ? 'mine' : tab

  // Opening the list is looking at it: every card is seen, once this identity's record has been read.
  const me = owner || useCyberspace.getState().identity.pubkey
  const seenReady = useItemsSeen((s) => s.ready && !!me && s.owner === me)
  const fresh = useRef<Set<string> | null>(null)
  if (fresh.current === null && seenReady) {
    const { seen } = useItemsSeen.getState()
    fresh.current = new Set(listed.filter((l) => isNewBlueprint(seen, l.card)).map((l) => l.card.rowKey))
  }
  useEffect(() => {
    if (!seenReady) return
    useItemsSeen.getState().markKind('blueprints', listed.map((l) => blueprintSeenAs(l.card)))
    useBlueprints.getState().markSeen()
  }, [seenReady, listed])
  // A tile tapped for one row: its ACTIONS open and their button focused.
  useEffect(() => {
    if (!focus) return
    useOpenActions.setState({ open: focus })
    if (typeof document !== 'undefined') document.getElementById?.(`held-actions-${focus}-toggle`)?.focus?.()
  }, [focus])

  const row = (l: Listed): JSX.Element => (
    <BlueprintRow key={l.card.rowKey} card={l.card} views={l.views} fresh={fresh.current?.has(l.card.rowKey) ?? false} focused={l.card.rowKey === focus} />
  )
  const tabButton = (id: BlueprintsTab, label: string): JSX.Element => (
    <button className={`tag tag--tap ${showing === id ? 'is-on' : ''}`} role="tab" aria-selected={showing === id} onClick={() => setTab(id)}>{label}</button>
  )
  const Icon = BLUEPRINTS_ICON
  return (
    <Stacked>
      <div className="modal items-modal items-modal--blueprints" role="dialog" aria-modal="true" aria-label="Blueprints" onPointerDown={close}>
        <div className="modal__card secrets__box items-modal__card" onPointerDown={(e) => e.stopPropagation()}>
          <header className="panel__head secrets__head">
            <h2 className="items-modal__title"><Icon className="items-modal__icon" size={14} strokeWidth={2.5} aria-hidden />{BLUEPRINTS_LABEL}</h2>
            <ModalClose onClose={close} />
          </header>
          <div className="held__views">
            <span className="held__tabs" role="tablist">
              {tabButton('mine', `MINE ${by.mine.length}`)}
              {tabButton('held', `HELD ${by.held.length}`)}
              {tabButton('built', `BUILT ${toys.length + by.built.length}`)}
              {by.archived.length > 0 && tabButton('archived', `ARCHIVED ${by.archived.length}`)}
            </span>
          </div>
          <div className="items-modal__scroll">
            {showing === 'built' ? (
              <>
                {toys.length > 0 && <span className="legend__label">WAITING TO BE TAKEN</span>}
                {toys.length > 0 && <ul className="secrets__list held__list">{toys.map((t) => <PrizeRow key={t.rowKey} toy={t} />)}</ul>}
                {by.built.length > 0 && <span className="legend__label">YOU HAVE BUILT</span>}
                <ul className="secrets__list held__list">
                  {toys.length === 0 && by.built.length === 0 && <li className="secrets__empty">{NO_BUILT}</li>}
                  {by.built.map(row)}
                </ul>
              </>
            ) : (
              <ul className="secrets__list held__list">
                {by[showing].length === 0 && <li className="secrets__empty">{showing === 'held' ? NO_HELD : NO_MINE}</li>}
                {by[showing].map(row)}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Stacked>
  )
}
