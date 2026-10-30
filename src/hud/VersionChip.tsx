/**
 * VersionChip.tsx - a newer ONOSENDAI is deployed (lib/versionGate.ts).
 *
 * Required (the deploy asks for newer chain rules than this build's): a red
 * bar at the top of the instrument stack, NEW VERSION, RELOAD TO MOVE, and
 * one RELOAD. Every move is refused meanwhile (store whyNoMove) and nothing
 * on the chain is sent (lib/publisher.ts); looking, reading and chat go on.
 *
 * Only the build differs: a plain chip with RELOAD, gone when tapped, back
 * for the next build. Nothing is refused.
 */

import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useVersionGate, type Verdict } from '../lib/versionGate'

const reload = (): void => window.location.reload()

export function VersionChip(): JSX.Element | null {
  const verdict = useVersionGate((s) => s.verdict)
  const build = useVersionGate((s) => s.deployed?.build ?? null)
  const dismissed = useVersionGate((s) => s.hintDismissed)
  return <VersionChipView verdict={verdict} build={build} dismissed={dismissed} />
}

/** The chip for a verdict, the deployed build, and the build whose hint was dismissed. */
export function VersionChipView({ verdict, build, dismissed }: { verdict: Verdict; build: string | null; dismissed: string | null }): JSX.Element | null {
  if (verdict === 'blocked') {
    return (
      <div className="hyperbar hyperbar--broken hyperbar--version" role="alert" title="The chain rules changed. Moves wait for a reload; looking and chat still work.">
        <TriangleAlert size={14} strokeWidth={2.5} aria-hidden className="hyperbar__glyph" />
        <span className="hyperbar__text">
          <span className="hyperbar__label">NEW VERSION</span>
          <span className="hyperbar__meta">RELOAD TO MOVE</span>
        </span>
        <button className="hyperbar__end" onClick={reload}>RELOAD</button>
      </div>
    )
  }
  if (verdict !== 'hint' || build === null || dismissed === build) return null
  return (
    <div className="hyperbar hyperbar--version" role="status" onClick={() => useVersionGate.getState().dismissHint()} title="Tap to dismiss">
      <RefreshCw size={14} strokeWidth={2.5} aria-hidden className="hyperbar__glyph" />
      <span className="hyperbar__text">
        <span className="hyperbar__label">NEW VERSION</span>
        <span className="hyperbar__meta">reload when ready</span>
      </span>
      <button className="hyperbar__end" onClick={(e) => { e.stopPropagation(); reload() }}>RELOAD</button>
    </div>
  )
}
