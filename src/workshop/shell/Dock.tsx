/**
 * Dock.tsx - the dock, along the bottom, one of the workshop's five fixed
 * places (workshop redesign, phase 1): the tools in a fixed order, each an
 * icon and a word, then the color in hand, always last. The tool in hand is
 * lit. It replaces the TOOLS chip and panel and the put-down X: LOOK is the
 * tool that builds nothing, a tap away like the rest. The keys run 1 to 6
 * along the dock, left to right: 1 LOOK, 2 STAMP, 3 SELECT, 4 PAINT, 5 ADD,
 * 6 FACE (owner ruling, 2026-11-15).
 */

import { Eye, MousePointer2, Paintbrush, Plus, Stamp, Triangle, type LucideIcon } from 'lucide-react'
import { shownTools, useBeginner, useDockTools } from '../beginner'
import { rgbToHex } from 'sno-core/shards'
import { useWorkshop, type Tool } from '../../store/useWorkshop'
import { useTutorial } from '../../store/useTutorial'
import { WORKSHOP_STEP_ID } from './TutorialTip'

/** A tool's slot: what it is called on the dock and the key that picks it. */
export interface ToolSlot { tool: Tool; label: string; icon: LucideIcon; key: string }

/**
 * The order the dock shows them, which never changes: the proposal's order,
 * LOOK, STAMP, SELECT, PAINT (a beginner's four), then ADD and FACE. The keys
 * follow the same order, 1 to 6.
 */
export const DOCK: ToolSlot[] = [
  { tool: 'view', label: 'LOOK', icon: Eye, key: '1' },
  { tool: 'stamp', label: 'STAMP', icon: Stamp, key: '2' },
  { tool: 'select', label: 'SELECT', icon: MousePointer2, key: '3' },
  { tool: 'paint', label: 'PAINT', icon: Paintbrush, key: '4' },
  { tool: 'add', label: 'ADD', icon: Plus, key: '5' },
  { tool: 'face', label: 'FACE', icon: Triangle, key: '6' },
]

/**
 * Whether the dock shows a beginner's four (phase 4, decision 4): only for a
 * beginner, unless the tool in hand is one of the other two, and never on the
 * tour's workshop step, whose tip names ADD (owner, 2026-11-23: "Tap STAMP to
 * add pre-made shapes, or ADD to hand-craft your object's points"). The tour
 * shows all six there without keeping the choice: after the step a beginner
 * has the four and MORE TOOLS again.
 */
export function dockShowsFour(tools: 'four' | 'all' | null, tool: Tool, tourStep: boolean): boolean {
  return tools === 'four' && tool !== 'add' && tool !== 'face' && !tourStep
}

/** A tool's slot by its id. */
export const slotOf = (tool: Tool): ToolSlot => DOCK.find((d) => d.tool === tool) ?? DOCK[0]

export function Dock({ onColor, colorOpen }: { onColor: () => void; colorOpen: boolean }): JSX.Element {
  const tool = useWorkshop((s) => s.tool)
  const hex = rgbToHex(useWorkshop((s) => s.color))
  const tools = useDockTools()
  const glow = useBeginner((b) => b.glow)
  const w = useWorkshop.getState
  const tourStep = useTutorial((s) => s.active && s.script.steps[s.index]?.id === WORKSHOP_STEP_ID)
  const four = dockShowsFour(tools, tool, tourStep)
  const shown = shownTools(four ? 'four' : 'all')
  return (
    <nav className="ws__dock" aria-label="Tools">
      {DOCK.filter((d) => shown.has(d.tool)).map(({ tool: t, label, icon: Icon, key }) => (
        <button key={t} className={`ws__dockbtn${tool === t ? ' is-on' : ''}${glow === t ? ' is-guide' : ''}`} aria-pressed={tool === t} onClick={() => w().setTool(t)} title={`${label} (${key})`}>
          <Icon size={20} strokeWidth={2} aria-hidden />
          <span>{label}</span>
          {/* The key, printed on the button where there is a keyboard (phase 5). */}
          <kbd className="ws__key" aria-hidden>{key}</kbd>
        </button>
      ))}
      {/* MORE TOOLS: ADD and FACE join the dock to the right; the first four never move. MENU puts them away again. */}
      {four && (
        <button className="ws__dockbtn ws__dockbtn--more" onClick={() => useBeginner.getState().setTools('all')} title="Add ADD and FACE to the dock">
          <Plus size={20} strokeWidth={2} aria-hidden />
          <span>MORE TOOLS</span>
        </button>
      )}
      <button
        className={`ws__colorchip${colorOpen ? ' is-on' : ''}`}
        style={{ background: hex }}
        onClick={onColor}
        aria-expanded={colorOpen}
        title={`${hex}. Tap for all 256.`}
        aria-label={`Color ${hex}, tap to open the palette`}
      />
    </nav>
  )
}
