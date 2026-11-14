/**
 * Dock.tsx - the dock, along the bottom, one of the workshop's five fixed
 * places (workshop redesign, phase 1): the tools in a fixed order, each an
 * icon and a word, then the color in hand, always last. The tool in hand is
 * lit. It replaces the TOOLS chip and panel and the put-down X: LOOK is the
 * tool that builds nothing, a tap away like the rest. The keys stay as they
 * were (1 LOOK, 2 STAMP, 3 ADD, 4 SELECT, 5 FACE), and PAINT, the sixth
 * tool (phase 3), is 6.
 */

import { Eye, MousePointer2, Paintbrush, Plus, Stamp, Triangle, type LucideIcon } from 'lucide-react'
import { rgbToHex } from 'sno-core/shards'
import { useWorkshop, type Tool } from '../../store/useWorkshop'

/** A tool's slot: what it is called on the dock and the key that picks it. */
export interface ToolSlot { tool: Tool; label: string; icon: LucideIcon; key: string }

/**
 * The order the dock shows them, which never changes: the proposal's order,
 * LOOK, STAMP, SELECT, PAINT (a beginner's four), then ADD and FACE.
 */
export const DOCK: ToolSlot[] = [
  { tool: 'view', label: 'LOOK', icon: Eye, key: '1' },
  { tool: 'stamp', label: 'STAMP', icon: Stamp, key: '2' },
  { tool: 'select', label: 'SELECT', icon: MousePointer2, key: '4' },
  { tool: 'paint', label: 'PAINT', icon: Paintbrush, key: '6' },
  { tool: 'add', label: 'ADD', icon: Plus, key: '3' },
  { tool: 'face', label: 'FACE', icon: Triangle, key: '5' },
]

/** A tool's slot by its id. */
export const slotOf = (tool: Tool): ToolSlot => DOCK.find((d) => d.tool === tool) ?? DOCK[0]

export function Dock({ onColor, colorOpen }: { onColor: () => void; colorOpen: boolean }): JSX.Element {
  const tool = useWorkshop((s) => s.tool)
  const hex = rgbToHex(useWorkshop((s) => s.color))
  const w = useWorkshop.getState
  return (
    <nav className="ws__dock" aria-label="Tools">
      {DOCK.map(({ tool: t, label, icon: Icon, key }) => (
        <button key={t} className={`ws__dockbtn${tool === t ? ' is-on' : ''}`} aria-pressed={tool === t} onClick={() => w().setTool(t)} title={`${label} (${key})`}>
          <Icon size={20} strokeWidth={2} aria-hidden />
          <span>{label}</span>
        </button>
      ))}
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
