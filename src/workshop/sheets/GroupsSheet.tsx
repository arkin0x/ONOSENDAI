/**
 * GroupsSheet.tsx - GROUPS (owner, 2026-11-23: "add a new feature to the
 * select tool: groups"): the open shard's named groups of points, faces and
 * placed objects, in a sheet opened from the rail's GROUPS key or G.
 *
 * On a phone held upright the sheet stands on the strip rather than covering
 * it (styles.css .ws__sheet--onstrip), so what is held stays in sight in the
 * held bar under it: holding a group is half of what this sheet is for, and
 * the next move is usually TURN, COPY or the handles.
 *
 * At the top, always in the same place: NEW GROUP (from what is held, Ctrl+G)
 * and SHOW ALL. Then a search, from eight groups up, and the groups, newest
 * first, so a paste or an import lands in view. A row is one tap to hold the
 * group or let it go (its mark says all, some or none held, in the held bar's
 * orange), an eye to hide it on the bench (only on the bench: what is
 * published has every group), and a chevron that opens its rarer actions in
 * place, one row at a time: ADD TO GROUP, REMOVE FROM GROUP, RENAME,
 * DUPLICATE, UNGROUP and DELETE CONTENTS, which asks first and says what goes.
 *
 * Everything acts through the store (useWorkshop createGroup and its
 * siblings; lib/shardGroups.ts), so UNDO takes back every change to a group.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, CopyPlus, Eye, EyeOff, PencilLine, Plus, SquareMinus, SquarePlus, Trash2, Ungroup } from 'lucide-react'
import type { ShardModel } from 'sno-core/shards'
import { ConfirmModal } from '../../hud/ConfirmModal'
import { SearchField } from '../../hud/ui/SearchField'
import { useEscape } from '../../hooks/useEscape'
import { noCallout } from '../../hooks/useRepeatable'
import { matches, searchKey } from '../../lib/shardSearch'
import { GROUP_NAME_MAX, groupCountsCached, groupLoss, groupsOf, heldSets, rowState, type ShardGroup } from '../../lib/shardGroups'
import { groupKey, hiddenIn, useWorkshop } from '../../store/useWorkshop'

/** From how many groups the search shows, as MENU shows its own over a long list. */
export const GROUPS_SEARCH_FROM = 8

/** How long a new row glows, in ms (styles.css ws-groups-arrive). */
const ARRIVE_MS = 900

/** Whether there is a keyboard to type a name with straight away: a phone would push its keyboard up under the thumb. */
export function typingDevice(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** A group's counts as its row shows them: only the kinds it has, "412 points · 380 faces · 2 objects". */
export function countsLine(c: { points: number; faces: number; objects: number }): string {
  return [c.points ? plural(c.points, 'point') : '', c.faces ? plural(c.faces, 'face') : '', c.objects ? plural(c.objects, 'object') : ''].filter(Boolean).join(' · ')
}

/** The header's count: NO GROUPS, 1 GROUP, 14 GROUPS · 2 HIDDEN. */
export function groupsSubLine(total: number, hidden: number): string {
  if (total === 0) return 'NO GROUPS'
  return `${total} GROUP${total === 1 ? '' : 'S'}${hidden > 0 ? ` · ${hidden} HIDDEN` : ''}`
}

/** "412 points, 380 faces and 2 objects": the kinds that are there, "and" before the last. */
function inWords(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** What DELETE CONTENTS' confirmation says, from the store's account of what goes (lib/shardGroups groupLoss). Pure, so a test can read it. */
export function deleteContentsCopy(name: string, loss: { points: number; faces: number; objects: number; facesBesides: number; others: string[] }): { title: string; lines: string[] } {
  const own = loss.faces - loss.facesBesides
  const what = inWords([loss.points ? plural(loss.points, 'point') : '', own ? plural(own, 'face') : '', loss.objects ? plural(loss.objects, 'object') : ''].filter(Boolean))
  const lines = [what ? `Its ${what} go, and the group with them.` : 'The group goes.']
  if (loss.others.length > 0) lines.push('Some of it is in other groups too: it goes from them as well.')
  if (loss.facesBesides > 0) lines.push(`${plural(loss.facesBesides, 'face')} built on these points go too.`)
  lines.push('UNDO puts it back.')
  return { title: `Delete what is in "${name}"?`, lines }
}

/** The sheet header's count, read here so the workshop does not draw on every group change. */
export function GroupsSub(): JSX.Element {
  const total = useWorkshop((s) => groupsOf(s.current()).length)
  const hidden = useWorkshop((s) => hiddenIn(s.hiddenGroups, s.current()).length)
  return <span title="Hidden only on the bench. What you publish has every group.">{groupsSubLine(total, hidden)}</span>
}

/** The name in place, typed over; Enter or leaving keeps it, Escape keeps the old one. (Follow-up: one shared field with hud/ShardFolders' RenameField.) */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }): JSX.Element {
  const [value, setValue] = useState(name)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (v: string | null): void => { if (done.current) return; done.current = true; onDone(v) }
  useEffect(() => { ref.current?.focus(); ref.current?.select?.() }, [])
  // Escape puts the old name back, and closes nothing behind it.
  useEscape('modal', true, () => finish(null))
  return (
    <span className="ws__groups-rename ws-cut">
      <input
        ref={ref}
        className="ws__groups-rename-input"
        value={value}
        maxLength={GROUP_NAME_MAX}
        spellCheck={false}
        aria-label="Group name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') finish(value) }}
        onBlur={() => finish(value)}
      />
    </span>
  )
}

/** One of the row's actions or the top pair: icon and words, half the width, the workshop's 44px floor. */
function Act({ icon: Icon, label, title, onClick, disabled, danger, keyHint, aria }: { icon: typeof Plus; label: string; title: string; onClick: () => void; disabled?: boolean; danger?: boolean; keyHint?: string; aria?: string }): JSX.Element {
  return (
    <button className={`workshop__btn ws-cut ws__groups-btn${danger ? ' ws__groups-btn--danger' : ''}`} disabled={disabled} onClick={onClick} title={title} aria-label={aria} {...noCallout}>
      <Icon size={14} strokeWidth={2.25} aria-hidden /><span>{label}</span>
      {keyHint && <kbd className="ws__key" aria-hidden>{keyHint}</kbd>}
    </button>
  )
}

type Held = 'all' | 'some' | 'none'

interface RowProps {
  group: ShardGroup
  counts: string
  held: Held
  hidden: boolean
  open: boolean
  renaming: boolean
  fresh: boolean
  holding: boolean
  addable: boolean
  removable: boolean
  onOpen: (id: string | null) => void
  onRename: (id: string | null) => void
  onDelete: (id: string) => void
}

/** A group's row: hold or let go, hide, and its actions behind the chevron. Drawn again only when what it shows changes. */
const GroupRow = memo(function GroupRow({ group, counts, held, hidden, open, renaming, fresh, holding, addable, removable, onOpen, onRename, onDelete }: RowProps): JSX.Element {
  const w = useWorkshop.getState
  const li = useRef<HTMLLIElement>(null)
  // An opened row, or a new one, in full view: the list scrolls the least it can.
  useEffect(() => { if ((open || fresh) && typeof li.current?.scrollIntoView === 'function') li.current.scrollIntoView({ block: 'nearest' }) }, [open, fresh])
  const shown = hidden ? `HIDDEN · ${counts}` : counts
  const state = held === 'all' ? 'All held' : held === 'some' ? 'Some held' : 'Not held'
  return (
    <li ref={li} className={`ws__groups-row ws-cut is-${held}${hidden ? ' is-hidden' : ''}${open ? ' is-open' : ''}${fresh ? ' is-new' : ''}${renaming ? ' is-renaming' : ''}`}>
      <div className="ws__groups-head">
        {renaming
          ? (
            <span className="ws__groups-main ws__groups-main--rename">
              <span className="ws__groups-mark" data-held={held} aria-hidden>{held === 'all' && <Check size={12} strokeWidth={3} />}</span>
              <RenameField name={group.name} onDone={(n) => { if (n !== null) w().renameGroup(group.id, n); onRename(null) }} />
            </span>
          )
          : (
            <button
              className="ws__groups-main"
              aria-pressed={held === 'all' ? true : held === 'some' ? 'mixed' : false}
              aria-label={`${group.name}: ${shown}. ${state}. Tap to ${held === 'all' ? 'let it go' : 'hold it'}.`}
              title={held === 'all' ? 'Tap to let this group go' : 'Tap to hold this group'}
              onClick={() => w().toggleGroupSelection(group.id)}
              {...noCallout}
            >
              <span className="ws__groups-mark" data-held={held} aria-hidden>{held === 'all' && <Check size={12} strokeWidth={3} />}</span>
              <span className="ws__groups-text">
                <span className="ws__groups-name">{group.name}</span>
                <span className="ws__groups-counts">{shown}</span>
              </span>
            </button>
          )}
        <button
          className="ws__groups-icon"
          aria-pressed={hidden}
          aria-label={hidden ? `Show ${group.name}` : `Hide ${group.name}`}
          title={hidden ? 'Show on the bench' : 'Hide on the bench. What you publish keeps it.'}
          onClick={() => w().setGroupHidden(group.id, !hidden)}
          {...noCallout}
        >
          {hidden ? <EyeOff size={18} strokeWidth={2} aria-hidden /> : <Eye size={18} strokeWidth={2} aria-hidden />}
        </button>
        <button
          className="ws__groups-icon ws__groups-chev"
          aria-expanded={open}
          aria-label={`More for ${group.name}`}
          title="Rename, duplicate, add to it, delete"
          onClick={() => onOpen(open ? null : group.id)}
          {...noCallout}
        >
          <ChevronDown size={18} strokeWidth={2.25} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="ws__groups-acts" role="group" aria-label={`${group.name}: more`}>
          <Act icon={SquarePlus} label="ADD TO GROUP" disabled={!addable} title={!holding ? 'Hold something first' : !addable ? 'All you hold is in it already' : 'What you hold, added to this group'} onClick={() => w().addSelectionToGroup(group.id)} />
          <Act icon={SquareMinus} label="REMOVE FROM GROUP" disabled={!removable} title={removable ? 'What you hold, taken out of this group. Nothing is deleted.' : 'Nothing you hold is in it'} onClick={() => w().removeSelectionFromGroup(group.id)} />
          <Act icon={PencilLine} label="RENAME" title="Rename this group" onClick={() => onRename(group.id)} />
          <Act icon={CopyPlus} label="DUPLICATE" title="A copy put down on this one, held, ready to move" onClick={() => { onOpen(null); w().duplicateGroup(group.id) }} />
          <Act icon={Ungroup} label="UNGROUP" title="The group goes. What is in it stays." onClick={() => w().deleteGroup(group.id)} />
          <Act icon={Trash2} label="DELETE CONTENTS" danger title="Delete this group and what is in it" onClick={() => onDelete(group.id)} />
        </div>
      )}
    </li>
  )
})

interface BodyProps {
  /** A group just made outside the sheet (Ctrl+G, MORE's NEW GROUP): it glows, and is named at once when `rename` says so. */
  made?: { id: string; rename: boolean } | null
  /** `made` was taken in. */
  onMadeSeen?: () => void
}

/** GROUPS' body, inside its sheet. */
export function GroupsBody({ made = null, onMadeSeen }: BodyProps = {}): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const selection = useWorkshop((s) => s.selection)
  const partSel = useWorkshop((s) => s.partSel)
  const selectedFaces = useWorkshop((s) => s.selectedFaces)
  const hiddenKeys = useWorkshop((s) => s.hiddenGroups)
  const [open, setOpen] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // The group DELETE CONTENTS asked about, with the shard it is in: never a bare yes (as ShardSheet's RETRACT).
  const [deleteAsk, setDeleteAsk] = useState<{ shard: string; id: string } | null>(null)
  // Stable, so the memoized rows are drawn again only when their own group or state changes.
  const askDelete = useCallback((id: string): void => { const at = useWorkshop.getState().currentId; if (at) setDeleteAsk({ shard: at, id }) }, [])
  // Rows that arrived while the sheet was open (a paste, an import, NEW GROUP, DUPLICATE) glow for a moment.
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<string[]>([])
  const groups = groupsOf(shard)
  const ids = groups.map((g) => g.id).join(',')
  useEffect(() => {
    const now = new Set(groups.map((g) => g.id))
    const before = seen.current
    seen.current = now
    if (!before) return
    const arrived = [...now].filter((id) => !before.has(id))
    if (arrived.length) setFresh((f) => [...f, ...arrived])
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!made) return
    setFresh((f) => [...f, made.id])
    if (made.rename) setRenaming(made.id)
    onMadeSeen?.()
  }, [made, onMadeSeen])
  useEffect(() => {
    if (!fresh.length) return
    const t = setTimeout(() => setFresh([]), ARRIVE_MS)
    return () => clearTimeout(t)
  }, [fresh])
  // Another shard opened: nothing asked or open carries over. Not on the
  // first draw, where it would undo the rename `made` asked for.
  const shardId = useRef(shard?.id)
  useEffect(() => {
    if (shardId.current === shard?.id) return
    shardId.current = shard?.id
    setOpen(null); setRenaming(null); setDeleteAsk(null)
  }, [shard?.id])
  const held = useMemo(() => ({ selection, partSel, selectedFaces }), [selection, partSel, selectedFaces])
  const rows = useMemo(() => {
    if (!shard) return []
    const hidden = new Set(hiddenKeys)
    // What is in hand as sets, once for every row (a level has dozens of groups, a held kit piece thousands of points).
    const sets = heldSets(held)
    return groups.map((g) => ({
      group: g,
      counts: countsLine(groupCountsCached(shard, g)),
      hidden: hidden.has(groupKey(shard.id, g.id)),
      ...rowState(shard, g, sets),
    })).reverse()
  }, [shard, groups, held, hiddenKeys])
  if (!shard) return null
  const w = useWorkshop.getState
  const holding = selection.length > 0 || partSel.length > 0 || selectedFaces.length > 0
  const anyHidden = rows.some((r) => r.hidden)
  const key = searchKey(query)
  const listed = key ? rows.filter((r) => matches(r.group.name, key)) : rows
  const newGroup = (): void => {
    const id = w().createGroup()
    if (!id) return
    setFresh((f) => [...f, id])
    if (typingDevice()) setRenaming(id)
  }
  const showAll = (): void => { for (const r of rows) if (r.hidden) w().setGroupHidden(r.group.id, false) }
  const asked = deleteAsk && deleteAsk.shard === shard.id ? groups.find((g) => g.id === deleteAsk.id) ?? null : null
  return (
    <>
      <div className="ws__groups-pair">
        <Act icon={Plus} label="NEW GROUP" keyHint="^G" disabled={!holding} title={holding ? 'A new group from what you hold (Ctrl+G)' : 'Hold something first: tap points, faces or objects'} onClick={newGroup} />
        <Act icon={Eye} label="SHOW ALL" disabled={!anyHidden} title="Show every hidden group on the bench" onClick={showAll} />
      </div>
      {rows.length >= GROUPS_SEARCH_FROM && <SearchField className="workshop__search" value={query} onChange={setQuery} placeholder="Search groups" label="Search your groups" />}
      {rows.length === 0
        ? <p className="ws__groups-empty">No groups yet: a paste, an import or NEW GROUP makes one.</p>
        : (
          <ul className="ws__groups-list" aria-label="Groups">
            {listed.map((r) => (
              <GroupRow
                key={r.group.id}
                group={r.group}
                counts={r.counts}
                held={r.held}
                hidden={r.hidden}
                open={open === r.group.id}
                renaming={renaming === r.group.id}
                fresh={fresh.includes(r.group.id)}
                holding={holding}
                addable={r.addable}
                removable={r.removable}
                onOpen={setOpen}
                onRename={setRenaming}
                onDelete={askDelete}
              />
            ))}
            {listed.length === 0 && <li className="ws__groups-empty" role="status">No matches</li>}
          </ul>
        )}
      {asked && <DeleteContents shard={shard} group={asked} onDone={() => setDeleteAsk(null)} />}
    </>
  )
}

/** DELETE CONTENTS' question: what goes, in words, and the red yes. */
function DeleteContents({ shard, group, onDone }: { shard: ShardModel; group: ShardGroup; onDone: () => void }): JSX.Element {
  const copy = deleteContentsCopy(group.name, groupLoss(shard, group))
  return (
    <ConfirmModal
      title={copy.title}
      body={<>{copy.lines.map((l) => <span key={l} className="modal__line">{l}</span>)}</>}
      confirmLabel="DELETE CONTENTS"
      onConfirm={() => { useWorkshop.getState().deleteGroupAndGeometry(group.id); onDone() }}
      onCancel={onDone}
    />
  )
}
