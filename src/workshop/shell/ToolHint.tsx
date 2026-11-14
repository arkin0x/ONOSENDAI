/**
 * ToolHint.tsx - one line over the strip saying what a tap does with the tool
 * in hand (workshop redesign, phase 4). It fades for good once the tool has
 * been used a few times (beginner.ts HINT_USES): a use is an edit or a pick
 * made with it, or for LOOK a turn of the view. The strip's ? says more,
 * whenever it is wanted. It takes no taps: the bench is underneath.
 */

import { useEffect, useState } from 'react'
import { useWorkshop, type Tool } from '../../store/useWorkshop'
import { HINT_USES, useBeginner, useViewTurned } from '../beginner'

/** The line for the tool in hand, as the store stands. Pure. */
export function hintFor(s: Pick<ReturnType<typeof useWorkshop.getState>, 'tool' | 'stampMode' | 'stampKind' | 'selectKind' | 'boxSelect' | 'paintMode' | 'facePick'>): string {
  switch (s.tool) {
    case 'view': return 'Drag to turn the view. Two fingers pan and zoom.'
    case 'stamp': return s.stampMode === 'object' ? 'Tap the grid to place the object' : `Tap the grid to place a ${s.stampKind.toUpperCase()}`
    case 'select': return s.boxSelect ? `Drag a box around the ${s.selectKind} to hold them` : `Tap ${s.selectKind === 'objects' ? 'placed objects' : s.selectKind} to hold them`
    case 'paint': return s.paintMode === 'all' ? 'Tap the object to paint all of it' : s.paintMode === 'piece' ? 'Tap to paint the whole piece' : `Tap a ${s.paintMode} to paint it`
    case 'add': return 'Tap the grid to place a point'
    case 'face': {
      const left = 3 - s.facePick.length
      return s.facePick.length === 0 ? 'Tap corners in order, then FILL' : left > 0 ? `Tap ${left} more corner${left === 1 ? '' : 's'}, then FILL` : 'Tap FILL, or the first corner again'
    }
  }
}

export function ToolHint({ hidden }: { hidden: boolean }): JSX.Element | null {
  const s = useWorkshop()
  const uses = useBeginner((b) => b.uses)
  const guiding = useBeginner((b) => b.step !== null)
  const tool: Tool = s.tool
  const left = (uses[tool] ?? 0) < HINT_USES
  // A use: the shard changed under this tool, or what it picked did.
  useEffect(() => {
    if (!left) return
    let last = 0
    return useWorkshop.subscribe((n, p) => {
      if (n.tool !== tool || n.currentId !== p.currentId) return
      // `current()` reads the store as it is now, so the shard list itself is what is compared.
      const used = n.shards !== p.shards || n.selection !== p.selection || n.selectedFaces !== p.selectedFaces || n.partSel !== p.partSel || n.facePick !== p.facePick
      // One use per action, however many writes it made.
      if (!used || Date.now() - last < 400) return
      last = Date.now()
      useBeginner.getState().bump(tool)
    })
  }, [tool, left])
  // LOOK's use is a turn of the view; it re-arms after each.
  const [turns, setTurns] = useState(0)
  useViewTurned(tool === 'view' && left, () => { useBeginner.getState().bump('view'); setTurns((n) => n + 1) }, 0.45, turns)
  const holding = s.selection.length > 0 || s.partSel.length > 0 || s.selectedFaces.length > 0
  if (hidden || guiding || holding || !left) return null
  return <div className="ws__toolhint" role="status">{hintFor(s)}</div>
}
