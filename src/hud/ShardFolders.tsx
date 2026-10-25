/**
 * ShardFolders.tsx - the folders every shard list is sorted into: the
 * workshop MENU's SHARDS, PLACE OBJECT's MINE, the chest composer's + SHARD
 * and STAMP's objects. One component over one store (store/useShardFolders.ts),
 * so the lists show the same folders and behave the same.
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
 * the folder moves up to its parent. The one exception is the workshop's own
 * list, which hands in `deleteContents`: there DELETE's confirmation has one
 * switch, off each time it opens, that deletes the folder's contents too,
 * every shard and folder under it at any depth, in one step (arkinox,
 * 2026-10-25: "i need an option to actually delete a folder and everything
 * in it"). The pickers never get it.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Folder as FolderIcon, FolderInput, FolderPlus, Pencil, X } from 'lucide-react'
import { buildTree, canonical, contentsOf, flatFolders, newestFirst, parentOf, folderOf, isWithin, pathOf, type FolderNode, type FolderTree } from '../lib/shardFolders'
import { useShardFolders } from '../store/useShardFolders'
import { useCyberspace } from '../store/useCyberspace'
import { useEscape } from '../hooks/useEscape'
import { ConfirmModal } from './ConfirmModal'
import { Field, Switch } from './ui/Switch'

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
  /**
   * Where the list's own shards can be deleted (the workshop's MENU, and
   * nowhere else): a folder's DELETE then offers to delete what is in it too.
   */
  deleteContents?: DeleteContents
}

/** How a list deletes its shards, for DELETE CONTENTS. Local only: nothing is retracted. */
export interface DeleteContents {
  /** Delete these shards (by ref) in one step; resolves true once that is saved, false when the write failed. */
  remove: (refs: string[]) => Promise<boolean>
  /** How many of these are published (the publish ledger), for the note that they stay on relays. */
  published: (refs: readonly string[]) => number
}

/** A workshop model's ref and name, for the lists of models (stable, so the tree is not rebuilt every render). */
export const modelRef = (s: { id: string }): string => s.id
export const modelName = (s: { name: string }): string => s.name
export const modelEditedAt = (s: { updatedAt?: number }): number => s.updatedAt ?? 0

/**
 * `useNewestFirst`'s stability key, pure so a test can pin it down: equal
 * for two calls whose items carry the same ref and edited time in the same
 * order and whose `used` map holds the same entries, however different the
 * `items` array or the `used` object's own reference.
 *
 * JSON-encoded rather than joined with a plain separator: a ref is free text
 * in general (a folder path, a found object's address), so a separator
 * character inside one ref can read as the boundary between two items.
 * `["a@1|b",2]` and `["a",1],["b",2]`, joined on `@`/`|`, both read back as
 * `a@1|b@2`; JSON.stringify keeps the two apart because only it, not the
 * ref text, ever contributes an unescaped `"`, `[` or `,`.
 */
export function newestFirstKey<T>(items: readonly T[], refOf: (item: T) => string, editedAt: (item: T) => number, used: Readonly<Record<string, number>> | undefined): string {
  const usedKey = used ? Object.keys(used).sort().map((k) => [k, used[k]]) : []
  return JSON.stringify([items.map((i) => [refOf(i), editedAt(i)]), usedKey])
}

/**
 * A shard list in the order every one of them is drawn: last edited or last
 * deployed first, whichever is later (lib/shardFolders.ts newestFirst), so
 * the lists cannot drift apart. `refOf` and `editedAt` should be stable.
 *
 * Steadied against a re-render that hands back a fresh-but-equal `items`
 * array or `used` map (newestFirstKey, above): keyed on content rather than
 * on `items` and `used`'s own identity, a render that changed neither
 * reuses the exact array `newestFirst` returned last time, so nothing kept
 * in a list keyed on this array's identity (ShardFolders' rows, a parent's
 * memo) re-renders either, however often the caller itself re-renders
 * (arkinox, 2026-10-23: opening the workshop bench on a Maze Kit Basilica
 * piece and tapping it once, with a 138-shard library, re-sorted the whole
 * library on every one of ~280 re-renders that single tap set off in
 * Workshop.tsx, for seconds of blocked main thread, though neither a shard
 * nor a folder had changed).
 */
export function useNewestFirst<T>(items: readonly T[], refOf: (item: T) => string, editedAt: (item: T) => number): T[] {
  const used = useShardFolders((s) => s.tree.used)
  const prev = useRef<{ key: string; result: T[] } | null>(null)
  const key = newestFirstKey(items, refOf, editedAt, used)
  if (!prev.current || prev.current.key !== key) prev.current = { key, result: newestFirst(items, refOf, editedAt, used) }
  return prev.current.result
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

export function ShardFolders<T>({ items, refOf, nameOf, row, deleteContents }: Props<T>): JSX.Element {
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
                title={deleteContents ? 'Delete folder' : 'Delete folder; what is in it moves up'}
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
  const askedNode = asked && deleteContents ? findNode(built.folders, asked.id) : undefined

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
      {asked && askedNode && deleteContents && (
        <DeleteFolder
          key={asked.id}
          node={askedNode}
          up={askedUp === 'the top' ? 'the top' : `"${askedUp}"`}
          refOf={refOf}
          deleteContents={deleteContents}
          onDone={() => setDeleting(null)}
        />
      )}
      {asked && !askedNode && (
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

/** A folder drawn in the list, by id. */
function findNode<T>(nodes: readonly FolderNode<T>[], id: string): FolderNode<T> | undefined {
  for (const n of nodes) {
    if (n.folder.id === id) return n
    const under = findNode(n.folders, id)
    if (under) return under
  }
  return undefined
}

const counted = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** What DELETE's confirmation says, switch off or on. Pure, so a test can read it. */
export function deleteFolderCopy(all: boolean, up: string, shards: number, folders: number, published: number): { label: string; notes: string[]; confirmLabel: string; danger: boolean } {
  if (!all) return { label: `Preserve contents and expand to ${up}.`, notes: [], confirmLabel: 'DELETE FOLDER', danger: false }
  const notes = ['This cannot be undone.']
  if (published > 0) notes.push(published === 1 ? '1 is published: it stays on relays; RETRACT it separately.' : `${published} are published: they stay on relays; RETRACT them separately.`)
  return { label: `Delete contents: ${counted(shards, 'shard')} and ${counted(folders, 'folder')}`, notes, confirmLabel: 'DELETE FOLDER AND CONTENTS', danger: true }
}

/**
 * DELETE's yes. Off: the folder goes and what is in it moves up. On: the
 * shards in it at any depth go in one step, and only once that is saved do
 * the folder and every folder under it go, in one folder op. Shards and
 * folders live in two stores; were the folders taken first and the shard
 * write then failed with the tab closed before a retry, the shards would come
 * back on reload with their folders gone, hundreds loose at the top (review
 * of PR 509). A failed write leaves the folders, empty in this tab, and the
 * storage warning says why. Nothing is retracted or published. Resolves
 * whether the folders went.
 */
export async function deleteFolderNow<T>(node: FolderNode<T>, all: boolean, refOf: (item: T) => string, deleteContents: DeleteContents): Promise<boolean> {
  if (!all) { useShardFolders.getState().deleteFolder(node.folder.id); return true }
  let saved = false
  try { saved = await deleteContents.remove(contentsOf(node).items.map(refOf)) } catch { saved = false }
  if (saved) useShardFolders.getState().purgeFolder(node.folder.id)
  return saved
}

/**
 * DELETE on a folder of the workshop's own list: one confirmation with one
 * switch, off whenever it opens (it is remounted for each ask). Off, the
 * folder goes and what is in it moves up, as everywhere. On, the folder and
 * everything in it at any depth go (deleteFolderNow), and the button turns
 * red. The switch is never the focus, so it takes a deliberate tap. Wording
 * as arkinox gave it, 2026-10-25, his dash a colon.
 */
export function DeleteFolder<T>({ node, up, refOf, deleteContents, onDone }: {
  node: FolderNode<T>
  /** Where the contents move up to: a quoted folder name, or the top. */
  up: string
  refOf: (item: T) => string
  deleteContents: DeleteContents
  onDone: () => void
}): JSX.Element {
  const [all, setAll] = useState(false)
  const { items, folders } = useMemo(() => contentsOf(node), [node])
  const published = useMemo(() => (all ? deleteContents.published(items.map(refOf)) : 0), [all, items, refOf, deleteContents])
  const copy = deleteFolderCopy(all, up, items.length, folders, published)
  const id = `sfold-delete-contents-${node.folder.id}`
  return (
    <ConfirmModal
      title={`Delete folder "${node.folder.name}"?`}
      cardClassName="sfold__confirm"
      body={
        <Field id={id} label={copy.label} hint={copy.notes.length ? <>{copy.notes.map((n) => <span key={n} className="modal__line">{n}</span>)}</> : undefined}>
          <Switch id={id} checked={all} onCheckedChange={setAll} aria-label="Delete contents" />
        </Field>
      }
      confirmLabel={copy.confirmLabel}
      danger={copy.danger}
      onConfirm={() => { void deleteFolderNow(node, all, refOf, deleteContents); onDone() }}
      onCancel={onDone}
    />
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
