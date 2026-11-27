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
 * Opening it saves what changed (no sooner than a minute after the last try)
 * and reads your other devices' numbers.
 *
 * The look: the house chamfer on every tile, a cyan tick on the cut corner,
 * white tabular numbers (drawn from augmented-ui's cut corners and the FUI
 * HUD readouts the owner likes; no dependency).
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Boxes, Cloud, CloudOff, Cpu, DraftingCompass, Hammer, Pickaxe, ScanSearch, Timer } from 'lucide-react'
import { useCyberspace } from '../store/useCyberspace'
import { localFor, miningRecordFor, nudgeMining, useMiningStats } from '../store/miningStats'
import { currentStreak, dayNumber, daysActive, longestStreak, rarestMined, topMined, totalsOf } from '../lib/miningRecord'
import { blockKind, blockName } from '../lib/terrain/blocks'
import { tileUrl } from '../lib/terrain/tiles'
import { Explanation } from './Explanation'

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
  // Opening it saves what changed and reads the other devices.
  useEffect(() => { if (me) nudgeMining('panel') }, [me])

  const rec = miningRecordFor(me)
  const { c, k } = totalsOf(rec)
  const rare = rarestMined(k)
  const top = topMined(k, TOP_KINDS)
  const today = dayNumber(now)
  const syncedAt = me ? localFor(me, undefined, false).syncedAt : 0
  const synced = enabled && live
  const icon = { size: 13, 'aria-hidden': true, strokeWidth: 2 } as const

  return (
    <section className="panel panel--mining">
      <header className="panel__head"><h2>Mining</h2></header>
      <div className="mining">
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
        {synced ? <Cloud size={13} aria-hidden /> : <CloudOff size={13} aria-hidden />}
        <span className="mining__sync-words">{synced ? 'Synced across your devices' : 'Saved on this device only'}</span>
        <span className="mining__sync-when">{synced ? (status === 'syncing' ? 'Syncing' : syncedWords(syncedAt, now)) : enabled ? 'Switch to LIVE to sync' : 'Sync is off in Settings'}</span>
      </footer>
      {synced && (status === 'error' || status === 'unsupported') && note && <p className="notice" role="status">{note}</p>}
      <Explanation>Everything you do in TERRAIN, added up across your devices. Saved encrypted to you, so only you can read it. Counts and dates only, never where you were.</Explanation>
    </section>
  )
}
