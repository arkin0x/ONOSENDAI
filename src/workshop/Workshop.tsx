/**
 * Workshop.tsx - the shard workshop's shell: the bench full-screen, and the
 * controls in five fixed places on it that never move (workshop redesign,
 * phase 1; arkinox, 2026-11-14: "the new workbench looks amazing. ship it").
 *
 *   1. The top bar (shell/TopBar): the way out, the top-level areas MENU,
 *      SHARD, MOTION, AVATAR and GRID, then DEPLOY. One row, never wrapped,
 *      never hidden.
 *   2. The rail (shell/Rail), left under the top bar: UNDO, REDO, and the
 *      grid LEVEL up, its value, and down. Never hidden.
 *   3. The view ball (shell/ViewBall), top right: drag it to orbit, tap it
 *      for views, the grid plane and the snap.
 *   4. The strip (shell/Strip), over the dock: the tool's options, or with
 *      anything held, the held bar's fixed slots (shell/HeldBar); MORE at
 *      its right end opens everything rarer (sheets/MoreSheet).
 *   5. The dock (shell/Dock), along the bottom: the tools in a fixed order,
 *      then the color in hand.
 *
 * Each area opens its own sheet (shell/Sheet), and so do the palette and
 * STAMP's object picker: one at a time, rising from the bottom over the strip
 * but never over the dock, the rail or the top bar. The bench frames the
 * shard into what is left (Bench Framer), so a sheet never hides it.
 *
 * What you hold moves by the handles on it (shell/MoveHandles; phase 2), and
 * nothing else floats over the bench. SET EYE (AVATAR's FIRST-PERSON EYE)
 * holds the avatar's eye the same way: the handles on the eye, its slots in
 * the strip (shell/EyeBar), WHAT YOU SEE under the view ball (EyePreview).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { importFitFor } from 'sno-core/meshToShard'
import { BUILT_IN } from 'sno-core/snoPalette'
import { useEscape } from '../hooks/useEscape'
import { useScrollMemory } from '../hooks/useScrollMemory'
import { importFiles } from '../lib/meshImport'
import { IMPORT_PICKER_ACCEPT } from '../lib/shardZip'
import { stackedSpots } from '../lib/weld'
import { useShardFolders } from '../store/useShardFolders'
import { routeImport, useShardImport } from '../store/useShardImport'
import { useWorkshop } from '../store/useWorkshop'
import { Bench } from './Bench'
import { EyePreview, eyeBenchInset } from './EyePreview'
import { useFacingPreview } from '../store/facingPreview'
import { useBenchView } from './benchAxes'
import { StorageWarning, Toast } from './Notices'
import { Guide } from './shell/Guide'
import { ToolHint } from './shell/ToolHint'
import { guideDone, startingTools, useBeginner } from './beginner'
import { useTutorial } from '../store/useTutorial'
import { ObjectPicker } from './ObjectPicker'
import { PaletteModal } from './PaletteModal'
import { ZipImport } from './ZipImport'
import { Dock } from './shell/Dock'
import { MoveHandles } from './shell/MoveHandles'
import { isLook } from './lookTool'
import { Rail } from './shell/Rail'
import { Sheet } from './shell/Sheet'
import { Strip } from './shell/Strip'
import { TopBar } from './shell/TopBar'
import { ViewBall } from './shell/ViewBall'
import { AREA_LABEL, type Area, type SheetKind } from './sheets/areas'
import { AvatarBody } from './sheets/AvatarSheet'
import { GridBody } from './sheets/GridSheet'
import { MenuBody } from './sheets/MenuSheet'
import { MoreBody } from './sheets/MoreSheet'
import { MotionBody } from './sheets/MotionSheet'
import { ShardBody } from './sheets/ShardSheet'

const isArea = (s: SheetKind | null): s is Area => s !== null && s !== 'palette' && s !== 'object' && s !== 'more'

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
function useBenchInsets(root: React.RefObject<HTMLDivElement>, sheet: SheetKind | null, open: boolean, guiding: boolean, eyeEdit = false): void {
  useLayoutEffect(() => {
    const el = root.current
    if (!open || !el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const box = el.getBoundingClientRect()
      const top = el.querySelector('.ws__topbar')?.getBoundingClientRect().bottom ?? box.top
      const strip = el.querySelector('.ws__strip')?.getBoundingClientRect().top ?? box.bottom
      // A sheet is a sheet over the bottom, or (landscape phone, desktop:
      // phase 5) a column at the right, which covers the side and not the
      // bottom: told apart by its shape and where it stands.
      const sheetEl = el.querySelector('.ws__sheet')
      const sheetBox = sheetEl?.getBoundingClientRect()
      // The column is the sheet the CSS fixes to the side (styles.css, phase 5).
      const side = !!sheetEl && getComputedStyle(sheetEl).position === 'fixed'
      const guide = el.querySelector('.ws__guide')?.getBoundingClientRect().top
      const edge = (!side && sheetBox ? sheetBox.top : guide) ?? strip
      // SET EYE: a right inset as wide as WHAT YOU SEE's small picture, for
      // the whole time the eye is in hand, folded or not and BIGGER or not,
      // so the bench frames the eye clear of it and never re-frames meanwhile.
      const viewRight = el.querySelector('.ws__view')?.getBoundingClientRect().right ?? box.right
      const eyeInset = eyeEdit ? eyeBenchInset(box.right - viewRight, box.width, box.height) : 0
      const right = Math.max(side && sheetBox ? Math.max(0, Math.round(box.right - sheetBox.left)) : 0, eyeInset)
      const insets = { top: Math.max(0, Math.round(top - box.top)), bottom: Math.max(0, Math.round(box.bottom - edge)), rest: Math.max(0, Math.round(box.bottom - strip)), right }
      const now = useBenchView.getState().insets
      if (now.top !== insets.top || now.bottom !== insets.bottom || now.rest !== insets.rest || now.right !== insets.right) useBenchView.setState({ insets })
    }
    const ro = new ResizeObserver(measure)
    for (const sel of ['.ws__topbar', '.ws__bottom', '.ws__sheet', '.ws__guide']) { const n = el.querySelector(sel); if (n) ro.observe(n) }
    window.addEventListener('resize', measure)
    measure()
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [root, sheet, open, guiding, eyeEdit])
  // Shut, the bench frames nothing: the next opening starts from the middle.
  useEffect(() => { if (!open) useBenchView.setState({ insets: { top: 0, bottom: 0, rest: 0, right: 0 } }) }, [open])
}

export function Workshop(): JSX.Element | null {
  const open = useWorkshop((s) => s.open)
  const shard = useWorkshop((s) => s.current())
  // WELD's count, shown on MORE while points stand on one another.
  const stacked = useMemo(() => (shard ? stackedSpots(shard).spots : 0), [shard])
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
  // Closed, nothing stays open for the next time but what the tutorial asks
  // for, and a guide put away with Esc may come back.
  useEffect(() => { if (!open) { setSheet(null); useBeginner.getState().resume() } }, [open])
  // The beginner path (phase 4, decision 4): the first opening decides the
  // dock, four tools for someone new, six for anyone who has made something;
  // and a first visit starts the guide, unless the tutorial has the workshop.
  const tutorialActive = useTutorial((s) => s.active)
  useEffect(() => {
    if (!open || tutorialActive) return
    const b = useBeginner.getState()
    if (b.tools === null) b.setTools(startingTools(guideDone(), useWorkshop.getState().shards))
    if (!guideDone() && b.step === null && !b.paused) {
      // "A new shard opens on an empty grid": the guide never starts on a
      // shard with something in it (one the tutorial copied in, say).
      const w = useWorkshop.getState()
      const c = w.current()
      if (c && (c.vertices.length > 0 || (c.parts?.length ?? 0) > 0)) w.create()
      b.setStep('stamp')
    }
  }, [open, tutorialActive])
  // The view ball's menu, shut by a tap anywhere else, and by a sheet rising.
  const [viewOpen, setViewOpen] = useState(false)
  // Asks the palette to fold away, by counting up (PaletteModal foldAsk).
  const [foldAsk, setFoldAsk] = useState(0)
  // MENU's paste box, kept here so it survives MENU closing and opening, as it did as a panel.
  const [paste, setPaste] = useState<{ open: boolean; text: string }>({ open: false, text: '' })
  useEffect(() => { if (sheet) setViewOpen(false) }, [sheet])
  // FACING on the bench while the AVATAR sheet is open (FacingPreview).
  useEffect(() => {
    useFacingPreview.setState({ on: open && area === 'avatar' })
    return () => useFacingPreview.setState({ on: false })
  }, [open, area])
  // SET EYE (avatar eye, UI A): the eye in hand closes the sheet it was taken
  // from; a sheet opened, or anything else picked up, puts the eye down.
  const eyeEdit = useWorkshop((s) => s.eyeEdit)
  const holding = useWorkshop((s) => s.selection.length > 0 || s.partSel.length > 0 || s.selectedFaces.length > 0)
  useEffect(() => { if (eyeEdit) setSheet(null) }, [eyeEdit])
  useEffect(() => { if (sheet !== null && useWorkshop.getState().eyeEdit) useWorkshop.getState().setEyeEdit(false) }, [sheet])
  useEffect(() => { if (holding && useWorkshop.getState().eyeEdit) useWorkshop.getState().setEyeEdit(false) }, [holding])
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
  // The guide's card stands over the strip too, and the shard is framed above it.
  const guiding = useBeginner((s) => s.step !== null && !s.paused) && !tutorialActive
  useBenchInsets(root, sheet, open, guiding, eyeEdit)
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
    // The first-visit guide, up: Esc puts it away for this opening only (it
    // comes back next time, unless SKIP was tapped), and the workshop stays.
    else if (useBeginner.getState().step !== null && !useBeginner.getState().paused && !tutorialActive) useBeginner.getState().pause()
    // SET EYE: Esc puts the eye down, as DONE does.
    else if (ws.eyeEdit) ws.setEyeEdit(false)
    // Not in LOOK, where what is held is out of sight and stays held (benchLook.tsx): Esc goes on to close.
    else if (!isLook(ws.tool) && (ws.selection.length || ws.partSel.length || ws.selectedFaces.length > 0 || ws.facePick.length)) { ws.selectVertex(null); ws.clearFacePick() }
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
      <Toast />
      <StorageWarning />
      <ZipImport />

      <TopBar open={area} onArea={toggle} />
      <Rail />
      <ViewBall open={viewOpen} onToggle={toggleView} onClose={() => setViewOpen(false)} />
      {/* SET EYE's WHAT YOU SEE, under the view ball and under the handles too, so a handle is never hidden behind it. */}
      {eyeEdit && !viewOpen && <EyePreview />}
      {/* The move handles, on what is held, in any tool. */}
      <MoveHandles />

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
        {sheet === 'more' && (
          <Sheet name="More" title="MORE" sub={shard?.name} onClose={closeSheet}>
            <MoreBody onClose={closeSheet} />
          </Sheet>
        )}
        {sheet === 'palette' && <PaletteModal onClose={closeSheet} foldAsk={foldAsk} />}
        {sheet === 'object' && <ObjectPicker onClose={closeSheet} />}
        {/* The first visit's guide and the tool's fading hint, over the strip; neither over a sheet. */}
        {sheet === null && !eyeEdit && <Guide />}
        <ToolHint hidden={sheet !== null || eyeEdit} />
        <Strip onPickObject={() => setSheet('object')} onMore={() => toggle('more')} moreBadge={stacked} />
        <Dock onColor={tapColor} colorOpen={sheet === 'palette'} />
      </div>
    </div>
  )
}
