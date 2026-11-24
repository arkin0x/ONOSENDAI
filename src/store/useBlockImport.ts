/**
 * useBlockImport.ts - IMPORT A BUILD: a .schem, .litematic or structure .nbt
 * file made into a workshop shard (design 4.7; ruled D1, D3 to D6 on
 * 2026-11-24).
 *
 * The steps, each on one panel in the workshop (workshop/BlockImport.tsx):
 *
 * 1. Drop: a file picked or dropped, read on the device in a worker
 *    (lib/blocks/blockSession.ts). Nothing is uploaded.
 * 2. Preview: the build turning slowly, its size in blocks; a Litematica
 *    file's regions, each to include or leave out.
 * 3. Colours: the blocks found, "from your file", each with our swatch from
 *    the Colour Table (lib/blocks/colourTable.ts); tap one to change it;
 *    MERGE SIMILAR; decorations off unless switched on.
 * 4. Scale: 1, 2 or 4 gibsons a block, with the real size.
 * 5. Fit: how full the one object is, or how many pieces it is hidden in.
 * 6. Save: SAVE TO WORKSHOP puts the build in the IMPORTS folder (its pieces
 *    in a folder of their own), PUBLISH shown and off. With PUBLISH on, each
 *    piece and then the build go out as public objects, as bulk import
 *    publishes (store/usePublished send).
 * 7. Place: PLACE opens BUILD with the build on the cursor, as DEPLOY does.
 *
 * Every change of a choice builds again in the worker, a moment after the
 * last change, and an answer to an older build is dropped.
 */

import { create } from 'zustand'
import type { ShardModel } from 'sno-core/shards'
import { parentOf, type BlockUnit } from '../lib/blocks/blockBuild'
import { BlockSession, type BlockSummary, type BuildPlan } from '../lib/blocks/blockSession'
import type { ColourChoices } from '../lib/blocks/colourTable'
import { isBlockFile, isOldSchematic } from '../lib/blocks/readBlockFile'
import { you } from '../lib/carried'
import { folderApi, placeInFolders, type FolderApi } from '../lib/importFolders'
import { wholePayloadLimit } from '../lib/shardFullness'
import { notLoaded } from './useShardImport'
import { usePublished } from './usePublished'
import { useShards } from './useShards'
import { useWorkshop } from './useWorkshop'

/** The workshop folder every imported build goes into. */
export const IMPORTS_FOLDER = 'IMPORTS'
/** How long after the last change a build starts. */
export const REBUILD_MS = 250
/** Bytes kept back from one hidden object's payload: the hide adds nothing to a piece, but a margin costs nothing. */
export const BUDGET_MARGIN = 256

export type Step = 'drop' | 'reading' | 'ready' | 'saving' | 'saved'

export interface BlockImportState {
  open: boolean
  step: Step
  fileName: string
  /** Why the file could not be read, or why the last build or save failed. */
  error: string | null
  summary: BlockSummary | null
  /** Regions included, by index. */
  include: number[]
  choices: ColourChoices
  unit: BlockUnit
  plan: BuildPlan | null
  building: boolean
  /** PUBLISH: off unless the person turns it on (v2 content is sealed to a place by default). */
  publish: boolean
  /** What was saved: the shard to place, every shard made, and what PUBLISH said. */
  saved: { placeId: string; ids: string[]; published: string | null } | null
  /** Open the importer in the workshop, at its first step. */
  show: () => void
  close: () => void
  /** Read a picked or dropped file. */
  pick: (file: File) => Promise<void>
  toggleRegion: (index: number) => void
  setMerge: (on: boolean) => void
  setDecor: (on: boolean) => void
  /** The person's colour for one block of their file, by its name; null puts ours back. */
  setColour: (name: string, colour: number | null) => void
  setUnit: (unit: BlockUnit) => void
  setPublish: (on: boolean) => void
  save: () => Promise<void>
  /** PLACE: BUILD opens with the saved build on the cursor. */
  place: () => void
}

let session: BlockSession | null = null
/** Each build asked for: an answer to an older one is dropped. */
let asked = 0
let timer: ReturnType<typeof setTimeout> | null = null
/** A build is in the worker now; `again` when the choices changed meanwhile, so one more runs when it answers. */
let inFlight = false
let again = false

const fresh = (): Pick<BlockImportState, 'step' | 'fileName' | 'error' | 'summary' | 'include' | 'choices' | 'unit' | 'plan' | 'building' | 'publish' | 'saved'> => ({
  step: 'drop', fileName: '', error: null, summary: null, include: [], choices: { mergeSimilar: false, showDecor: false, overrides: {} },
  unit: 0, plan: null, building: false, publish: false, saved: null,
})

/** The folder API the store files into; a test passes its own. */
export const folders = { api: (): FolderApi | null => folderApi() }

/** Gap between public sends, as bulk import keeps under a relay's rate (store/useShardImport timing). */
export const PUBLISH_GAP_MS = 350

export const useBlockImport = create<BlockImportState>((set, get) => {
  // One build in the worker at a time: a change while one runs asks for one more with the latest choices when it
  // answers, so stale builds never queue up behind each other (each would eat into the next one's deadline).
  const rebuild = (now = false): void => {
    if (timer) clearTimeout(timer)
    // Building from the moment a change is made, so SAVE never takes the build from before it.
    set({ building: true })
    const run = async (): Promise<void> => {
      timer = null
      if (inFlight) { again = true; return }
      const s = get()
      if (!session || !s.summary || s.step === 'saving' || s.step === 'saved') { set({ building: false }); return }
      const mine = ++asked
      const from = session
      inFlight = true
      const res = await from.build({ include: s.include, choices: s.choices, unit: s.unit, budget: wholePayloadLimit() - BUDGET_MARGIN })
      inFlight = false
      if (from !== session) return
      if (again) { again = false; void run(); return }
      if (mine !== asked) return
      set(res.ok ? { plan: res.value, building: false, error: null } : { plan: null, building: false, error: res.error })
    }
    if (now) void run()
    else timer = setTimeout(() => void run(), REBUILD_MS)
  }

  return {
    open: false,
    ...fresh(),

    show: () => { session?.close(); session = null; asked++; again = false; set({ open: true, ...fresh() }) },

    close: () => {
      if (get().step === 'saving') return
      if (timer) clearTimeout(timer)
      session?.close(); session = null; asked++; again = false
      set({ open: false, ...fresh() })
    },

    pick: async (file) => {
      if (get().step === 'reading' || get().step === 'saving') return
      if (isOldSchematic(file.name)) { set({ error: 'That is an old .schematic file, which import does not read. Save it again as .schem from WorldEdit.' }); return }
      if (!isBlockFile(file.name)) { set({ error: 'Pick a .schem, .litematic or .nbt file.' }); return }
      session?.close()
      session = new BlockSession()
      asked++
      again = false
      set({ ...fresh(), step: 'reading', fileName: file.name })
      const res = await session.open(file)
      if (get().fileName !== file.name || get().step !== 'reading') return
      if (!res.ok) { session?.close(); session = null; set({ step: 'drop', error: res.error }); return }
      set({ step: 'ready', summary: res.value, include: res.value.regions.map((_, i) => i) })
      rebuild(true)
    },

    toggleRegion: (index) => {
      const inc = get().include
      set({ include: inc.includes(index) ? inc.filter((i) => i !== index) : [...inc, index].sort((a, b) => a - b) })
      rebuild()
    },
    setMerge: (on) => { set({ choices: { ...get().choices, mergeSimilar: on } }); rebuild() },
    setDecor: (on) => { set({ choices: { ...get().choices, showDecor: on } }); rebuild() },
    setColour: (name, colour) => {
      const overrides = { ...get().choices.overrides }
      if (colour === null) delete overrides[name]
      else overrides[name] = colour
      set({ choices: { ...get().choices, overrides } })
      rebuild()
    },
    setUnit: (unit) => { set({ unit }); rebuild() },
    setPublish: (publish) => set({ publish }),

    save: async () => {
      const s = get()
      if (!session || !s.plan || s.building || s.step !== 'ready') return
      const blocked = notLoaded()
      if (blocked) { set({ error: blocked }); return }
      const owner = you()
      if (!s.plan.single && !owner) { set({ error: 'Sign in first: a build in pieces is saved under your key.' }); return }
      set({ step: 'saving', error: null })
      const taken = await session.take()
      if (!taken.ok) { set({ step: 'ready', error: taken.error }); return }
      const ws = useWorkshop.getState()
      const name = s.plan.name
      const added: Array<{ id: string; saved: Promise<boolean> }> = []
      const shards: ShardModel[] = []
      const place = (model: ShardModel, label: string, id?: string): string | null => {
        const got = ws.addShard(model, label, id)
        if (!got) return null
        added.push(got)
        shards.push({ ...model, id: got.id, name: label.slice(0, 64) })
        return got.id
      }
      let placeId: string | null
      const pieceIds: string[] = []
      if (s.plan.single) {
        placeId = place(taken.value[0].shard, name)
      } else {
        for (const o of taken.value) { const id = place(o.shard, o.shard.name, o.shard.id); if (id) pieceIds.push(id) }
        placeId = pieceIds.length === taken.value.length ? place(parentOf({ name, unit: s.plan.unit, objects: taken.value }, owner!), name) : null
      }
      if (!placeId) {
        // Something already had a piece's id: the pieces just added go again, so nothing half made stays.
        await useWorkshop.getState().removeMany(added.map((a) => a.id))
        set({ step: 'ready', error: 'The build could not be added to your workshop. Try SAVE TO WORKSHOP again.' })
        return
      }
      // Filing is a nicety: a fault in it never costs the build.
      try {
        placeInFolders(folders.api(), [
          { shardId: placeId, folder: [IMPORTS_FOLDER] },
          ...pieceIds.map((id) => ({ shardId: id, folder: [IMPORTS_FOLDER, `${name} pieces`] })),
        ])
      } catch (err) { console.warn('[block import] could not file the build in IMPORTS', err) }
      const kept = await Promise.all(added.map((a) => a.saved))
      const ids = added.map((a) => a.id)
      if (kept.some((k) => !k)) {
        set({ step: 'saved', saved: { placeId, ids, published: null }, error: 'Your storage is full: the build is in the workshop for now, and will be gone on a reload.' })
        return
      }
      let published: string | null = null
      if (s.publish) {
        // Pieces first, then the build, so a reader that finds the build finds its pieces.
        let ok = 0
        for (const shard of [...shards.filter((m) => m.id !== placeId), ...shards.filter((m) => m.id === placeId)]) {
          const out = await usePublished.getState().send(shard)
          if (!out.ok) { published = out.message; break }
          ok++
          await new Promise((r) => setTimeout(r, PUBLISH_GAP_MS))
        }
        if (published === null) published = shards.length === 1 ? 'Published.' : `Published ${ok} objects.`
      }
      set({ step: 'saved', saved: { placeId, ids, published } })
    },

    place: () => {
      const saved = get().saved
      if (!saved) return
      const ws = useWorkshop.getState()
      if (!ws.shards.some((m) => m.id === saved.placeId)) { set({ error: 'That build is no longer in your workshop.' }); return }
      useShards.getState().startDeployShard(saved.placeId, 'workshop')
      ws.closeWorkshop()
      get().close()
    },
  }
})
