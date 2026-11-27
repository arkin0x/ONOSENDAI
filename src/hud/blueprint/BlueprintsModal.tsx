/**
 * BlueprintsModal.tsx - ITEMS › BLUEPRINTS: the blueprints this identity
 * holds, and the prizes its builds made (design page craft-design/block-uses,
 * section 4 and 4.5). Opened by the panel's third button or one of its tiles
 * (BlueprintsGrid), stacked over the menu as KEY ITEMS and OTHER LOOT are
 * (modalStack), and closed by the shared ✕, a tap outside or Escape.
 *
 * Tabs, as the design page has them (FEED comes later):
 * - MINE: the blueprints you made. The picture shows the whole arrangement;
 *   EXAMINE opens on what a finder gets, with a switch to every block.
 * - HELD: the blueprints you found, in the world, a chest or behind a door.
 * - BUILT: prizes from your smashes still waiting to be taken, each with
 *   TAKE, then the blueprints you have built and how many times.
 * - ARCHIVED, once something is filed away: UNARCHIVE brings it back. A
 *   blueprint is never deleted by a tap here. ARCHIVE leaves a line in the
 *   row's place for a few seconds with UNDO, so a stray tap costs nothing.
 *
 * Each row: the 80px chamfered smoke model, the title, who made it and who
 * left it there, its three settings in one short line, and its actions:
 * EXAMINE, PLACE HERE, PUT IN A CHEST and ARCHIVE. On a wide screen they sit
 * on the row itself; on a phone (under 520px) one ACTIONS button opens them
 * under the row (InventoryPanel useRowActions: one row's actions open at a
 * time across ITEMS). Never both.
 *
 * Opening the list is looking at it: every card in it is seen (NEW, kept per
 * identity by store/useItemsSeen). The rows that were NEW when it opened
 * keep saying so while it stays open.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Archive, Hammer, PackageCheck, DraftingCompass, Undo2 } from 'lucide-react'
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
  type FinderView, type RecordView,
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
import { ExamineSheet, constructionWords, materialsWords, prizeShort } from './ExamineSheet'

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

/**
 * A card's summary as a finder sees it, in the sheet's words and order:
 * MATERIALS, CONSTRUCTION, PRIZE.
 */
export function settingsParts(v: Pick<CardViews, 'record' | 'finder'>): Array<[string, string]> {
  const total = v.finder.occupied.reduce((n, o) => n + (o ? 1 : 0), 0)
  const known = v.finder.revealed.size
  return [
    ['MATERIALS', materialsWords(known, total - known)],
    ['CONSTRUCTION', constructionWords(v.record.sheet.lock, v.record.sheet.height)],
    ['PRIZE', prizeShort(v.record.sheet.prize.reveal, !!v.record.prizeName)],
  ]
}

/** The summary in one line: "MATERIALS 45 known / 2 unknown · CONSTRUCTION May be built anywhere. · PRIZE Hints only". */
export function settingsLine(v: Pick<CardViews, 'record' | 'finder'>): string {
  return settingsParts(v).map(([k, w]) => `${k} ${w}`).join(' · ')
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

/** Below this width a row's actions fold behind one ACTIONS button. */
export const NARROW_QUERY = '(max-width: 519.98px)'
/** How long ARCHIVE's UNDO stays, in the row's place. */
export const UNDO_MS = 6000

function narrowNow(): boolean {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches } catch { return false }
}

/** Whether the screen is a phone's width, following it as it turns. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(narrowNow)
  useEffect(() => {
    let mq: MediaQueryList | null = null
    try { mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null } catch { mq = null }
    if (!mq) return
    const on = (): void => setNarrow(mq?.matches ?? false)
    on()
    mq.addEventListener?.('change', on)
    return () => mq?.removeEventListener?.('change', on)
  }, [])
  return narrow
}

/** A row a tile was tapped for: scrolled to the middle of the list, so the eye lands on it. */
function useFocused(focused: boolean): RefObject<HTMLLIElement> {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => { if (focused) ref.current?.scrollIntoView?.({ block: 'center' }) }, [focused])
  return ref
}

/**
 * One blueprint: its smoke model, its words and settings, and its actions.
 * `onArchive` is told after ARCHIVE files it away, so the list can offer UNDO.
 */
export function BlueprintRow({ card, views, fresh = false, focused = false, onArchive }: { card: BlueprintCard; views: CardViews; fresh?: boolean; focused?: boolean; onArchive?: () => void }): JSX.Element {
  const narrow = useNarrow()
  const actions = useRowActions(card.rowKey, views.record.title, narrow)
  const ref = useFocused(focused)
  const [examining, setExamining] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const makerName = useProfile(card.record.pubkey)?.name
  const me = useCyberspace((s) => s.identity.pubkey)
  // Your own shows the whole arrangement; a found one what a finder sees.
  const view = views.full ?? views.finder
  const name = views.record.title
  const place = (where: 'here' | 'chest'): void => {
    setRefusal(null)
    const why: unknown = startPlaceBlueprint(card, where)
    if (typeof why === 'string' && why) setRefusal(why)
  }
  const archive = (on: boolean): void => {
    actions.close()
    useBlueprints.getState().archive(card.rowKey, on)
    if (on) onArchive?.()
  }
  const prize = views.record.sheet.prize
  const acts = (
    <>
      <button className="chest__act" onClick={() => setExamining(true)} title="Every clue on one drafting sheet">EXAMINE</button>
      {!card.archived && <button className="chest__act" onClick={() => place('here')} title="Leave it where you stand, for others to find. They each take a copy">PLACE HERE</button>}
      {!card.archived && <button className="chest__act" onClick={() => place('chest')} title="Put a copy in one of your chests">PUT IN A CHEST</button>}
      {card.archived
        ? <button className="chest__act" onClick={() => archive(false)} title="Back to its list">UNARCHIVE</button>
        : <button className="chest__act" onClick={() => archive(true)} title="File it away under ARCHIVED. UNDO brings it straight back">ARCHIVE</button>}
    </>
  )
  return (
    <li ref={ref} className={`secrets__row held__row held__row--loot bp-items__row${focused ? ' held__row--focus' : ''}`} data-actions-row={card.rowKey} data-blueprint={card.rowKey}>
      <Chamfer className="bp-items__thumb" decorative={false}>
        <BlueprintModel view={view} size={THUMB_PX} label={views.full ? `${name}: every block, as you made it` : `${name}: as a finder sees it`} />
      </Chamfer>
      <span className="item__line held__line">
        <span className="item__name" title={name}>{name}</span>
        <span className="item__meta held__meta">
          <span className="held__src">by <Who pubkey={card.record.pubkey} /></span>
          <span className="held__age">{' · '}<span title={formatStamp(card.at)}>{formatAgo(card.at)}</span></span>
        </span>
        {/* On a line of its own, so neither name is cut to make room for the other. */}
        {card.leftBy && <span className="item__meta held__meta"><span className="held__src">left here by <Who pubkey={card.leftBy} /></span></span>}
        <span className="bp-items__settings">
          {settingsParts(views).map(([k, w], i) => (
            <span className="bp-items__set" key={k}>{i > 0 && ' · '}<b>{k}</b> {w}</span>
          ))}
        </span>
        <span className="held__chips">
          {fresh && <NewChip />}
          {!!card.built && <span className="item__chip secrets__found" title="Times you have built it">BUILT {card.built === 1 ? 'ONCE' : `${card.built} TIMES`}</span>}
          {card.archived && <span className="item__chip item__chip--dim" title="Filed away under ARCHIVED">ARCHIVED</span>}
        </span>
      </span>
      {narrow ? (
        <>
          <span className="held__acts">{actions.button}</span>
          {actions.group(acts)}
        </>
      ) : (
        <span className="held__acts bp-items__acts" role="group" aria-label={`Actions for ${name}`}>{acts}</span>
      )}
      {refusal && <span className="held__refusal" role="status">{refusal}</span>}
      {examining && (
        <ExamineSheet
          onClose={() => setExamining(false)}
          maker={views.full ? { view: views.full, prizeName: views.record.prizeName } : undefined}
          bp={{
            name,
            maker: nameLabel(card.record.pubkey, me, makerName),
            description: prize.text ?? '',
            view: views.finder,
            prize: { reveal: prize.reveal, text: prize.text, views: views.record.views, name: views.record.prizeName },
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

/** A card just archived: where its row was, so UNDO can stand in its place. */
interface Undo { rowKey: string; name: string; list: BlueprintsTab; index: number }

/** The line a card leaves when it is archived: what happened, and UNDO. */
function UndoLine({ undo, onUndo }: { undo: Undo; onUndo: (u: Undo) => void }): JSX.Element {
  return (
    <li className="secrets__row bp-items__undo" data-undo={undo.rowKey} role="status">
      <Archive className="bp-items__undo-icon" size={16} strokeWidth={2} aria-hidden />
      <span className="bp-items__undo-words"><b title={undo.name}>{undo.name}</b> is filed under ARCHIVED.</span>
      <button className="chest__act bp-items__undo-go" onClick={() => onUndo(undo)} title="Bring it straight back"><Undo2 size={12} strokeWidth={2.25} aria-hidden />UNDO</button>
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

  // ARCHIVE's UNDO: a line where the row was, for a few seconds.
  const [undo, setUndo] = useState<Undo | null>(null)
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo((u) => (u === undo ? null : u)), UNDO_MS)
    return () => clearTimeout(t)
  }, [undo])
  const undoArchive = (u: Undo): void => {
    useBlueprints.getState().archive(u.rowKey, false)
    setUndo(null)
  }
  const row = (l: Listed, index: number, list: BlueprintsTab): JSX.Element => (
    <BlueprintRow
      key={l.card.rowKey}
      card={l.card}
      views={l.views}
      fresh={fresh.current?.has(l.card.rowKey) ?? false}
      focused={l.card.rowKey === focus}
      onArchive={() => setUndo({ rowKey: l.card.rowKey, name: l.views.record.title, list, index })}
    />
  )
  /** A tab's rows, with ARCHIVE's UNDO line in the place of the row just filed away. */
  const rowsOf = (list: BlueprintsTab): JSX.Element[] => {
    const out = by[list].map((l, i) => row(l, i, list))
    if (undo && undo.list === list && by.archived.some((l) => l.card.rowKey === undo.rowKey)) {
      out.splice(Math.min(undo.index, out.length), 0, <UndoLine key={`undo-${undo.rowKey}`} undo={undo} onUndo={undoArchive} />)
    }
    return out
  }
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
                  {toys.length === 0 && by.built.length === 0 && !(undo && undo.list === 'built') && <li className="secrets__empty">{NO_BUILT}</li>}
                  {rowsOf('built')}
                </ul>
              </>
            ) : (
              <ul className="secrets__list held__list">
                {by[showing].length === 0 && !(undo && undo.list === showing) && <li className="secrets__empty">{showing === 'held' ? NO_HELD : NO_MINE}</li>}
                {rowsOf(showing)}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Stacked>
  )
}
