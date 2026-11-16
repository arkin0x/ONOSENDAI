/**
 * ToolHint.tsx - one line over the strip saying what a tap does with the tool
 * in hand (workshop redesign, phase 4). It fades for good once the tool has
 * been used a few times (beginner.ts HINT_USES): a use is an edit or a pick
 * made with it, or for LOOK a turn of the view. The strip's ? says more,
 * whenever it is wanted. It takes no taps: the bench is underneath.
 */

import { useEffect, useState } from 'react'
import { shallow } from 'zustand/shallow'
import { useWorkshop, type Tool } from '../../store/useWorkshop'
import { isLook } from '../lookTool'
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

/**
 * The hint, while the tool in hand still has one: past its last use this
 * holds no subscription to the workshop at all.
 */
export function ToolHint({ hidden }: { hidden: boolean }): JSX.Element | null {
  const tool = useWorkshop((s) => s.tool)
  const left = useBeginner((b) => (b.uses[tool] ?? 0) < HINT_USES)
  const guiding = useBeginner((b) => b.step !== null)
  if (!left) return null
  return <LiveHint tool={tool} hidden={hidden || guiding} />
}

function LiveHint({ tool, hidden }: { tool: Tool; hidden: boolean }): JSX.Element | null {
  const s = useWorkshop((w) => ({ tool: w.tool, stampMode: w.stampMode, stampKind: w.stampKind, selectKind: w.selectKind, boxSelect: w.boxSelect, paintMode: w.paintMode, facePick: w.facePick, holding: w.selection.length > 0 || w.partSel.length > 0 || w.selectedFaces.length > 0 }), shallow)
  // A use: an edit made with this tool to the shard on the bench (not an
  // UNDO, which grows the future), or a change to what it picked.
  useEffect(() => {
    let last = 0
    return useWorkshop.subscribe((n, p) => {
      if (n.tool !== tool || n.currentId !== p.currentId) return
      // `current()` reads the store as it is now, so each state's own list is searched.
      const edited = n.future.length <= p.future.length && n.shards.find((x) => x.id === n.currentId) !== p.shards.find((x) => x.id === p.currentId)
      const used = edited || n.selection !== p.selection || n.selectedFaces !== p.selectedFaces || n.partSel !== p.partSel || n.facePick !== p.facePick
      // One use per action, however many writes it made.
      if (!used || Date.now() - last < 400) return
      last = Date.now()
      useBeginner.getState().bump(tool)
    })
  }, [tool])
  // LOOK's use is a turn of the view; it re-arms after each.
  const [turns, setTurns] = useState(0)
  useViewTurned(tool === 'view', () => { useBeginner.getState().bump('view'); setTurns((n) => n + 1) }, 0.45, turns)
  // The held bar's place while something is held, except in LOOK, where the held bar does not show (Strip).
  if (hidden || (s.holding && !isLook(tool))) return null
  return <div className="ws__toolhint" role="status">{hintFor(s)}</div>
}
