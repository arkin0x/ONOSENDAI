/**
 * ShardFolders.tsx - the folders every shard list is sorted into: the
 * workshop MENU's SHARDS, PLACE OBJECT's MINE and STAMP's objects. One
 * component over one store (store/useShardFolders.ts), so the three lists
 * show the same folders and behave the same.
 *
 * It renders into the caller's own <ul>: a bar (+ FOLDER, SELECT), then the
 * folders, then the shards in no folder. Each shard row is still the
 * caller's own <li>, drawn by `row`; the kit it is handed adds what a row
 * needs to be filed: drag props for its <li> and one small tool, MOVE TO
 * FOLDER, or a checkbox while SELECT is on. Dragging is for a mouse; the
 * tool works everywhere, phones included.
 *
 * A folder's head folds it (the fold is kept), and holds RENAME, NEW FOLDER
 * inside it, MOVE and DELETE. Deleting never touches a shard: what was in
 * the folder moves up to its parent.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderInput, FolderPlus, Pencil, X } from 'lucide-react'
import { buildTree, canonical, flatFolders, newestFirst, parentOf, folderOf, isWithin, pathOf, type FolderNode, type FolderTree } from '../lib/shardFolders'
import { useShardFolders } from '../store/useShardFolders'
import { useCyberspace } from '../store/useCyberspace'
import { useEscape } from '../hooks/useEscape'
import { ConfirmModal } from './ConfirmModal'

/** The drag payload's type, so a file dragged onto the workshop is never read as a shard. */
const DRAG_TYPE = 'application/x-onosendai-folder-item'

type Dragged = { kind: 'shards'; refs: string[] } | { kind: 'folder'; id: string }

/** What a shard row is handed to be filed. */
export interface RowKit {
  /** Spread on the row's <li>. */
  drag: {
    draggable?: boolean
    onDragStart?: (e: DragEvent) => void
    onDragEnd?: () => void
  }
  /** MOVE TO FOLDER, or the row's checkbox while selecting. */
  tool: JSX.Element
}

interface Props<T> {
  items: readonly T[]
  refOf: (item: T) => string
  nameOf: (item: T) => string
  /** The caller's own row, an <li>; put kit.drag on it and kit.tool inside it. */
  row: (item: T, kit: RowKit) => JSX.Element
}

/** A workshop model's ref and name, for the lists of models (stable, so the tree is not rebuilt every render). */
export const modelRef = (s: { id: string }): string => s.id
export const modelName = (s: { name: string }): string => s.name
export const modelEditedAt = (s: { updatedAt?: number }): number => s.updatedAt ?? 0

/**
 * A shard list in the order every one of them is drawn: last edited or last
 * deployed first, whichever is later (lib/shardFolders.ts newestFirst), so
 * the lists cannot drift apart. `refOf` and `editedAt` should be stable.
 */
export function useNewestFirst<T>(items: readonly T[], refOf: (item: T) => string, editedAt: (item: T) => number): T[] {
  const used = useShardFolders((s) => s.tree.used)
  return useMemo(() => newestFirst(items, refOf, editedAt, used), [items, refOf, editedAt, used])
}

/** Whether there is a mouse to drag with: phones get the tool alone, so a long press stays a press. */
function canDrag(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

function readDrag(e: DragEvent): Dragged | null {
  try {
    const d = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as Dragged
    if (d.kind === 'shards' && Array.isArray(d.refs)) return d
    if (d.kind === 'folder' && typeof d.id === 'string') return d
  } catch { /* not ours */ }
  return null
}

/**
 * The folder being dragged, if one is: a drop target cannot read the drag's
 * data until the drop, and it needs to know sooner whether to light up.
 */
let draggingFolder: string | null = null

const ours = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes(DRAG_TYPE)

/** What the chooser is moving: shards, or one folder. */
type Moving = { kind: 'shards'; refs: string[]; label: string } | { kind: 'folder'; id: string; label: string }

/** Open a folder and every folder above it, so a new folder is in sight to be named. */
function unfold(id: string | null): void {
  const f = useShardFolders.getState
  const t = f().tree
  for (let at = canonical(t, id), n = 0; at !== null && n < 64; at = parentOf(t, at), n += 1) if (t.collapsed[at]) f().setCollapsed(at, false)
}

/** Make a folder in `parent`, opening the way to it; its id, or null. */
export function makeFolder(parent: string | null): string | null {
  const f = useShardFolders.getState
  const id = f().createFolder(`Folder ${Object.keys(f().tree.folders).length + 1}`, parent)
  if (id) unfold(parent)
  return id
}

/** Move what the chooser holds into `to`. A folded folder stays folded (arkinox, 2026-10-23). */
export function moveTo(moving: Moving, to: string | null): void {
  if (moving.kind === 'shards') useShardFolders.getState().assignToFolder(moving.refs, to)
  else useShardFolders.getState().moveFolder(moving.id, to)
}

export function ShardFolders<T>({ items, refOf, nameOf, row }: Props<T>): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const tree = useShardFolders((s) => s.tree)
  useEffect(() => {
    const st = useShardFolders.getState()
    if (st.owner !== me) void st.load(me)
  }, [me])
  const f = useShardFolders.getState

  const built = useMemo(() => buildTree(tree, items, refOf), [tree, items, refOf])
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [moving, setMoving] = useState<Moving | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const drag = useMemo(canDrag, [])

  // A picked shard that left the list is no longer picked.
  const present = useMemo(() => new Set(items.map(refOf)), [items, refOf])
  const pickedNow = [...picked].filter((r) => present.has(r))

  const stopSelecting = (): void => { setSelecting(false); setPicked(new Set()) }
  const newFolder = (parent: string | null): void => {
    const id = makeFolder(parent)
    if (id) setRenaming(id)
  }

  const dropOn = (folder: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!ours(e)) return
      // A folder is never dropped into itself or under itself: no highlight, no drop.
      if (draggingFolder !== null && folder !== null && isWithin(f().tree, folder, draggingFolder)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (over !== (folder ?? '')) setOver(folder ?? '')
    },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setOver(null) },
    onDrop: (e: DragEvent) => {
      if (!ours(e)) return
      e.preventDefault()
      e.stopPropagation()
      setOver(null)
      const d = readDrag(e)
      if (!d) return
      if (d.kind === 'shards') f().assignToFolder(d.refs, folder)
      else if (d.id !== folder) f().moveFolder(d.id, folder)
    },
  })

  const startDrag = (e: DragEvent, d: Dragged): void => {
    e.stopPropagation()
    draggingFolder = d.kind === 'folder' ? d.id : null
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d))
    e.dataTransfer.effectAllowed = 'move'
  }

  const kitFor = (item: T): RowKit => {
    const ref = refOf(item)
    const tool = selecting ? (
      <input
        type="checkbox"
        className="sfold__check"
        checked={picked.has(ref)}
        onChange={(e) => { const next = new Set(picked); if (e.target.checked) next.add(ref); else next.delete(ref); setPicked(next) }}
        aria-label={`Select ${nameOf(item)}`}
      />
    ) : (
      <button className="sfold__mini" title="Move to a folder" aria-label={`Move ${nameOf(item)} to a folder`} onClick={() => setMoving({ kind: 'shards', refs: [ref], label: nameOf(item) })}>
        <FolderInput size={13} strokeWidth={2.25} aria-hidden />
      </button>
    )
    if (!drag) return { drag: {}, tool }
    return {
      drag: {
        draggable: true,
        onDragStart: (e) => startDrag(e, { kind: 'shards', refs: selecting && picked.has(ref) ? pickedNow : [ref] }),
        onDragEnd: () => { draggingFolder = null; setOver(null) },
      },
      tool,
    }
  }

  const rows = (list: readonly T[]): JSX.Element[] => list.map((item) => <Fragment key={refOf(item)}>{row(item, kitFor(item))}</Fragment>)

  const folderRow = (node: FolderNode<T>): JSX.Element => {
    const { folder } = node
    const open = !tree.collapsed[folder.id]
    const Chevron = open ? ChevronDown : ChevronRight
    return (
      <li key={folder.id} className={`sfold ${over === folder.id ? 'is-over' : ''}`}>
        <div
          className="sfold__head"
          draggable={drag && renaming !== folder.id ? true : undefined}
          onDragStart={drag ? (e) => startDrag(e, { kind: 'folder', id: folder.id }) : undefined}
          onDragEnd={() => { draggingFolder = null; setOver(null) }}
          {...dropOn(folder.id)}
        >
          {renaming === folder.id ? (
            <RenameField name={folder.name} onDone={(name) => { if (name !== null) f().renameFolder(folder.id, name); setRenaming(null) }} />
          ) : (
            <button className="sfold__toggle" aria-expanded={open} onClick={() => f().setCollapsed(folder.id, open)} title={open ? 'Fold' : 'Unfold'}>
              <Chevron size={12} strokeWidth={2.25} aria-hidden />
              <FolderIcon size={12} strokeWidth={2.25} aria-hidden />
              <span className="sfold__name">{folder.name}</span>
              <span className="sfold__count">{node.count}</span>
            </button>
          )}
          {renaming !== folder.id && (
            <>
              <button className="sfold__mini" title="Rename" aria-label={`Rename ${folder.name}`} onClick={() => setRenaming(folder.id)}><Pencil size={12} strokeWidth={2.25} aria-hidden /></button>
              <button className="sfold__mini" title="New folder inside" aria-label={`New folder inside ${folder.name}`} onClick={() => newFolder(folder.id)}><FolderPlus size={13} strokeWidth={2.25} aria-hidden /></button>
              <button className="sfold__mini" title="Move this folder" aria-label={`Move ${folder.name}`} onClick={() => setMoving({ kind: 'folder', id: folder.id, label: folder.name })}><FolderInput size={13} strokeWidth={2.25} aria-hidden /></button>
              <button
                className="sfold__mini sfold__mini--danger"
                title="Delete folder; what is in it moves up"
                aria-label={`Delete ${folder.name}`}
                onClick={() => { if (node.count === 0 && node.folders.length === 0) f().deleteFolder(folder.id); else setDeleting(folder.id) }}
              ><X size={14} strokeWidth={2.25} aria-hidden /></button>
            </>
          )}
        </div>
        {open && (node.folders.length > 0 || node.items.length > 0) && (
          <ul className="sfold__kids">
            {node.folders.map(folderRow)}
            {rows(node.items)}
          </ul>
        )}
      </li>
    )
  }

  const asked = deleting ? tree.folders[deleting] : undefined
  const askedUp = asked ? (pathOf(tree, asked.parent).pop() ?? 'the top') : ''

  return (
    <>
      <li className={`sfold__bar ${over === '' ? 'is-over' : ''}`} {...dropOn(null)} title={drag ? 'Drop here to take it out of its folder' : undefined}>
        <button className="sfold__btn" onClick={() => newFolder(null)}><FolderPlus size={12} strokeWidth={2.25} aria-hidden /> FOLDER</button>
        {selecting ? (
          <>
            <button className="sfold__btn" disabled={pickedNow.length === 0} onClick={() => setMoving({ kind: 'shards', refs: pickedNow, label: `${pickedNow.length} shard${pickedNow.length === 1 ? '' : 's'}` })}>MOVE ({pickedNow.length})</button>
            <button className="sfold__btn" onClick={stopSelecting}>DONE</button>
          </>
        ) : (
          items.length > 1 && <button className="sfold__btn" onClick={() => setSelecting(true)} title="Pick several to move together">SELECT</button>
        )}
      </li>
      {built.folders.map(folderRow)}
      {rows(built.items)}
      {moving && (
        <FolderChooser
          tree={tree}
          moving={moving}
          current={moving.kind === 'folder' ? tree.folders[moving.id]?.parent ?? null : moving.refs.length === 1 ? folderOf(tree, moving.refs[0]) : undefined}
          onPick={(to) => {
            moveTo(moving, to)
            if (moving.kind === 'shards') stopSelecting()
            setMoving(null)
          }}
          onClose={() => setMoving(null)}
        />
      )}
      {asked && (
        <ConfirmModal
          title={`Delete folder "${asked.name}"?`}
          body={<>No shard is deleted. What is in it moves up to {askedUp === 'the top' ? 'the top' : `"${askedUp}"`}.</>}
          confirmLabel="DELETE FOLDER"
          onConfirm={() => { f().deleteFolder(asked.id); setDeleting(null) }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}

/** The name in place, typed over; Enter or leaving keeps it, Escape keeps the old one. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }): JSX.Element {
  const [value, setValue] = useState(name)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (v: string | null): void => { if (done.current) return; done.current = true; onDone(v) }
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  // Escape puts the old name back, and closes nothing behind it.
  useEscape('modal', true, () => finish(null))
  return (
    <input
      ref={ref}
      className="sfold__rename"
      value={value}
      maxLength={64}
      spellCheck={false}
      aria-label="Folder name"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') finish(value) }}
      onBlur={() => finish(value)}
    />
  )
}

/**
 * MOVE TO FOLDER: every folder, indented, and the top; a folder being moved
 * leaves itself and everything under it out. A new folder can be made here
 * and the move goes into it.
 */
function FolderChooser({ tree, moving, current, onPick, onClose }: {
  tree: FolderTree
  moving: Moving
  /** Where it is now: null the top, undefined when several shards may be in several places. */
  current: string | null | undefined
  onPick: (folder: string | null) => void
  onClose: () => void
}): JSX.Element {
  useEscape('modal', true, onClose)
  const skip = moving.kind === 'folder' ? moving.id : undefined
  const list = flatFolders(tree, skip)
  const [name, setName] = useState('')
  const make = (): void => {
    const id = useShardFolders.getState().createFolder(name, null)
    if (id) onPick(id)
  }
  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Move to a folder" onPointerDown={onClose}>
      <div className="modal__card sfold__chooser" onPointerDown={(e) => e.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title">Move &quot;{moving.label}&quot;</h2>
          <button className="secret__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <ul className="sfold__choices">
          <li>
            <button className={`sfold__choice ${current === null ? 'is-on' : ''}`} disabled={current === null} onClick={() => onPick(null)}>TOP</button>
          </li>
          {list.map(({ folder, depth }) => {
            const here = current === folder.id
            const refused = moving.kind === 'folder' && isWithin(tree, folder.id, moving.id)
            return (
              <li key={folder.id}>
                <button className={`sfold__choice ${here ? 'is-on' : ''}`} style={{ paddingLeft: 10 + depth * 14 }} disabled={here || refused} onClick={() => onPick(folder.id)}>
                  <FolderIcon size={12} strokeWidth={2.25} aria-hidden /> {folder.name}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="sfold__new">
          <input className="avatars__input login__input" value={name} maxLength={64} spellCheck={false} placeholder="New folder" aria-label="New folder name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') make() }} />
          <button className="secret__act login__act" disabled={!name.trim()} onClick={make}>MAKE AND MOVE</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
