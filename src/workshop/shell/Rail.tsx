/**
 * Rail.tsx - the left rail, one of the workshop's five fixed places
 * (workshop redesign, phase 1): UNDO and REDO, then the grid floor's LEVEL up,
 * its value, and down, then GROUPS (2026-11-23). The same corner they had, so
 * old habits still work, and never hidden: no sheet, panel or tool takes them
 * away (they used to go whenever a panel opened).
 *
 * GROUPS sits here because the rail is the one place in sight in every state
 * the groups need: nothing held (the strip has SELECT's options, with no room
 * left at 375px), holding (the strip is the held bar's eight fixed slots),
 * and with the GROUPS sheet open, which never covers the rail. So the key
 * that opened the sheet stays lit and closes it again, as the top bar's do.
 * Greyed in LOOK, which holds nothing; G does the same in every other tool.
 */

import { ChevronDown, ChevronUp, Group, Redo2, Undo2 } from 'lucide-react'
import { TICKS_PER_UNIT, unitsLabel } from 'sno-core/shards'
import { useRepeatable } from '../../hooks/useRepeatable'
import { hiddenIn, useWorkshop } from '../../store/useWorkshop'
import { isLook } from '../lookTool'

/** The plane's name under the level: the floor is the floor, a wall is named by its axis. */
const PLANE_LABEL = ['LEVEL X', 'FLOOR', 'LEVEL Z'] as const

/**
 * The grid floor's LEVEL (arkinox, 2026-10-10): one step of the current
 * division per press, held to repeat, the same step as the ] and [ keys, so
 * stacking things never means opening a panel between layers. One copy now:
 * GRID's second one went, since this one never hides.
 */
function LevelStack(): JSX.Element {
  const level = useWorkshop((s) => s.level)
  const plane = useWorkshop((s) => s.plane)
  const extentTicks = useWorkshop((s) => (s.current()?.extent ?? 0) * TICKS_PER_UNIT)
  const bind = useRepeatable()
  const w = useWorkshop.getState
  return (
    <div className="ws__level" role="group" aria-label="Grid level">
      <button className="ws__railbtn" {...bind(() => w().setLevel(w().level + w().step()))} disabled={level >= extentTicks} title="Raise the grid floor one step (])" aria-label="Raise the grid floor">
        <ChevronUp size={18} strokeWidth={2.25} aria-hidden />
      </button>
      <span className="ws__level-value" title={`LEVEL ${'XYZ'[plane]}: the height the placing tools work at`}>
        <b>{unitsLabel(level)}</b>
        <span>{PLANE_LABEL[plane]}</span>
      </span>
      <button className="ws__railbtn" {...bind(() => w().setLevel(w().level - w().step()))} disabled={level <= -extentTicks} title="Lower the grid floor one step ([)" aria-label="Lower the grid floor">
        <ChevronDown size={18} strokeWidth={2.25} aria-hidden />
      </button>
    </div>
  )
}

/**
 * GROUPS: opens and closes the GROUPS sheet (G), lit while it is open. A
 * badge counts the groups hidden on the bench, so they are not forgotten
 * with the sheet shut. The word under it stands over the scene: white.
 */
/**
 * Whether G opens GROUPS now. In STAMP's OBJECT, G is SNAP TO ITS SIZE
 * (Bench Keys, its key printed on the strip), so there it is SNAP's alone and
 * this key prints no G: one key, one meaning, one printed hint.
 */
export function gOpensGroups(s: { tool: string; stampMode: string }): boolean {
  return !(s.tool === 'stamp' && s.stampMode === 'object')
}

function GroupsKey({ open, onToggle }: { open: boolean; onToggle: () => void }): JSX.Element {
  const look = useWorkshop((s) => isLook(s.tool))
  const hidden = useWorkshop((s) => hiddenIn(s.hiddenGroups, s.current()).length)
  const keyed = useWorkshop(gOpensGroups)
  const named = keyed ? 'Groups (G)' : 'Groups'
  const title = look ? 'GROUPS: pick a tool other than LOOK' : hidden > 0 ? `${named}: ${hidden} hidden on the bench` : named
  return (
    <div className="ws__railkey">
      <button className={`ws__railbtn ws__railbtn--groups${open ? ' is-on' : ''}`} disabled={look} aria-pressed={open} onClick={onToggle} title={title} aria-label="Groups">
        <Group size={18} strokeWidth={2.25} aria-hidden />
        <span className="ws__railbtn-word">GROUPS</span>
        {hidden > 0 && !look && <i className="ws__badge ws__badge--hidden" aria-hidden>{hidden}</i>}
      </button>
      <span className="ws__rail-label" aria-hidden>GROUPS{keyed && <kbd className="ws__key ws__rail-kbd">G</kbd>}</span>
    </div>
  )
}

export function Rail({ groupsOpen = false, onGroups }: { groupsOpen?: boolean; onGroups?: () => void } = {}): JSX.Element {
  const canUndo = useWorkshop((s) => s.past.length > 0)
  const canRedo = useWorkshop((s) => s.future.length > 0)
  const w = useWorkshop.getState
  return (
    <nav className="ws__rail" aria-label="History and level">
      <button className="ws__railbtn" disabled={!canUndo} onClick={() => w().undo()} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={18} strokeWidth={2.25} aria-hidden /></button>
      <button className="ws__railbtn" disabled={!canRedo} onClick={() => w().redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={18} strokeWidth={2.25} aria-hidden /></button>
      <LevelStack />
      {onGroups && <GroupsKey open={groupsOpen} onToggle={onGroups} />}
    </nav>
  )
}
