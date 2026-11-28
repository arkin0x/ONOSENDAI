/**
 * MiningPanel.tsx - MINING in the menu (owner, 2026-11-27: "Add a Mining
 * panel in the menu. track how many surveys we've done. think of other
 * helpful stats we could track. track them in 30078 so they are accessible
 * on any device").
 *
 * Your TERRAIN stats as tiles, a number over a label, in groups: surveys,
 * mining (with the kinds mined most and the rarest find, by their block
 * pictures), building, smashes, compiles and the Compiler, blueprints, and
 * time. The totals are every device's added up (lib/miningRecord.ts); the
 * line at the foot says whether they are synced across your devices or kept
 * on this one, LIVE or LOCAL, and when they last synced (store/miningStats.ts).
 * On screen (unfolded and in view: the menu mounts its folded panels too),
 * it reads your other devices' numbers, at most once a minute; it never
 * writes, so opening the menu never asks your signer for a signature (review
 * of #951). The foot says what is true now: synced, saved on this device
 * only, or that the last sync failed.
 *
 * SAVED CHUNKS (owner, 2026-11-28: "keep it in the mining panel in a button
 * that triggers a modal that shows all your saved chunks"): one button at the
 * top, with how many you saved, opening terrain/SavedChunks.tsx.
 *
 * The look: the house chamfer on every tile, a cyan tick on the cut corner,
 * white tabular numbers (drawn from augmented-ui's cut corners and the FUI
 * HUD readouts the owner likes; no dependency).
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Bomb, Boxes, ChevronRight, Cloud, CloudOff, Cpu, DraftingCompass, Hammer, Pickaxe, ScanSearch, Star, Timer } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { WRITE_EVERY_MS, isDirty, localFor, miningRecordFor, nudgeMining, useMiningStats, type MiningStatus } from '../store/miningStats'
import { currentStreak, dayNumber, daysActive, longestStreak, rarestMined, topMined, totalsOf } from '../lib/miningRecord'
import { blockKind, blockName } from '../lib/terrain/blocks'
import { tileUrl } from '../lib/terrain/tiles'
import { Explanation } from './Explanation'
import { useStarredChunks } from '../store/starredChunks'
import { openSavedChunks } from '../terrain/savedChunksUi'

/** How many of the kinds mined most are shown. */
export const TOP_KINDS = 4

/** A count as people read it. */
const num = (n: number): string => n.toLocaleString('en-US')

/** Seconds as hours and minutes. */
export function timeWords(sec: number): string {
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** A date, short. */
export function dateWords(unixS: number | undefined): string | null {
  if (!unixS) return null
  return new Date(unixS * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** When it last synced, in words. */
export function syncedWords(ms: number, now: number): string {
  if (!ms) return 'Not synced yet'
  const m = Math.floor((now - ms) / 60_000)
  if (m < 1) return 'Last synced just now'
  if (m < 60) return `Last synced ${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `Last synced ${h} h ago`
  return `Last synced ${dateWords(Math.floor(ms / 1000))}`
}

function Swatch({ id, size = 22 }: { id: number; size?: number }): JSX.Element {
  const k = blockKind(id)
  const url = k ? tileUrl(k) : ''
  const style = { '--sw-face': k?.color ?? 'transparent', '--sw-edge': k?.edge ?? 'transparent', width: size, height: size, ...(url ? { backgroundImage: `url(${url})` } : {}) } as CSSProperties
  return <span className={`terrain-swatch${k?.glow ? ' terrain-swatch--glow' : ''}`} style={style} aria-hidden />
}

/** The foot's words: whether the stats are synced, kept here, or failed to sync, and what to know about it. */
export function syncLine(o: { enabled: boolean; live: boolean; status: MiningStatus; dirty: boolean; syncedAt: number; now: number }): { synced: boolean; words: string; when: string } {
  if (!o.enabled) return { synced: false, words: 'Saved on this device only', when: 'Sync is off in Settings' }
  if (!o.live) return { synced: false, words: 'Saved on this device only', when: 'Switch to LIVE to sync' }
  if (o.status === 'unsupported') return { synced: false, words: 'Saved on this device only', when: 'Your signer cannot encrypt them' }
  if (o.status === 'error') return { synced: false, words: 'Sync failed', when: syncedWords(o.syncedAt, o.now) }
  if (o.status === 'syncing') return { synced: true, words: 'Syncing', when: syncedWords(o.syncedAt, o.now) }
  const soon = `New stats save within ${WRITE_EVERY_MS / 60_000} min`
  if (!o.syncedAt) return { synced: false, words: 'Not synced yet', when: o.dirty ? soon : '' }
  return { synced: true, words: 'Synced across your devices', when: o.dirty ? soon : syncedWords(o.syncedAt, o.now) }
}

/** A tile: a number (or a date, `text`, drawn smaller) over its label; `quiet` for nothing yet. */
function Tile({ value, label, wide = false, quiet = false, text = false, children }: { value: ReactNode; label: string; wide?: boolean; quiet?: boolean; text?: boolean; children?: ReactNode }): JSX.Element {
  return (
    <div className={`mining__tile${wide ? ' mining__tile--wide' : ''}${text ? ' mining__tile--text' : ''}${quiet ? ' is-quiet' : ''}`}>
      <span className={`mining__num${children ? ' mining__num--icon' : ''}`}>{children}{value}</span>
      <span className="mining__label">{label}</span>
    </div>
  )
}

/** A group of tiles under its icon and title: three across, or two (`pairs`) for two or four tiles, so none is left alone on a row. */
function Group({ icon, title, pairs = false, children }: { icon: ReactNode; title: string; pairs?: boolean; children: ReactNode }): JSX.Element {
  return (
    <div className="mining__group">
      <h3 className="mining__head">{icon}<span>{title}</span></h3>
      <div className={`mining__grid${pairs ? ' mining__grid--pairs' : ''}`}>{children}</div>
    </div>
  )
}

export function MiningPanel(): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const live = useCyberspace((s) => s.live)
  useMiningStats((s) => s.flips)
  const enabled = useMiningStats((s) => s.enabled)
  const status = useMiningStats((s) => s.status)
  const note = useMiningStats((s) => s.note)
  // The "min ago" moves on by itself.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  // On screen, unfolded: read the other devices (never a write). A folded panel's body is not drawn, so it is never in view.
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = body.current
    if (!me || !el || typeof IntersectionObserver === 'undefined') return
    const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) nudgeMining('panel') })
    seen.observe(el)
    return () => seen.disconnect()
  }, [me])

  const saved = useStarredChunks((s) => s.entries.length)
  const rec = miningRecordFor(me)
  const { c, k } = totalsOf(rec)
  const rare = rarestMined(k)
  const top = topMined(k, TOP_KINDS)
  const today = dayNumber(now)
  const syncedAt = me ? localFor(me, undefined, false).syncedAt : 0
  const line = syncLine({ enabled, live, status, dirty: isDirty(me), syncedAt, now })
  const icon = { size: 13, 'aria-hidden': true, strokeWidth: 2 } as const

  return (
    <section className="panel panel--mining">
      <header className="panel__head"><h2>Mining</h2></header>
      <div className="mining" ref={body}>
        <button type="button" className="cham-btn mining__saved" onClick={() => openSavedChunks()}>
          <Star size={15} strokeWidth={2.25} aria-hidden fill={saved > 0 ? 'currentColor' : 'none'} />
          <span className="mining__saved-label">SAVED CHUNKS ({saved})</span>
          <ChevronRight size={15} strokeWidth={2.25} aria-hidden />
        </button>
        <Group icon={<ScanSearch {...icon} />} title="Surveys">
          <Tile value={num(c.surveys)} label="Surveys" />
          <Tile value={num(c.chunks)} label="Unique chunks" />
          <Tile value={dateWords(rec.first.survey) ?? 'Not yet'} label="First survey" quiet={!rec.first.survey} text />
        </Group>
        <Group icon={<Pickaxe {...icon} />} title="Mining">
          <Tile value={num(c.mined)} label="Blocks mined" />
          <Tile value={rare === null ? 'None yet' : blockName(rare)} label="Rarest find" quiet={rare === null} text={rare === null} wide>
            {rare !== null && <Swatch id={rare} size={18} />}
          </Tile>
          {top.length > 0 && (
            <ul className="mining__kinds" aria-label="Blocks mined most">
              {top.map(([id, n]) => (
                <li key={id} className="mining__kind" title={blockName(id)}>
                  <Swatch id={id} />
                  <span className="mining__kind-num">{num(n)}</span>
                  <span className="mining__kind-name">{blockName(id)}</span>
                </li>
              ))}
            </ul>
          )}
        </Group>
        <Group icon={<Boxes {...icon} />} title="Building" pairs>
          <Tile value={num(c.placed)} label="Blocks placed" />
          <Tile value={num(c.placedAir)} label="Placed in the air" />
        </Group>
        <Group icon={<Hammer {...icon} />} title="Smashes" pairs>
          <Tile value={num(c.smashes)} label="Smashes" />
          <Tile value={num(c.smashCompiler)} label="With the Compiler" />
          <Tile value={num(c.smashBare)} label="Bare-handed" />
          <Tile value={num(c.smashed)} label="Blocks smashed" />
        </Group>
        <Group icon={<Bomb {...icon} />} title="Quarry Charges" pairs>
          <Tile value={num(c.charges)} label="Charges placed" />
          <Tile value={num(c.quarried)} label="Blocks quarried" />
        </Group>
        <Group icon={<Cpu {...icon} />} title="Compiles">
          <Tile value={num(c.compiles)} label="Compiles" />
          <Tile value={num(c.prizes)} label="Prizes taken" />
          <Tile value={dateWords(rec.first.compiler) ?? 'Not yet'} label="Compiler crafted" quiet={!rec.first.compiler} text />
        </Group>
        <Group icon={<DraftingCompass {...icon} />} title="Blueprints">
          <Tile value={num(c.bpMade)} label="Made" />
          <Tile value={num(c.bpPlaced)} label="Left in the world" />
          <Tile value={num(c.bpFound)} label="Found" />
        </Group>
        <Group icon={<Timer {...icon} />} title="Time" pairs>
          <Tile value={timeWords(c.terrainSec)} label="In TERRAIN" />
          <Tile value={num(daysActive(rec))} label="Days active" />
          <Tile value={num(currentStreak(rec, today))} label="Day streak" />
          <Tile value={num(longestStreak(rec))} label="Longest streak" />
        </Group>
      </div>
      <footer className="mining__sync" role="status">
        <span className={`mining__mode mining__mode--${live ? 'live' : 'local'}`}>{live ? 'LIVE' : 'LOCAL'}</span>
        {line.synced ? <Cloud size={13} aria-hidden /> : <CloudOff size={13} aria-hidden />}
        <span className="mining__sync-words">{line.words}</span>
        {line.when && <span className="mining__sync-when">{line.when}</span>}
      </footer>
      {enabled && live && (status === 'error' || status === 'unsupported') && note && <p className="notice" role="status">{note}</p>}
      <Explanation>Everything you do in TERRAIN, added up across your devices. Saved encrypted to you, so only you can read it. Counts and dates only, never where you were. SAVED CHUNKS are the chunks you starred on a survey card, with their cards, saved encrypted to you the same way.</Explanation>
    </section>
  )
}
