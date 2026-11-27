/**
 * BlueprintTool.tsx - the BLUEPRINT tool in BUILD (design page 4.8): four
 * steps on one sheet, in the workshop's style (store/useBlueprintTool.ts).
 *
 * 1. ARRANGEMENT: CAPTURE FROM TERRAIN (aim at a build that stands alone,
 *    RECORD; the blocks stay where they are) or COMPOSE in a 16 by 16 by 16
 *    cage, a layer at a time, placing kinds without spending them. The cage
 *    is drawn from above as the game's top-down view shows it: +X to the
 *    right, +Z up, the black sun past the top edge (CYBERSPACE_V2 §11.1).
 * 2. PRIZE: a shard from the workshop or from ITEMS, and the blueprint's name.
 * 3. SETTINGS: the recipe reveal (an eye per block type, a tap on a block in
 *    the finder's preview to flip it, the random shortcut; everything starts
 *    revealed; a one-line summary), the prize reveal (hidden, description,
 *    silhouette or render, with the views facing the sun, from above, from +X or isometric, drawn
 *    now), and the lock (standard or location). SEE AS A FINDER opens EXAMINE.
 * 4. SEAL: the key, the sealed prize and the record, kept in ITEMS ›
 *    BLUEPRINTS › MINE until it is placed.
 */

import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, Boxes, Check, DraftingCompass, Eye, EyeOff, Lock, MapPin, Minus, Plus, Radar, RotateCcw, ScanSearch, Stamp } from 'lucide-react'
import { toPayload, type ShardModel } from 'sno-core/shards'
import { useBlueprintTool, partsList, revealSummary, shownCell, type ToolStep } from '../../store/useBlueprintTool'
import { useBlueprints } from '../../store/useBlueprints'
import { useWorkshop } from '../../store/useWorkshop'
import { useInventory } from '../../store/useInventory'
import { useCyberspace } from '../../store/useCyberspace'
import { useToast, BRIEF_TOAST_MS } from '../../store/useToast'
import { enterTerrainMode } from '../../store/padMode'
import { KINDS, blockKind, blockName } from '../../lib/terrain/blocks'
import { tileUrl } from '../../lib/terrain/tiles'
import { MAX_SIDE, PRIZE_VIEWS_SHOWN, fullView, type PrizeReveal, type PrizeView } from '../../lib/blueprint/format'
import { blockCount } from '../../lib/blueprint/arrangement'
import { SEALED_WORDS, makeBlueprint, makeRefusal, makerSecret, publishRecord } from '../../lib/blueprint/make'
import { prizeImagesWhole } from '../../lib/blueprint/prizeViews'
import { Switch } from '../ui/Switch'
import { LOCK_HEIGHT_MAX } from '../../lib/blueprint/smashRun'
import { regionKeyAt } from '../../lib/shardCrypto'
import { withAuthoredConstrain } from '../../lib/walkConstrain'
import { isKeyItem } from '../../lib/inventory'
import { ModalClose } from '../ui/ModalClose'
import { ItemThumb } from '../ItemThumb'
import { BAR_WORDS, backfillKitPrints, includedPrizes, kitPieces, prizeBar, setIncluded, type GuardInput } from '../../lib/blueprint/prizeGuard'
import { usePublished } from '../../store/usePublished'
import { modelEditedAt, modelRef, useNewestFirst } from '../ShardFolders'
import { useShardFolders } from '../../store/useShardFolders'
import { flatFolders, folderOf, isWithin, pathOf } from '../../lib/shardFolders'
import { Stacked, useModalStack } from '../modalStack'
import { BlueprintModel } from './BlueprintModel'
import { BlueprintLanding } from './BlueprintLanding'
import { ExamineSheet, constructionWords, materialsWords, prizeShort } from './ExamineSheet'
import type { Position } from '../../lib/space'
import type { NostrEvent } from '../../lib/events'

const STEPS = ['ARRANGEMENT', 'PRIZE', 'SETTINGS', 'SEAL'] as const
const VIEW_WORDS: Record<PrizeView, string> = { x: 'FROM +X', y: 'FROM ABOVE', z: 'FACING THE SUN', iso: 'ISOMETRIC' }
const REVEAL_WORDS: Record<PrizeReveal, string> = { hidden: 'HIDDEN', description: 'DESCRIPTION', silhouette: 'SILHOUETTE', render: 'RENDER' }

function Swatch({ id, size = 20 }: { id: number; size?: number }): JSX.Element {
  const k = blockKind(id)
  const style: CSSProperties = { width: size, height: size, backgroundColor: k?.color ?? 'transparent', ...(k ? { backgroundImage: `url(${tileUrl(k)})` } : {}) }
  return <span className={`bpt-swatch${k?.glow ? ' is-glow' : ''}`} style={style} aria-hidden />
}

/** The build cursor's place (BUILD rides the view's cursor): where a composed blueprint is built for a location lock. */
function cursorPlace(): { lo: Position; plane: number } {
  const cs = useCyberspace.getState()
  return { lo: { x: cs.cursor.x, y: cs.cursor.y, z: cs.cursor.z }, plane: cs.plane }
}

/** A region's side in plain words. */
function regionWords(h: number): string {
  return `${(2 ** h).toLocaleString()} gibsons across`
}

/** The key of the region of height h holding the whole box at `lo`, or null when the box crosses its border. */
export function lockRegionKey(lo: Position, size: readonly [number, number, number], h: number): Uint8Array | null {
  const H = BigInt(h)
  const ends = [[lo.x, lo.x + BigInt(size[0] - 1)], [lo.y, lo.y + BigInt(size[1] - 1)], [lo.z, lo.z + BigInt(size[2] - 1)]]
  if (ends.some(([a, b]) => a >> H !== b >> H)) return null
  try { return regionKeyAt(lo, h, LOCK_HEIGHT_MAX).key } catch { return null }
}

function StepBar({ step }: { step: ToolStep }): JSX.Element {
  const st = useBlueprintTool()
  const can = (i: number): boolean => i === 0 || (i === 1 && !!st.arrangement) || (i >= 2 && !!st.arrangement && !!st.prize)
  return (
    <ol className="bpt-steps">
      {STEPS.map((label, i) => (
        <li key={label}>
          <button className={`bpt-step${i === step ? ' is-on' : ''}`} disabled={!can(i)} onClick={() => st.setStep(i as ToolStep)}>
            <span className="bpt-step__n">{i + 1}</span>{label}
          </button>
        </li>
      ))}
    </ol>
  )
}

/**
 * Keeps an element on whole device pixels: its 1px grid lines then fall on
 * pixels at any screen density (1, 2 or 3), never across two. A centred box
 * can land half a pixel off; this moves it by that fraction.
 */
function usePixelSnap(): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!el) return
    const snap = (): void => {
      el.style.transform = ''
      // The grid's cells: as big as the room left for it allows, 14 to 20 whole pixels, so the whole step fits without
      // scrolling (owner, 2026-11-27: "beware on mobile").
      const wrap = el.parentElement
      const scroll = el.closest('.bpt-scroll')
      if (wrap && scroll) {
        const w = wrap.clientWidth - (parseFloat(getComputedStyle(wrap).paddingLeft) || 0)
        const h = scroll.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top - 26 - 18 - 8
        const cell = Math.max(14, Math.min(20, Math.floor((w - 17) / 16), Math.floor((h - 17) / 16)))
        wrap.style.setProperty('--cell', `${cell}px`)
      }
      const r = el.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const dx = Math.round(r.left * dpr) / dpr - r.left
      const dy = Math.round(r.top * dpr) / dpr - r.top
      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    snap()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(snap) : null
    ro?.observe(document.body)
    const box = el.closest('.bpt-scroll')
    if (box) ro?.observe(box)
    window.addEventListener('resize', snap)
    return () => { ro?.disconnect(); window.removeEventListener('resize', snap) }
  }, [el])
  return setEl
}

function Compose(): JSX.Element {
  const st = useBlueprintTool()
  const cageRef = usePixelSnap()
  const [big, setBig] = useState(false)
  const view = useMemo(() => {
    const blocks: Array<{ at: [number, number, number]; id: number }> = []
    st.cage.forEach((id, i) => { if (id) blocks.push({ at: [i % MAX_SIDE, Math.floor(i / 256), Math.floor(i / MAX_SIDE) % MAX_SIDE], id }) })
    return blocks
  }, [st.cage])
  const preview = useMemo(() => {
    if (!view.length) return null
    const xs = view.map((b) => b.at)
    const lo = [0, 1, 2].map((a) => Math.min(...xs.map((c) => c[a])))
    const hi = [0, 1, 2].map((a) => Math.max(...xs.map((c) => c[a])))
    const size: [number, number, number] = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1]
    const cells = new Uint16Array(size[0] * size[1] * size[2])
    for (const b of view) cells[(b.at[0] - lo[0]) + size[0] * ((b.at[2] - lo[2]) + size[2] * (b.at[1] - lo[1]))] = b.id
    return fullView({ size, cells })
  }, [view])
  return (
    <div className="bpt-compose">
      <div className="bpt-palette" role="listbox" aria-label="Block to place">
        <button className={`bpt-pal${st.brush === 0 ? ' is-on' : ''}`} onClick={() => st.set({ brush: 0 })} aria-label="Erase" title="Erase">ERASE</button>
        {KINDS.map((k) => (
          <button key={k.id} className={`bpt-pal${st.brush === k.id ? ' is-on' : ''}`} onClick={() => st.set({ brush: k.id })} aria-label={k.name} title={k.name}><Swatch id={k.id} size={22} /></button>
        ))}
      </div>
      <div className="bpt-layer">
        <button className="bpt-mini" onClick={() => st.set({ layer: Math.max(0, st.layer - 1) })} aria-label="Layer down"><Minus size={14} aria-hidden /></button>
        <span>LAYER Y{st.layer}</span>
        <button className="bpt-mini" onClick={() => st.set({ layer: Math.min(MAX_SIDE - 1, st.layer + 1) })} aria-label="Layer up"><Plus size={14} aria-hidden /></button>
        {/* USE THIS at the top, always in sight (owner, 2026-11-27: "use this button should be on top"). */}
        <button className="bpt-go bpt-layer__go" disabled={!view.length} onClick={() => { const why = st.takeCage(cursorPlace()); if (why) st.set({ error: why }) }}>USE THIS <ArrowRight size={14} aria-hidden /></button>
      </div>
      {/* The preview and the block in hand in a column left of the grid on wider screens, a row over it on a phone; the
          grid takes the rest, its cells sized to fit (usePixelSnap), so nothing needs a scroll. */}
      <div className="bpt-compose__main">
        <div className="bpt-compose__side">
          {preview
            ? <button type="button" className={`bpt-compose__preview${big ? ' is-big' : ''}`} onClick={() => setBig((b) => !b)} aria-label={big ? 'Make the preview small' : 'Make the preview bigger'} aria-pressed={big}><BlueprintModel view={preview} size={200} /></button>
            : <span className="bpt-compose__preview is-empty" aria-hidden />}
          <span className="bpt-layer__brush">{st.brush ? blockName(st.brush) : 'Erase'}</span>
        </div>
        <div className="bpt-cage-wrap">
          <span className="bpt-cage__axis bpt-cage__axis--x">+X →</span>
          <span className="bpt-cage__axis bpt-cage__axis--z">↑<br />+Z</span>
          <div ref={cageRef} className="bpt-cage" role="grid" aria-label={`Layer Y${st.layer}, seen from above`}>
            {Array.from({ length: MAX_SIDE * MAX_SIDE }, (_, n) => {
              // +Z up: the top row is z 15, the black sun past the top edge.
              const x = n % MAX_SIDE, z = MAX_SIDE - 1 - Math.floor(n / MAX_SIDE)
              const id = st.cage[x + MAX_SIDE * z + 256 * st.layer]
              const below = st.layer > 0 ? st.cage[x + MAX_SIDE * z + 256 * (st.layer - 1)] : 0
              return (
                <button key={n} className={`bpt-cell${id ? ' is-full' : below ? ' is-below' : ''}`} onClick={() => st.paint(x, z)} aria-label={`x ${x}, z ${z}${id ? `: ${blockName(id)}` : ''}`}>
                  {id ? <Swatch id={id} size={14} /> : null}
                </button>
              )
            })}
          </div>
          <span className="bpt-cage__sun" aria-label="The black sun lies along +Z" />
        </div>
      </div>
    </div>
  )
}

function ArrangementStep(): JSX.Element {
  const st = useBlueprintTool()
  if (st.composing) return <Compose />
  return (
    <div className="bpt-body">
      {st.arrangement && (
        <div className="bpt-have">
          <BlueprintModel view={fullView(st.arrangement)} size={120} />
          <span>{blockCount(st.arrangement)} blocks, a box {st.arrangement.size[0]} by {st.arrangement.size[1]} by {st.arrangement.size[2]}</span>
        </div>
      )}
      <button className="bpt-choice" onClick={() => { st.set({ capturing: true, open: false }); if (!enterTerrainMode()) st.set({ capturing: false, open: true, error: 'TERRAIN cannot open here right now.' }) }}>
        <Radar size={22} strokeWidth={1.75} aria-hidden />
        <span><b>CAPTURE FROM TERRAIN</b><small>Aim at a build that stands alone and press RECORD. The blocks stay where they are.</small></span>
      </button>
      <button className="bpt-choice" onClick={() => st.set({ composing: true })}>
        <Boxes size={22} strokeWidth={1.75} aria-hidden />
        <span><b>COMPOSE ON A GRID</b><small>Place blocks on a 16 by 16 by 16 grid, a layer at a time. Designing is free; building it costs the blocks.</small></span>
      </button>
      {st.arrangement && <button className="bpt-go" onClick={() => st.setStep(1)}>NEXT <ArrowRight size={14} aria-hidden /></button>}
    </div>
  )
}

/** The guard's view of this device: who you are, what you published, the kit pieces, what you included. */
function guardNow(): GuardInput {
  // Kit pieces marked before fingerprints were kept get theirs now, from the workshop's models.
  backfillKitPrints(useWorkshop.getState().shards)
  return { me: useCyberspace.getState().identity.pubkey, ledger: usePublished.getState().ledger, kit: kitPieces(), included: includedPrizes() }
}

/**
 * Whether a shard may be sealed as a prize: a workshop object by the whole
 * guard (lib/blueprint/prizeGuard.ts), a shard from ITEMS by its kit marks
 * only (it came to you from a bag or a chest, so it is out there already).
 */
export function prizeAllowed(shard: ShardModel, from: 'workshop' | 'items', g: GuardInput = guardNow()): boolean {
  const bar = prizeBar(shard, g)
  return from === 'workshop' ? bar === null : bar !== 'kit' && bar !== 'carries'
}

/**
 * One prize tile: an 80px chamfered thumbnail, its name and status under it,
 * and one action in a slot of fixed height, so every tile lines up. A tile
 * you can choose is itself the button (`choose`): one tap makes it the prize.
 */
function PrizeTile({ shard, chosen, barred, status, action, choose }: { shard: ShardModel; chosen: boolean; barred: boolean; status: string; action?: { label: string; run: () => void } | null; choose?: () => void }): JSX.Element {
  const body = (
    <>
      <ItemThumb type="shard" shard={shard} size={80} lazy />
      <span className="bpt-tile__name">{shard.name || 'object'}</span>
      <span className="bpt-tile__status">{chosen ? <><Check size={11} strokeWidth={2.5} aria-hidden />Prize</> : status}</span>
    </>
  )
  return (
    <li className={`bpt-tile${chosen ? ' is-on' : ''}${barred ? ' is-barred' : ''}`}>
      {choose
        ? <button className="bpt-tile__hit" onClick={choose} aria-pressed={chosen} aria-label={`${shard.name || 'object'}: use as prize`}>{body}</button>
        : <div className="bpt-tile__hit">{body}</div>}
      <span className="bpt-tile__act">{action && <button className="bpt-mini" onClick={action.run}>{action.label}</button>}</span>
    </li>
  )
}

function PrizeStep(): JSX.Element {
  const st = useBlueprintTool()
  const workshop = useWorkshop((s) => s.shards)
  const newest: ShardModel[] = useNewestFirst(workshop, modelRef, modelEditedAt)
  const items = useInventory((s) => s.items)
  const ledger = usePublished((s) => s.ledger)
  const tree = useShardFolders((s) => s.tree)
  const [folder, setFolder] = useState<string | null>(null)
  const [included, setIncludedState] = useState(() => includedPrizes())
  useEffect(() => { if (useShardFolders.getState().storage === 'loading') void useShardFolders.getState().load() }, [])
  const loot = useMemo(() => Object.values(items).filter((i) => i.type === 'shard' && i.shard && !i.cleared && !i.archived && !isKeyItem(i)), [items])
  const g: GuardInput = { me: useCyberspace.getState().identity.pubkey, ledger, kit: kitPieces(), included }
  // A read-only filter by the workshop's folders: no folder is made, renamed, moved or deleted here.
  const folders = useMemo(() => flatFolders(tree), [tree])
  const shown = folder ? newest.filter((s) => isWithin(tree, folderOf(tree, modelRef(s)), folder)) : newest
  const choose = (shard: ShardModel, from: 'workshop' | 'items'): void => st.set({ prize: { name: shard.name || 'object', shard, from }, title: st.title || '' })
  const setInc = (id: string, on: boolean): void => { setIncluded(id, on); setIncludedState(includedPrizes()) }
  return (
    <div className="bpt-body">
      <h3 className="bpt-h">FROM THE WORKSHOP</h3>
      {folders.length > 0 && (
        <div className="bpt-chips" role="tablist" aria-label="Folders">
          <button role="tab" aria-selected={folder === null} className={`bpt-chip${folder === null ? ' is-on' : ''}`} onClick={() => setFolder(null)}>ALL</button>
          {folders.map(({ folder: f }) => (
            <button key={f.id} role="tab" aria-selected={folder === f.id} className={`bpt-chip${folder === f.id ? ' is-on' : ''}`} onClick={() => setFolder(f.id)}>{pathOf(tree, f.id).join(' / ')}</button>
          ))}
        </div>
      )}
      {shown.length ? (
        <ul className="bpt-tiles">
          {shown.map((s) => {
            const bar = prizeBar(s, g)
            const chosen = st.prize?.shard === s
            const published = g.ledger[s.id]?.pubkey === g.me
            // One tap chooses: a published object by its tile, an unpublished one by USE AS PRIZE (included and chosen at once).
            if (bar === 'kit' || bar === 'carries') return <PrizeTile key={s.id} shard={s} chosen={false} barred status={BAR_WORDS[bar]} action={null} />
            if (published) return <PrizeTile key={s.id} shard={s} chosen={chosen} barred={false} status="Published" choose={() => choose(s, 'workshop')} />
            return (
              <PrizeTile
                key={s.id}
                shard={s}
                chosen={chosen}
                barred={false}
                status="Not published: sealing puts it in the blueprint"
                action={chosen ? { label: 'LEAVE OUT', run: () => { setInc(s.id, false); st.set({ prize: null }) } } : { label: 'USE AS PRIZE', run: () => { setInc(s.id, true); choose(s, 'workshop') } }}
              />
            )
          })}
        </ul>
      ) : <p className="bpt-empty">{newest.length ? 'Nothing in this folder.' : 'No models yet. Make one in the workshop.'}</p>}
      <h3 className="bpt-h">FROM ITEMS</h3>
      {loot.length ? (
        <ul className="bpt-tiles">
          {loot.map((i) => {
            const ok = prizeAllowed(i.shard!, 'items', g)
            const chosen = st.prize?.shard === i.shard
            if (!ok) return <PrizeTile key={i.rowKey} shard={i.shard!} chosen={false} barred status={BAR_WORDS.kit} action={null} />
            return <PrizeTile key={i.rowKey} shard={i.shard!} chosen={chosen} barred={false} status="From ITEMS" choose={() => choose(i.shard!, 'items')} />
          })}
        </ul>
      ) : <p className="bpt-empty">No shards in ITEMS yet.</p>}
      <button className="bpt-go" disabled={!st.prize} onClick={() => st.setStep(2)}>NEXT <ArrowRight size={14} aria-hidden /></button>
    </div>
  )
}

function SettingsStep({ onExamine }: { onExamine: () => void }): JSX.Element {
  const st = useBlueprintTool()
  const a = st.arrangement!
  const parts = partsList(st)
  const view = fullView(a, (i) => shownCell(st, i))
  // Up to 2^12 steps of work: made only when the place, the box or the size changes.
  const lockKey = useMemo(() => (st.lock === 'location' && st.place ? lockRegionKey(st.place.lo, a.size, st.height) : null), [st.lock, st.place, a.size, st.height])
  return (
    <div className="bpt-body">
      <h3 className="bpt-h">1 · HOW MUCH OF THE RECIPE SHOWS</h3>
      <div className="bpt-reveal">
        <div className="bpt-reveal__preview">
          <BlueprintModel view={view} size={150} onCellTap={(i) => st.flip(i)} label="What finders will see" />
          <small>Tap a block to flip it</small>
        </div>
        <ul className="bpt-parts">
          {parts.map((p) => {
            const off = p.shown === 0
            return (
              <li key={p.id} className="bpt-part">
                <Swatch id={p.id} />
                <span className="bpt-part__name">{blockName(p.id)}</span>
                <span className="bpt-part__n">{p.shown === p.count ? p.count : `${p.shown} of ${p.count} shown`}</span>
                <button className={`bpt-eye${off ? ' is-off' : ''}`} onClick={() => st.toggleType(p.id)} aria-label={`${off ? 'Reveal' : 'Hide'} every ${blockName(p.id)}`} aria-pressed={!off}>{off ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}</button>
              </li>
            )
          })}
        </ul>
      </div>
      <label className="bpt-slider">
        <span>Reveal about {st.randomPct}% at random</span>
        <input type="range" min={0} max={100} step={5} value={st.randomPct} onChange={(e) => st.set({ randomPct: Number(e.target.value) })} />
      </label>
      <p className="bpt-summary">{revealSummary(parts)}</p>
      <button className="bpt-mini bpt-reset" onClick={() => st.reset()}><RotateCcw size={13} aria-hidden />RESET</button>

      <h3 className="bpt-h">2 · HOW MUCH OF THE PRIZE SHOWS</h3>
      <div className="bpt-seg" role="radiogroup">
        {(Object.keys(REVEAL_WORDS) as PrizeReveal[]).map((r) => (
          <button key={r} role="radio" aria-checked={st.reveal === r} className={st.reveal === r ? 'is-on' : ''} onClick={() => st.set({ reveal: r, ...((r === 'silhouette' || r === 'render') && st.views.size === 0 ? { views: new Set<PrizeView>(['iso']) } : {}) })}>{REVEAL_WORDS[r]}</button>
        ))}
      </div>
      {(st.reveal === 'silhouette' || st.reveal === 'render') && (
        <div className="bpt-seg bpt-seg--views">
          {PRIZE_VIEWS_SHOWN.map((v) => (
            <button key={v} aria-pressed={st.views.has(v)} className={st.views.has(v) ? 'is-on' : ''} onClick={() => { const n = new Set(st.views); if (n.has(v)) { if (n.size > 1) n.delete(v) } else n.add(v); st.set({ views: n }) }} title={st.views.has(v) && st.views.size === 1 ? 'At least one view is shown' : undefined}>{VIEW_WORDS[v]}</button>
          ))}
        </div>
      )}
      {st.reveal !== 'hidden' && (
        <textarea className="bpt-text" value={st.text} maxLength={280} rows={2} placeholder={st.reveal === 'description' ? 'A line or two about the prize' : 'A hint about the prize (optional)'} onChange={(e) => st.set({ text: e.target.value })} />
      )}
      {/* The prize's own name is part of what the maker reveals: off unless chosen. */}
      <label className="bpt-switch">
        <span><b>Show the prize's name</b><small>{st.showName && st.prize ? `Finders see "${st.prize.name}".` : 'Finders see only what the choice above shows.'}</small></span>
        <Switch checked={st.showName} onCheckedChange={(on) => st.set({ showName: on })} aria-label="Show the prize's name" />
      </label>

      <h3 className="bpt-h">3 · WHAT LOCKS IT</h3>
      <div className="bpt-seg" role="radiogroup">
        <button role="radio" aria-checked={st.lock === 'standard'} className={st.lock === 'standard' ? 'is-on' : ''} onClick={() => st.set({ lock: 'standard' })}><Lock size={13} aria-hidden />STANDARD</button>
        <button role="radio" aria-checked={st.lock === 'location'} className={st.lock === 'location' ? 'is-on' : ''} onClick={() => st.set({ lock: 'location' })}><MapPin size={13} aria-hidden />LOCATION</button>
      </div>
      <p className="bpt-note">{st.lock === 'standard' ? 'The blocks are the lock: it can be built anywhere.' : lockKey ? `It must be built inside this region, ${regionWords(st.height)}.` : 'The build crosses a border of a region this size: choose a larger one.'}</p>
      {st.lock === 'location' && (
        <div className="bpt-layer">
          <button className="bpt-mini" onClick={() => st.set({ height: Math.max(1, st.height - 1) })} aria-label="Smaller region"><Minus size={14} aria-hidden /></button>
          <span>REGION {regionWords(st.height).toUpperCase()}</span>
          <button className="bpt-mini" onClick={() => st.set({ height: Math.min(LOCK_HEIGHT_MAX, st.height + 1) })} aria-label="Larger region"><Plus size={14} aria-hidden /></button>
        </div>
      )}
      <div className="bpt-row">
        <button className="bpt-mini" onClick={onExamine}><ScanSearch size={14} aria-hidden />SEE AS A FINDER</button>
        <button className="bpt-go" onClick={() => st.setStep(3)}>NEXT <ArrowRight size={14} aria-hidden /></button>
      </div>
    </div>
  )
}

function SealStep(): JSX.Element {
  const st = useBlueprintTool()
  const a = st.arrangement!
  const parts = partsList(st)
  const seal = async (): Promise<void> => {
    if (!st.prize || st.sealing) return
    // Checked again as it is sealed: a kit piece never goes into a record, however it was picked.
    if (!prizeAllowed(st.prize.shard, st.prize.from)) { st.set({ error: 'That object cannot be a prize: kit pieces and pieces never published stay with you.' }); return }
    st.set({ sealing: true, error: null })
    // The pictures are drawn now, with every piece the prize places, and kept in the record (DECK-0010 §5.3).
    const flat = st.reveal === 'silhouette' || st.reveal === 'render'
    const views = flat ? await prizeImagesWhole(st.prize.shard, st.reveal as 'silhouette' | 'render', [...st.views]) : undefined
    st.set({ sealing: false })
    if (flat && !Object.keys(views ?? {}).length) { st.set({ error: 'The prize pictures could not be drawn. Try again, or choose another view.' }); return }
    const regionKey = st.lock === 'location' && st.place ? lockRegionKey(st.place.lo, a.size, st.height) : null
    const why = makeRefusal({ arrangement: a, reveal: st.reveal, text: st.text, views, lock: st.lock, height: st.height, regionKey })
    if (why) { st.set({ error: why }); return }
    st.set({ sealing: true, error: null })
    try {
      const made = await makeBlueprint({
        arrangement: a, shown: (i) => shownCell(st, i), title: st.title, prize: { type: 'sno', payload: toPayload(withAuthoredConstrain(st.prize.shard)) as unknown as Record<string, unknown> },
        reveal: st.reveal, text: st.text, views, lock: st.lock, height: st.height, regionKey, prizeName: st.showName ? st.prize.name : null,
      }, (t) => useCyberspace.getState().signEvent(t))
      if ('refused' in made) { st.set({ sealing: false, error: made.refused }); return }
      const card = useBlueprints.getState().addMade({ lookup: made.lookup, record: made.record as NostrEvent, secret: makerSecret(a, made.key), prizeKind: 'sno' })
      // LIVE, the record goes to the relays too, so a smash anywhere finds it.
      const went = await publishRecord(made.record, useCyberspace.getState().live)
      st.set({ sealing: false })
      useToast.getState().show({ label: 'BLUEPRINT', meta: SEALED_WORDS[went], mark: 'build', ms: BRIEF_TOAST_MS })
      // Back to the list, the new one first and marked NEW, so DEPLOY is one tap away (owner, 2026-11-27).
      useBlueprintTool.getState().sealed(card.rowKey)
    } catch {
      st.set({ sealing: false, error: 'The signer did not sign it. Try again.' })
    }
  }
  return (
    <div className="bpt-body">
      {/* The blueprint's own name: what cards, rows and the sheet's title show. The prize's name is a separate choice (SETTINGS). */}
      <label className="bpt-field">
        <span>BLUEPRINT NAME</span>
        <input value={st.title} maxLength={64} placeholder="blueprint" onChange={(e) => st.set({ title: e.target.value })} />
      </label>
      <div className="bpt-have">
        <BlueprintModel view={fullView(a, (i) => shownCell(st, i))} size={120} />
        <span>
          <b>{st.title.trim() || 'blueprint'}</b><br />
          <span className="bpt-sum__k">MATERIALS</span> {materialsWords(parts.reduce((n, p) => n + p.shown, 0), parts.reduce((n, p) => n + p.count - p.shown, 0))}<br />
          <span className="bpt-sum__k">CONSTRUCTION</span> {constructionWords(st.lock, st.lock === 'location' ? st.height : undefined)}<br />
          <span className="bpt-sum__k">PRIZE</span> {prizeShort(st.reveal, st.showName)} ({st.prize?.name ?? 'no prize yet'}, seen only by you here)
        </span>
      </div>
      <p className="bpt-note">Sealing makes the key from the blocks, seals the prize with it and adds your signature. Only the shape and the blocks you show go into it.</p>
      <button className="bpt-go bpt-go--seal" disabled={st.sealing} onClick={() => { void seal() }}><Stamp size={15} aria-hidden />{st.sealing ? 'SEALING' : 'SEAL'}</button>
    </div>
  )
}

/** The BLUEPRINT tool's sheet. */
export function BlueprintTool(): JSX.Element | null {
  const st = useBlueprintTool()
  const [examine, setExamine] = useState(false)
  // SEE AS A FINDER draws the chosen views now, from the chosen prize, exactly as SEAL will keep them.
  const [preview, setPreview] = useState<Partial<Record<PrizeView, string>>>({})
  useEffect(() => {
    let live = true
    setPreview({})
    const flat = st.reveal === 'silhouette' || st.reveal === 'render'
    if (examine && flat && st.prize) void prizeImagesWhole(st.prize.shard, st.reveal as 'silhouette' | 'render', [...st.views]).then((v) => { if (live) setPreview(v) })
    return () => { live = false }
  }, [examine, st.reveal, st.views, st.prize])
  const close = (): void => st.close()
  useModalStack(st.open, close)
  if (!st.open) return null
  const a = st.arrangement
  return (
    <Stacked>
      <div className="modal bpt" role="dialog" aria-modal="true" aria-label="Blueprint" onPointerDown={close}>
        <div className="modal__card bpt-card" onPointerDown={(e) => e.stopPropagation()}>
          <div className="bpt-head">
            <DraftingCompass size={16} strokeWidth={2} aria-hidden />
            <h2>BLUEPRINT</h2>
            {st.view === 'make' && <button className="bpt-mini" onClick={() => (st.step > 0 ? st.setStep((st.step - 1) as ToolStep) : st.set({ view: 'list', error: null }))} aria-label="Back"><ArrowLeft size={14} aria-hidden /></button>}
            <ModalClose onClose={close} />
          </div>
          {st.view === 'make' && <StepBar step={st.step} />}
          <div className="bpt-error" role="status">{st.error ?? ''}</div>
          <div className="bpt-scroll">
            {st.view === 'list' && <BlueprintLanding onCreate={st.createNew} freshRowKey={st.freshRowKey} />}
            {st.view === 'make' && st.step === 0 && <ArrangementStep />}
            {st.view === 'make' && st.step === 1 && <PrizeStep />}
            {st.view === 'make' && st.step === 2 && a && <SettingsStep onExamine={() => setExamine(true)} />}
            {st.view === 'make' && st.step === 3 && a && <SealStep />}
          </div>
        </div>
      </div>
      {examine && a && (
        <ExamineSheet
          bp={{ name: st.title.trim() || 'blueprint', maker: 'you', description: st.text, view: fullView(a, (i) => shownCell(st, i)), prize: { reveal: st.reveal, text: st.text || undefined, views: preview, name: st.showName ? st.prize?.name ?? null : null }, lock: st.lock, height: st.lock === 'location' ? st.height : undefined }}
          onClose={() => setExamine(false)}
        />
      )}
    </Stacked>
  )
}
