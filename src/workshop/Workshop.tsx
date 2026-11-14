/**
 * Workshop.tsx - the shard workshop's shell: the bench full-screen, and the
 * controls in five fixed places on it that never move (workshop redesign,
 * phase 1; arkinox, 2026-11-14: "the new workbench looks amazing. ship it").
 *
 *   1. The top bar (shell/TopBar): the way out, the top-level areas MENU,
 *      SHARD, GRID, AVATAR and MOTION, then DEPLOY. One row, never wrapped,
 *      never hidden.
 *   2. The rail (shell/Rail), left under the top bar: UNDO, REDO, and the
 *      grid LEVEL up, its value, and down. Never hidden.
 *   3. The view ball (shell/ViewBall), top right: drag it to orbit, tap it
 *      for views, the grid plane and the snap.
 *   4. The strip (shell/Strip), over the dock: the tool's options.
 *   5. The dock (shell/Dock), along the bottom: the tools in a fixed order,
 *      then the color in hand.
 *
 * Each area opens its own sheet (shell/Sheet), and so do the palette and
 * STAMP's object picker: one at a time, rising from the bottom over the strip
 * but never over the dock, the rail or the top bar. The bench frames the
 * shard into what is left (Bench Framer), so a sheet never hides it.
 *
 * What you hold is acted on from the strip (HeldRows), and, until phases 2
 * and 3 replace them, from the move pad at the bottom left and the color
 * column at the bottom right (ColorActs), standing on the strip.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ticksOf, unitsLabel } from 'sno-core/shards'
import { importFitFor } from 'sno-core/meshToShard'
import { BUILT_IN } from 'sno-core/snoPalette'
import { useEscape } from '../hooks/useEscape'
import { useScrollMemory } from '../hooks/useScrollMemory'
import { minedIn } from '../lib/avatarMine'
import { importFiles } from '../lib/meshImport'
import { IMPORT_PICKER_ACCEPT } from '../lib/shardZip'
import { useAvatars } from '../store/useAvatars'
import { useShardFolders } from '../store/useShardFolders'
import { routeImport, useShardImport } from '../store/useShardImport'
import { useWorkshop } from '../store/useWorkshop'
import { Bench } from './Bench'
import { useBenchView } from './benchAxes'
import { ColorActs } from './ColorActs'
import { HeldPad } from './HeldRows'
import { Intro, StorageWarning, Toast } from './Notices'
import { ObjectPicker } from './ObjectPicker'
import { PaletteModal } from './PaletteModal'
import { ZipImport } from './ZipImport'
import { Dock } from './shell/Dock'
import { Rail } from './shell/Rail'
import { Sheet } from './shell/Sheet'
import { Strip } from './shell/Strip'
import { TopBar } from './shell/TopBar'
import { ViewBall } from './shell/ViewBall'
import { AREA_LABEL, type Area, type SheetKind } from './sheets/areas'
import { AvatarBody } from './sheets/AvatarSheet'
import { GridBody } from './sheets/GridSheet'
import { MenuBody } from './sheets/MenuSheet'
import { MotionBody } from './sheets/MotionSheet'
import { ShardBody } from './sheets/ShardSheet'

const isArea = (s: SheetKind | null): s is Area => s !== null && s !== 'palette' && s !== 'object'

/** The bodies of the area sheets, by area. */
const BODY: Record<Exclude<Area, 'menu'>, () => JSX.Element | null> = { shard: ShardBody, grid: GridBody, avatar: AvatarBody, motion: MotionBody }

/** The accessible names of the area sheets, as the old panels had them. */
const REGION: Record<Area, string> = { menu: 'Menu', shard: 'Shard', grid: 'Grid', avatar: 'Avatar', motion: 'Motion' }

/**
 * Measures what the fixed places and an open sheet cover of the bench, from
 * the top and from the bottom, and hands it to the bench to frame the shard
 * in what is left (benchAxes BenchInsets). Measured again whenever any of
 * them changes size, the window does, or a sheet comes or goes.
 */
function useBenchInsets(root: React.RefObject<HTMLDivElement>, sheet: SheetKind | null, open: boolean): void {
  useLayoutEffect(() => {
    const el = root.current
    if (!open || !el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const box = el.getBoundingClientRect()
      const top = el.querySelector('.ws__topbar')?.getBoundingClientRect().bottom ?? box.top
      const strip = el.querySelector('.ws__strip')?.getBoundingClientRect().top ?? box.bottom
      const edge = el.querySelector('.ws__sheet')?.getBoundingClientRect().top ?? strip
      const insets = { top: Math.max(0, Math.round(top - box.top)), bottom: Math.max(0, Math.round(box.bottom - edge)), rest: Math.max(0, Math.round(box.bottom - strip)) }
      const now = useBenchView.getState().insets
      if (now.top !== insets.top || now.bottom !== insets.bottom || now.rest !== insets.rest) useBenchView.setState({ insets })
    }
    const ro = new ResizeObserver(measure)
    for (const sel of ['.ws__topbar', '.ws__bottom', '.ws__sheet']) { const n = el.querySelector(sel); if (n) ro.observe(n) }
    window.addEventListener('resize', measure)
    measure()
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [root, sheet, open])
  // Shut, the bench frames nothing: the next opening starts from the middle.
  useEffect(() => { if (!open) useBenchView.setState({ insets: { top: 0, bottom: 0, rest: 0 } }) }, [open])
}

export function Workshop(): JSX.Element | null {
  const open = useWorkshop((s) => s.open)
  const shard = useWorkshop((s) => s.current())
  const one = useWorkshop((s) => { const c = s.current(); return s.selection.length === 1 && c ? c.vertices[s.selection[0]] ?? null : null })
  const phase = useAvatars((s) => s.phase)
  const minedMs = useAvatars((s) => s.minedMs)
  // The one sheet that is open, if any: an area, the palette, or the object picker.
  const [sheet, setSheet] = useState<SheetKind | null>(null)
  const area = isArea(sheet) ? sheet : null
  // A panel asked for as it opened (useWorkshop openWorkshop `panel`: the
  // tutorial's MENU, feedback 2026-11-12 item 10), shown once, then let go.
  const openPanel = useWorkshop((s) => s.openPanel)
  useEffect(() => {
    if (!open || !openPanel) return
    setSheet(openPanel)
    useWorkshop.setState({ openPanel: null })
  }, [open, openPanel])
  // Closed, nothing stays open for the next time but what the tutorial asks for.
  useEffect(() => { if (!open) setSheet(null) }, [open])
  // The moment the work is done: say so, because the signer's prompt may take a
  // while to appear and nothing else marks the end of the mining.
  const lastPhase = useRef<typeof phase>(null)
  useEffect(() => {
    if (lastPhase.current === 'mining' && phase === 'signing') useWorkshop.setState({ notice: `Mined in ${minedIn(minedMs ?? 0)}. Sign the avatar event when your signer asks.` })
    lastPhase.current = phase
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])
  // The view ball's menu, shut by a tap anywhere else, and by a sheet rising.
  const [viewOpen, setViewOpen] = useState(false)
  // Asks the palette to fold away, by counting up (PaletteModal foldAsk).
  const [foldAsk, setFoldAsk] = useState(0)
  // MENU's paste box, kept here so it survives MENU closing and opening, as it did as a panel.
  const [paste, setPaste] = useState<{ open: boolean; text: string }>({ open: false, text: '' })
  useEffect(() => { if (sheet) setViewOpen(false) }, [sheet])
  useEffect(() => {
    if (!viewOpen) return
    const shut = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.closest('.ws__view')) return
      setViewOpen(false)
    }
    document.addEventListener('pointerdown', shut, true)
    return () => document.removeEventListener('pointerdown', shut, true)
  }, [viewOpen])
  // IMPORT: the file input it opens, whether a file is being read, and
  // whether files are being dragged over the workshop.
  const fileInput = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [dropping, setDropping] = useState(false)
  // MENU comes back where it was scrolled to: after a shard is opened, the
  // workshop closed for a deploy or a look and opened again, or another sheet
  // was open in between (arkinox, 2026-11-09: "the list of shards is very
  // long"). Ready once the folders are read, since folding changes its height.
  const foldersRead = useShardFolders((s) => s.storage !== 'loading')
  const menuScroll = useScrollMemory('workshop-menu', foldersRead)
  const closeSheet = useCallback(() => setSheet(null), [])
  const root = useRef<HTMLDivElement>(null)
  useBenchInsets(root, sheet, open)
  // Every hook above this line, none below it: the early return that follows
  // changes which hooks run, and React counts them. One sat after the
  // return for a day and opening the workshop threw React #310 (2026-09-24).
  //
  // The workshop is a modal over the scene, with arkinox's order inside it
  // (2026-10-01): its own modals (the palette, the object picker, every
  // confirmation) open later and so close first; then the open sheet; then
  // the view ball's menu; then what is in hand; and only then the workshop
  // itself. Esc used to live in the bench's key handler, which closed the
  // workshop from under an open palette sheet.
  useEscape('modal', open, () => {
    const ws = useWorkshop.getState()
    if (sheet !== null) setSheet(null)
    else if (viewOpen) setViewOpen(false)
    else if (ws.selection.length || ws.partSel.length || ws.selectedFaces.length > 0 || ws.facePick.length) { ws.selectVertex(null); ws.clearFacePick() }
    else ws.closeWorkshop()
  })

  if (!open) return null
  const w = useWorkshop.getState
  const say = (notice: string): void => useWorkshop.setState({ notice })
  const toggle = (s: SheetKind): void => setSheet((cur) => (cur === s ? null : s))
  // The view menu and a sheet are never up together: Esc closes one at a time, in sight.
  const toggleView = (): void => { if (!viewOpen) setSheet(null); setViewOpen(!viewOpen) }
  // The color in hand, tapped again with the palette up: the palette folds back into it, as its X does.
  const tapColor = (): void => { if (sheet === 'palette') setFoldAsk((n) => n + 1); else setSheet('palette') }

  /**
   * IMPORT: a 3D file picked or dropped, read off the main thread
   * (lib/meshImport), fitted to half this shard's grid (sno-core importFitFor)
   * with its lowest point on the working plane, and put down selected, one UNDO from gone. In an
   * empty shard it becomes the shard. The line it leaves says what happened,
   * simplified or not. A zip, or a .json SNO object (with whatever was picked
   * beside it), goes to bulk import instead (store/useShardImport routeImport).
   */
  const importFromFiles = async (list: FileList | File[] | null): Promise<void> => {
    const files = list ? Array.from(list) : []
    // While the import's list is open, a drop on it (React carries a portal's events here) changes nothing.
    if (!files.length || importing || useShardImport.getState().open) return
    // READING from the moment the files are sniffed, so a second pick or drop meanwhile is not a second import.
    setImporting(true)
    try {
      const route = await routeImport(files)
      // A zip, or an SNO object, is bulk import: every shard file a new shard of yours (workshop/ZipImport).
      if (route.to === 'none') { say(route.error); return }
      if (route.to === 'zip') { void useShardImport.getState().openZip(route.file); return }
      if (route.to === 'shards') { void useShardImport.getState().openFiles(route.files); return }
      const s = w().current()
      if (!s) return
      say(`Reading ${files.find((f) => !/\.(mtl|bin)$/i.test(f.name))?.name ?? files[0].name}…`)
      const res = await importFiles(files, { fit: importFitFor(s.extent), unit: s.unit, palette: s.palette ?? BUILT_IN, color: w().color })
      if (!res.ok) { say(res.error); return }
      w().insertImport(res.shard, `${res.report.summary}.`)
    } finally {
      setImporting(false)
    }
  }
  const draggingFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')
  const Body = area && area !== 'menu' ? BODY[area] : null

  return (
    <div
      className="workshop"
      role="dialog"
      aria-label="Object workshop"
      ref={root}
      onDragOver={(e) => { if (!draggingFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dropping) setDropping(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false) }}
      onDrop={(e) => { if (!draggingFiles(e)) return; e.preventDefault(); setDropping(false); void importFromFiles(e.dataTransfer.files) }}
    >
      <div className="workshop__bench">
        <Bench />
      </div>
      {/* IMPORT's picker, kept mounted so a sheet closing cannot drop its answer. */}
      <input ref={fileInput} type="file" accept={IMPORT_PICKER_ACCEPT} multiple hidden aria-hidden tabIndex={-1} onChange={(e) => { const list = e.currentTarget.files; void importFromFiles(list ? Array.from(list) : null); e.currentTarget.value = '' }} />
      {dropping && <div className="workshop__drop" aria-hidden>DROP TO IMPORT</div>}
      <Intro />
      <Toast />
      <StorageWarning />
      <ZipImport />

      <TopBar open={area} onArea={toggle} />
      <Rail />
      <ViewBall open={viewOpen} onToggle={toggleView} onClose={() => setViewOpen(false)} />
      {/* Where the one selected point is, under the view ball. A readout, so
          taps go through to the bench. */}
      {one && (
        <span className="ws__at" role="status" aria-label="Selected point">
          at ({ticksOf(one).map(unitsLabel).join(', ')})
        </span>
      )}

      {/* The move pad and the color column, standing on the strip; away
          while a sheet is up, which covers where they stand. */}
      {sheet === null && <HeldPad />}
      {sheet === null && <ColorActs />}

      <div className="ws__bottom">
        {area === 'menu' && shard && (
          <Sheet name={REGION.menu} title={AREA_LABEL.menu} sub={shard.name} onClose={closeSheet} bodyRef={menuScroll}>
            <MenuBody currentId={shard.id} onOpen={closeSheet} onImport={() => fileInput.current?.click()} importing={importing} paste={paste} setPaste={setPaste} />
          </Sheet>
        )}
        {area && Body && shard && (
          <Sheet name={REGION[area]} title={AREA_LABEL[area]} sub={shard.name} onClose={closeSheet}>
            <Body />
          </Sheet>
        )}
        {sheet === 'palette' && <PaletteModal onClose={closeSheet} foldAsk={foldAsk} />}
        {sheet === 'object' && <ObjectPicker onClose={closeSheet} />}
        <Strip onPickObject={() => setSheet('object')} />
        <Dock onColor={tapColor} colorOpen={sheet === 'palette'} />
      </div>
    </div>
  )
}
