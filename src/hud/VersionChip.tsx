/**
 * VersionChip.tsx - a newer ONOSENDAI is deployed (lib/versionGate.ts).
 *
 * Required (the deploy asks for newer chain rules than this build's): a red
 * bar at the top of the instrument stack, NEW VERSION, RELOAD TO MOVE, and
 * one RELOAD. Every move is refused meanwhile (store whyNoMove) and nothing
 * on the chain is sent (lib/publisher.ts); looking, reading and chat go on.
 *
 * Saving is refused (the deploy asks for a newer workshop schema,
 * lib/workshopSchema.ts): the same red bar, NEW VERSION, RELOAD TO SAVE YOUR
 * WORK. No shard is saved, imported or published meanwhile; the unsaved
 * changes are held across the reload (store/workshopStorage.ts). The
 * workshop shows the same bar over its bench (SaveGateBar below, mounted by workshop/Workshop.tsx).
 *
 * Only the build differs: a plain chip with RELOAD and a ✕, gone when
 * tapped or when the ✕ is pressed (a button, so a keyboard reaches it too),
 * back for the next build. Nothing is refused.
 *
 * Never on the TV stream: the normal app shows for a moment while the
 * stream reloads, and nobody there can press anything (lib/tv/broadcast.ts).
 */

import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useVersionGate, type Verdict } from '../lib/versionGate'
import { isBroadcast } from '../lib/tv/broadcast'

const reload = (): void => window.location.reload()

export function VersionChip(): JSX.Element | null {
  const verdict = useVersionGate((s) => s.verdict)
  const build = useVersionGate((s) => s.deployed?.build ?? null)
  const dismissed = useVersionGate((s) => s.hintDismissed)
  const savesBlocked = useVersionGate((s) => s.savesBlocked)
  return <VersionChipView verdict={verdict} build={build} dismissed={dismissed} savesBlocked={savesBlocked} />
}

/** The red bar for refused saves, NEW VERSION, RELOAD TO SAVE YOUR WORK, and one RELOAD. Here and in the workshop. */
export function SaveBlockedBar(): JSX.Element {
  return (
    <div className="hyperbar hyperbar--broken hyperbar--version" role="alert" title="Shards are not saved until you reload. Your unsaved changes come back after the reload.">
      <TriangleAlert size={14} strokeWidth={2.5} aria-hidden className="hyperbar__glyph" />
      <span className="hyperbar__text">
        <span className="hyperbar__label">NEW VERSION</span>
        <span className="hyperbar__meta">RELOAD TO SAVE YOUR WORK</span>
      </span>
      <button className="hyperbar__end" onClick={reload}>RELOAD</button>
    </div>
  )
}

/** The chip for a verdict, the deployed build, the build whose hint was dismissed, and whether saving is refused. */
export function VersionChipView({ verdict, build, dismissed, savesBlocked = false }: { verdict: Verdict; build: string | null; dismissed: string | null; savesBlocked?: boolean }): JSX.Element | null {
  if (isBroadcast()) return null
  if (verdict === 'blocked') {
    return (
      <div className="hyperbar hyperbar--broken hyperbar--version" role="alert" title="The chain rules changed. Moves wait for a reload; looking and chat still work.">
        <TriangleAlert size={14} strokeWidth={2.5} aria-hidden className="hyperbar__glyph" />
        <span className="hyperbar__text">
          <span className="hyperbar__label">NEW VERSION</span>
          <span className="hyperbar__meta">{savesBlocked ? 'RELOAD TO MOVE AND SAVE' : 'RELOAD TO MOVE'}</span>
        </span>
        <button className="hyperbar__end" onClick={reload}>RELOAD</button>
      </div>
    )
  }
  if (savesBlocked) return <SaveBlockedBar />
  if (verdict !== 'hint' || build === null || dismissed === build) return null
  return (
    <div className="hyperbar hyperbar--version" role="status" onClick={() => useVersionGate.getState().dismissHint()} title="Tap to dismiss">
      <RefreshCw size={14} strokeWidth={2.5} aria-hidden className="hyperbar__glyph" />
      <span className="hyperbar__text">
        <span className="hyperbar__label">NEW VERSION</span>
        <span className="hyperbar__meta">reload when ready</span>
      </span>
      <button className="hyperbar__end" onClick={(e) => { e.stopPropagation(); reload() }}>RELOAD</button>
      <button className="version__dismiss" aria-label="Dismiss" title="Dismiss" onClick={(e) => { e.stopPropagation(); useVersionGate.getState().dismissHint() }}>✕</button>
    </div>
  )
}

/**
 * A newer deploy refuses this tab's saves (lib/versionGate.ts savesBlocked):
 * the instrument stack's red bar, over the workshop's bench
 * (workshop/Workshop.tsx), from the moment it is known and before anything is
 * edited, so the reload can come first.
 */
export function SaveGateBar(): JSX.Element | null {
  return <SaveGateBarView blocked={useVersionGate((s) => s.savesBlocked)} />
}

/** The bar for whether saving is refused; nothing on the TV stream. */
export function SaveGateBarView({ blocked }: { blocked: boolean }): JSX.Element | null {
  if (!blocked || isBroadcast()) return null
  return <div className="ws__savegate"><SaveBlockedBar /></div>
}
