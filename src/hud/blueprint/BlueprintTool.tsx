/**
 * BlueprintTool.tsx - the BLUEPRINT tool in BUILD (design page 4.8): four
 * steps on one sheet, in the workshop's style (store/useBlueprintTool.ts).
 *
 * 1. ARRANGEMENT: CAPTURE FROM TERRAIN (aim at a build that stands alone,
 *    RECORD; the blocks stay where they are) or COMPOSE in a 16 by 16 by 16
 *    cage, a layer at a time, placing kinds without spending them. The cage
 *    is drawn from above: +X to the right, +Z down, the black sun past the
 *    bottom edge, as the EXAMINE sheet's view from above.
 * 2. PRIZE: a shard from the workshop or from ITEMS, and the blueprint's name.
 * 3. SETTINGS: the recipe reveal (an eye per block type, a tap on a block in
 *    the finder's preview to flip it, the random shortcut; everything starts
 *    revealed; a one-line summary), the prize reveal (hidden, description,
 *    silhouette or render, with the views along X, Y, Z or isometric, drawn
 *    now), and the lock (standard or location). SEE AS A FINDER opens EXAMINE.
 * 4. SEAL: the key, the sealed prize and the record, kept in ITEMS ›
 *    BLUEPRINTS › MINE until it is placed.
 */

import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, Boxes, DraftingCompass, Eye, EyeOff, Lock, MapPin, Minus, Plus, Radar, RotateCcw, ScanSearch, Stamp } from 'lucide-react'
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
import { MAX_SIDE, PRIZE_VIEWS, fullView, type PrizeReveal, type PrizeView } from '../../lib/blueprint/format'
import { blockCount } from '../../lib/blueprint/arrangement'
import { makeBlueprint, makeRefusal, makerSecret } from '../../lib/blueprint/make'
import { prizeImages } from '../../lib/blueprint/prizeViews'
import { LOCK_HEIGHT_MAX } from '../../lib/blueprint/smashRun'
import { regionKeyAt } from '../../lib/shardCrypto'
import { withAuthoredConstrain } from '../../lib/walkConstrain'
import { isKeyItem } from '../../lib/inventory'
import { ModalClose } from '../ui/ModalClose'
import { ItemThumb } from '../ItemThumb'
import { BAR_WORDS, includedPrizes, kitPieces, prizeBar, setIncluded, type GuardInput } from '../../lib/blueprint/prizeGuard'
import { usePublished } from '../../store/usePublished'
import { ShardFolders, modelEditedAt, modelName, modelRef, useNewestFirst } from '../ShardFolders'
import { Stacked, useModalStack } from '../modalStack'
import { BlueprintModel } from './BlueprintModel'
import { ExamineSheet } from './ExamineSheet'
import type { Position } from '../../lib/space'
import type { NostrEvent } from '../../lib/events'

const STEPS = ['ARRANGEMENT', 'PRIZE', 'SETTINGS', 'SEAL'] as const
const VIEW_WORDS: Record<PrizeView, string> = { x: 'ALONG X', y: 'ALONG Y', z: 'ALONG Z', iso: 'ISOMETRIC' }
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

function Compose(): JSX.Element {
  const st = useBlueprintTool()
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
        <span className="bpt-layer__brush">{st.brush ? blockName(st.brush) : 'Erase'}</span>
      </div>
      <div className="bpt-cage-wrap">
        <span className="bpt-cage__axis bpt-cage__axis--x">+X →</span>
        <span className="bpt-cage__axis bpt-cage__axis--z">+Z<br />↓</span>
        <div className="bpt-cage" role="grid" aria-label={`Layer Y${st.layer}, seen from above`}>
          {Array.from({ length: MAX_SIDE * MAX_SIDE }, (_, n) => {
            const x = n % MAX_SIDE, z = Math.floor(n / MAX_SIDE)
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
      <div className="bpt-compose__foot">
        {preview && <BlueprintModel view={preview} size={96} />}
        <button className="bpt-go" disabled={!view.length} onClick={() => { const why = st.takeCage(cursorPlace()); if (why) st.set({ error: why }) }}>USE THIS <ArrowRight size={14} aria-hidden /></button>
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
        <span><b>COMPOSE IN THE CAGE</b><small>Place blocks in a 16 by 16 by 16 cage. Designing is free; building it costs the blocks.</small></span>
      </button>
      {st.arrangement && <button className="bpt-go" onClick={() => st.setStep(1)}>NEXT <ArrowRight size={14} aria-hidden /></button>}
    </div>
  )
}

/** The guard's view of this device: who you are, what you published, the kit pieces, what you included. */
function guardNow(): GuardInput {
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

function PrizeStep(): JSX.Element {
  const st = useBlueprintTool()
  const workshop = useWorkshop((s) => s.shards)
  const newest: ShardModel[] = useNewestFirst(workshop, modelRef, modelEditedAt)
  const items = useInventory((s) => s.items)
  const ledger = usePublished((s) => s.ledger)
  const [included, setIncludedState] = useState(() => includedPrizes())
  const loot = useMemo(() => Object.values(items).filter((i) => i.type === 'shard' && i.shard && !i.cleared && !i.archived && !isKeyItem(i)), [items])
  const g: GuardInput = { me: useCyberspace.getState().identity.pubkey, ledger, kit: kitPieces(), included }
  const pick = (shard: ShardModel, from: 'workshop' | 'items'): void => { if (prizeAllowed(shard, from, g)) st.set({ prize: { name: shard.name || 'object', shard, from }, title: st.title || '' }) }
  const include = (id: string, on: boolean): void => { setIncluded(id, on); setIncludedState(includedPrizes()) }
  return (
    <div className="bpt-body">
      <label className="bpt-field">
        <span>NAME</span>
        <input value={st.title} maxLength={64} placeholder="blueprint" onChange={(e) => st.set({ title: e.target.value })} />
      </label>
      <h3 className="bpt-h">FROM THE WORKSHOP</h3>
      <p className="bpt-note">Your published objects. Kit pieces are never prizes; one you never published can be included by hand.</p>
      {/* Through the folders, as every list of your shards (hud/ShardFolders). */}
      {newest.length ? (
        <ul className="bpt-prizes">
          <ShardFolders items={newest} refOf={modelRef} nameOf={modelName} row={(s, f) => {
            const bar = prizeBar(s, g)
            const unpublished = bar === 'unpublished' || (bar === null && g.ledger[s.id]?.pubkey !== g.me)
            return (
              <li key={s.id}>
                <button className={`bpt-prize${st.prize?.shard === s ? ' is-on' : ''}${bar ? ' is-barred' : ''}`} disabled={!!bar} onClick={() => pick(s, 'workshop')} title={bar ? BAR_WORDS[bar] : undefined}>
                  <ItemThumb type="shard" shard={s} size={80} lazy />
                  <span>{f.mark(s.name || 'object')}</span>
                  <small className="bpt-prize__bar">{bar ? BAR_WORDS[bar] : unpublished ? 'Included by hand' : ''}</small>
                </button>
                {unpublished && <button className="bpt-mini bpt-prize__include" onClick={() => include(s.id, bar === 'unpublished')}>{bar === 'unpublished' ? 'INCLUDE' : 'LEAVE OUT'}</button>}
              </li>
            )
          }} />
        </ul>
      ) : <p className="bpt-empty">No models yet. Make one in the workshop.</p>}
      <h3 className="bpt-h">FROM ITEMS</h3>
      {loot.length ? (
        <ul className="bpt-prizes">
          {loot.map((i) => {
            const ok = prizeAllowed(i.shard!, 'items', g)
            return (
              <li key={i.rowKey}>
                <button className={`bpt-prize${st.prize?.shard === i.shard ? ' is-on' : ''}${ok ? '' : ' is-barred'}`} disabled={!ok} onClick={() => pick(i.shard!, 'items')}>
                  <ItemThumb type="shard" shard={i.shard!} size={80} lazy />
                  <span>{i.shard!.name || 'object'}</span>
                  <small className="bpt-prize__bar">{ok ? '' : BAR_WORDS.kit}</small>
                </button>
              </li>
            )
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
          <button key={r} role="radio" aria-checked={st.reveal === r} className={st.reveal === r ? 'is-on' : ''} onClick={() => st.set({ reveal: r })}>{REVEAL_WORDS[r]}</button>
        ))}
      </div>
      {(st.reveal === 'silhouette' || st.reveal === 'render') && (
        <div className="bpt-seg bpt-seg--views">
          {PRIZE_VIEWS.map((v) => (
            <button key={v} aria-pressed={st.views.has(v)} className={st.views.has(v) ? 'is-on' : ''} onClick={() => { const n = new Set(st.views); if (n.has(v)) n.delete(v); else n.add(v); st.set({ views: n }) }}>{VIEW_WORDS[v]}</button>
          ))}
        </div>
      )}
      {st.reveal !== 'hidden' && (
        <textarea className="bpt-text" value={st.text} maxLength={280} rows={2} placeholder={st.reveal === 'description' ? 'A line or two about the prize' : 'A hint about the prize (optional)'} onChange={(e) => st.set({ text: e.target.value })} />
      )}

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
  const [done, setDone] = useState<string | null>(null)
  const seal = async (): Promise<void> => {
    if (!st.prize || st.sealing) return
    // Checked again as it is sealed: a kit piece never goes into a record, however it was picked.
    if (!prizeAllowed(st.prize.shard, st.prize.from)) { st.set({ error: 'That object cannot be a prize: kit pieces and pieces never published stay with you.' }); return }
    const views = (st.reveal === 'silhouette' || st.reveal === 'render') ? prizeImages(st.prize.shard, st.reveal, [...st.views]) : undefined
    const regionKey = st.lock === 'location' && st.place ? lockRegionKey(st.place.lo, a.size, st.height) : null
    const why = makeRefusal({ arrangement: a, reveal: st.reveal, text: st.text, views, lock: st.lock, height: st.height, regionKey })
    if (why) { st.set({ error: why }); return }
    st.set({ sealing: true, error: null })
    try {
      const made = await makeBlueprint({
        arrangement: a, shown: (i) => shownCell(st, i), title: st.title, prize: { type: 'sno', payload: toPayload(withAuthoredConstrain(st.prize.shard)) as unknown as Record<string, unknown> },
        reveal: st.reveal, text: st.text, views, lock: st.lock, height: st.height, regionKey,
      }, (t) => useCyberspace.getState().signEvent(t))
      if ('refused' in made) { st.set({ sealing: false, error: made.refused }); return }
      useBlueprints.getState().addMade({ lookup: made.lookup, record: made.record as NostrEvent, secret: makerSecret(a, made.key) })
      st.set({ sealing: false })
      setDone(st.title.trim() || 'blueprint')
      useToast.getState().show({ label: 'BLUEPRINT', meta: 'Sealed. It waits in ITEMS, BLUEPRINTS.', mark: 'build', ms: BRIEF_TOAST_MS })
    } catch {
      st.set({ sealing: false, error: 'The signer did not sign it. Try again.' })
    }
  }
  if (done) {
    return (
      <div className="bpt-body bpt-done">
        <Stamp size={30} strokeWidth={1.5} aria-hidden />
        <p><b>{done}</b> is sealed. It waits in ITEMS, BLUEPRINTS, MINE until you place it.</p>
        <button className="bpt-go" onClick={() => { st.set({ arrangement: null, prize: null, step: 0, title: '', text: '' }); st.reset(); setDone(null) }}>MAKE ANOTHER</button>
      </div>
    )
  }
  return (
    <div className="bpt-body">
      <div className="bpt-have">
        <BlueprintModel view={fullView(a, (i) => shownCell(st, i))} size={120} />
        <span>
          <b>{st.title.trim() || 'blueprint'}</b><br />
          {revealSummary(parts)}<br />
          Prize: {st.prize?.name}, shown as {REVEAL_WORDS[st.reveal].toLowerCase()}.<br />
          {st.lock === 'standard' ? 'Works anywhere.' : `Built inside a region ${regionWords(st.height)}.`}
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
            {st.step > 0 && <button className="bpt-mini" onClick={() => st.setStep((st.step - 1) as ToolStep)} aria-label="Back"><ArrowLeft size={14} aria-hidden /></button>}
            <ModalClose onClose={close} />
          </div>
          <StepBar step={st.step} />
          <div className="bpt-error" role="status">{st.error ?? ''}</div>
          <div className="bpt-scroll">
            {st.step === 0 && <ArrangementStep />}
            {st.step === 1 && <PrizeStep />}
            {st.step === 2 && a && <SettingsStep onExamine={() => setExamine(true)} />}
            {st.step === 3 && a && <SealStep />}
          </div>
        </div>
      </div>
      {examine && a && (
        <ExamineSheet
          bp={{ name: st.title.trim() || 'blueprint', maker: 'you', description: st.text, view: fullView(a, (i) => shownCell(st, i)), prize: { reveal: st.reveal, text: st.text || undefined, views: {}, title: st.prize?.name ?? '' }, lock: st.lock, height: st.lock === 'location' ? st.height : undefined }}
          onClose={() => setExamine(false)}
        />
      )}
    </Stacked>
  )
}
