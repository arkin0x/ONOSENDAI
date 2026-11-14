/**
 * MenuSheet.tsx - MENU, a top-level area with its own sheet (workshop
 * redesign, phase 1; arkinox, 2026-10-23): the shard list and the ways in,
 * NEW, PASTE and IMPORT, then CLEAR THIS SCENE and the explanation. The open
 * shard's own settings are under SHARD, and the avatar's under AVATAR. Moved
 * from the old panel unchanged; the tutorial still opens the workshop on it.
 */

import { memo } from 'react'
import { ClipboardCopy, CopyPlus } from 'lucide-react'
import { IMPORT_FORMATS_LABEL } from 'sno-core/importFile'
import { bounceChip } from '../../lib/walkBounce'
import { Explanation } from '../../hud/Explanation'
import { ShardFolders, modelEditedAt, modelName, modelRef, useNewestFirst, type DeleteContents } from '../../hud/ShardFolders'
import { ShardThumb } from '../../hud/ShardThumb'
import { usePublished } from '../../store/usePublished'
import { useWorkshop } from '../../store/useWorkshop'
import { BounceChip } from '../shardRows'
import { copyShardById } from '../shardClipboard'

/**
 * A folder's DELETE CONTENTS in the MENU's list (hud/ShardFolders): the
 * shards go in one step and one storage write (useWorkshop removeMany), the
 * folders only once that write is saved (ShardFolders deleteFolderNow), and
 * the ledger is only read, for the note that published ones stay on relays.
 */
const DELETE_CONTENTS: DeleteContents = {
  remove: (refs) => useWorkshop.getState().removeMany(refs),
  published: (refs) => {
    const ledger = usePublished.getState().ledger
    return refs.filter((r) => r in ledger).length
  },
}

/**
 * The SHARDS list in MENU, reading what it lists itself and memoized on which
 * one is open, so a tap on the bench no longer draws it. Workshop renders on
 * every change of the selection, the pick, the notice or the color; with the
 * list inside it, a tap on a face walked every row of a Maze Kit library, a
 * hundred and more, each with its thumbnail and its buttons. It draws when the
 * shards change or another is opened, and not otherwise.
 *
 * Tapping a shard opens it and closes MENU, so the bench is in sight
 * (arkinox, 2026-11-09: "in workshop, tapping a shard in MENU should close
 * the menu"); `onOpen` is that close, and must be stable to keep the memo.
 * The row's other tools (duplicate, copy, move, delete) leave MENU open,
 * and while SELECT is on a tap on the row picks it or lets it go instead,
 * so the picks are not lost to a closing menu (review of PR 631).
 * MENU opens again where it was scrolled to (hooks/useScrollMemory).
 */
export const ShardList = memo(function ShardList({ currentId, onOpen }: { currentId: string; onOpen: () => void }): JSX.Element {
  const shards = useWorkshop((s) => s.shards)
  const w = useWorkshop.getState
  // The list's order (the comment below says why).
  const byRecent = useNewestFirst(shards, modelRef, modelEditedAt)
  return (
    <ul className="workshop__list">
      {/* Last edited first: updatedAt moves on every edit and never on opening (arkinox, 2026-09-26).
          A deploy counts as an edit here, inside its folder (arkinox, 2026-10-23). */}
      <ShardFolders items={byRecent} refOf={modelRef} nameOf={modelName} deleteContents={DELETE_CONTENTS} row={(s, f) => (
        <li key={s.id} className={s.id === currentId ? 'is-current' : ''} {...f.drag}>
          <button className="workshop__pick" aria-pressed={f.selecting ? f.picked : undefined} onClick={() => { if (f.selecting) { f.toggle(); return } w().select(s.id); onOpen() }}>
            <ShardThumb shard={s} own />
            <span className="workshop__pick-name">{s.name}</span>
            {/* The chip rides in the facts line: the row is a two-row grid beside its picture. */}
            <span className="workshop__pick-meta">{s.vertices.length} v · {s.faces.length} f{s.parts?.length ? ` · ${s.parts.length} parts` : ''} · {s.mode}{bounceChip(s) && <> <BounceChip shard={s} /></>}</span>
          </button>
          <button className="workshop__mini" title="Duplicate" aria-label={`Duplicate ${s.name}`} onClick={() => w().duplicate(s.id)}><CopyPlus size={13} strokeWidth={2.25} aria-hidden /></button>
          <button className="workshop__mini" title="Copy to the clipboard" aria-label={`Copy ${s.name} to the clipboard`} onClick={() => copyShardById(s.id)}><ClipboardCopy size={13} strokeWidth={2.25} aria-hidden /></button>
          {f.tool}
          <button className="workshop__mini workshop__mini--danger workshop__mini--x" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => { if (window.confirm(`Delete "${s.name}"? This cannot be undone.`)) w().remove(s.id) }}>×</button>
        </li>
      )} />
    </ul>
  )
})

interface MenuBodyProps {
  /** The open shard's id. */
  currentId: string
  /** Puts MENU away: after a shard is opened from the list. Stable, to keep the list's memo. */
  onOpen: () => void
  /** IMPORT's file picker, kept mounted by the workshop so a closing sheet cannot drop its answer. */
  onImport: () => void
  importing: boolean
  /** The paste box, open or not and what is typed in it: kept by the workshop, so it survives MENU closing. */
  paste: { open: boolean; text: string }
  setPaste: (p: { open: boolean; text: string }) => void
}

/** MENU's body, inside its sheet. */
export function MenuBody({ currentId, onOpen, onImport, importing, paste: box, setPaste }: MenuBodyProps): JSX.Element {
  const shardCount = useWorkshop((s) => s.shards.length)
  const hasContent = useWorkshop((s) => { const c = s.current(); return c !== null && (c.vertices.length > 0 || (c.parts?.length ?? 0) > 0) })
  const pasteOpen = box.open
  const pasteText = box.text
  const setPasteOpen = (open: boolean): void => setPaste({ open, text: open ? box.text : '' })
  const setPasteText = (text: string): void => setPaste({ open: true, text })
  const w = useWorkshop.getState
  const say = (notice: string): void => useWorkshop.setState({ notice })
  const importText = (text: string): void => {
    const id = w().importText(text)
    if (id) { setPasteOpen(false); say('Pasted as a new object.') }
    else say('That is not an object.')
  }
  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) { importText(text); return }
    } catch { /* no permission or no API: fall through to the box */ }
    setPasteOpen(true)
  }
  return (
    <>
      <div className="ws__panel-title">SHARDS ({shardCount})</div>
      <div className="workshop__list-row">
        <button className="workshop__new" onClick={() => w().create()}>+ NEW SHARD</button>
        <button className="workshop__btn" onClick={() => void paste()} title="An object copied from here or anywhere">PASTE</button>
        <button className="workshop__btn" disabled={importing} onClick={onImport} title={`A 3D file, fitted to the grid and put down here: ${IMPORT_FORMATS_LABEL}. Or a .json SNO object, or a .zip of shards, each a new shard. Or drop one on the workshop.`}>{importing ? 'READING' : 'IMPORT'}</button>
      </div>
      {pasteOpen && (
        <div className="workshop__paste">
          <textarea className="workshop__paste-box" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder='Paste an object here: {"v":2,"name":"…","vertices":[…],…}' aria-label="Object to import" spellCheck={false} />
          <div className="workshop__list-row">
            <button className="workshop__btn" disabled={!pasteText.trim()} onClick={() => importText(pasteText)}>IMPORT</button>
            <button className="workshop__btn" onClick={() => setPasteOpen(false)}>CANCEL</button>
          </div>
        </div>
      )}
      <ShardList currentId={currentId} onOpen={onOpen} />
      <div className="workshop__row">
        <button className="workshop__btn workshop__btn--danger" disabled={!hasContent} onClick={() => { if (window.confirm('Delete all vertices, faces and placed objects in the scene?')) w().clearShard() }} title="Empty this scene (undoable)">CLEAR THIS SCENE</button>
        <span className="workshop__gap" />
        <Explanation>
          An object is colored points on a grid of whole units, drawn SOLID (faces, colors blending
          across them), POINTS (every point a light) or LINES (one line through the points in the
          order they were made). STAMP places a whole shape; ADD one point; SELECT points, by tap
          or by dragging a box, to move, color or delete them together, and JOINED takes everything
          faces join to them; FACE picks corners and FILL joins them, and a tap on a face selects it
          to move, color, flip or delete. Your color, last in the dock, opens all 256 colors, with the ones you
          used most recently on top; the buttons at the bottom right put the color on the whole object, the
          connected piece or the selected points, and the dropper takes a point's or face's color. Stamps keep their own corners even where they touch, so a red block against a
          blue one keeps a crisp edge. The arrows on the left set LEVEL, the height the placing tools work at.
          Under GRID, DEPLOY SCALE MULTIPLIER says how big one grid unit is in the world, from a picometre to
          the width of a sector, and GRID SIZE is how far the grid reaches from the origin. DEPLOY shows
          the object at true size before you place it. Under SHARD, PUBLISH puts the shard on your relays as a
          public object: the Shard Feed lists it, anyone can place it, and PUBLISH AGAIN replaces it under the same
          address; RETRACT asks the relays to drop it. That is separate from hiding, which seals a copy at a place.
          Keys: 1 LOOK, 2 STAMP, 3 ADD, 4 SELECT, 5 FACE, Q turns a stamp, WASD and
          RF or the arrows nudge the selection in screen directions, C selects what faces join, Del
          deletes, Enter fills, [ ] change the level, Ctrl+Z undoes, Esc closes a sheet, then
          clears, then closes the workshop.
        </Explanation>
      </div>
    </>
  )
}
