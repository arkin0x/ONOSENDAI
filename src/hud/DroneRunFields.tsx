/**
 * DroneRunFields.tsx - under DRONE RUN's row in GAMES: which field to play
 * and IMPORT LEVEL (store/useDroneRunLevels.ts).
 *
 * - The field: BUILT-IN FIELD, or a level imported on this device by its
 *   name. Remembered on this device; it applies from the next ENTER.
 * - IMPORT LEVEL: half width, as CREATE's buttons, a lucide icon before the
 *   words. Opens a file picker for a .zip (a level package: level.json and
 *   payloads/, lib/games/droneRun/level/package.ts); a good one is kept on
 *   this device and chosen, a bad one is refused in words on the line below.
 * - REMOVE, only for an imported level, never in one tap: it opens a
 *   confirmation that says what goes and that the zip brings it back. The
 *   line it sits on is always there, so nothing moves when it shows.
 *
 * Locked while the chain is inside the game, so the field cannot change
 * under a run. Nothing here is published, synced or put in the hidden list.
 */

import { useEffect, useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { useDroneRunLevels } from '../store/useDroneRunLevels'
import { PACKAGE_MAX_BYTES } from '../lib/games/droneRun/level/package'
import { ConfirmModal } from './ConfirmModal'

/** The built-in field's label in the choice. */
export const BUILT_IN_LABEL = 'BUILT-IN FIELD'
/** The value the choice gives the built-in field. */
const BUILT_IN = ''

export function DroneRunFields({ locked }: { locked: boolean }): JSX.Element {
  const levels = useDroneRunLevels((s) => s.levels)
  const chosen = useDroneRunLevels((s) => s.chosen)
  const busy = useDroneRunLevels((s) => s.busy)
  const [note, setNote] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  useEffect(() => { void useDroneRunLevels.getState().load() }, [])

  const current = levels.find((l) => l.id === chosen) ?? null

  const picked = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (file.size > PACKAGE_MAX_BYTES) { setNote(`That zip is over ${Math.round(PACKAGE_MAX_BYTES / 1024 / 1024)} MB.`); return }
    setNote(null)
    let bytes: Uint8Array
    try { bytes = new Uint8Array(await file.arrayBuffer()) } catch { setNote('That file could not be read.'); return }
    const got = await useDroneRunLevels.getState().importZip(bytes)
    setNote('refused' in got ? got.refused : `Imported ${got.name}.`)
  }

  const remove = async (): Promise<void> => {
    if (!current) { setConfirming(false); return }
    const name = current.name
    const gone = await useDroneRunLevels.getState().remove(current.id)
    setConfirming(false)
    setNote(gone ? `Removed ${name}.` : 'Could not remove it from this device.')
  }

  return (
    <div className="games__field">
      <div className="shards__modes items-kinds games__field-row">
        <select
          className="avatars__input compose__select games__field-pick"
          aria-label="Field"
          title="Which field DRONE RUN plays on this device"
          value={current?.id ?? BUILT_IN}
          disabled={locked || busy !== null}
          onChange={(e) => { setNote(null); useDroneRunLevels.getState().choose(e.target.value || null) }}
        >
          <option value={BUILT_IN}>{BUILT_IN_LABEL}</option>
          {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button
          className="avatars__go shards__compose-open items-kinds__go"
          disabled={locked || busy !== null}
          title="Import a level zip to this device"
          onClick={(e) => { e.currentTarget.blur(); picker.current?.click() }}
        >
          <FileUp className="shards__build-icon" size={13} strokeWidth={2.5} aria-hidden /><span className="items-kinds__label">{busy === 'importing' ? 'IMPORTING' : 'IMPORT LEVEL'}</span>
        </button>
        <input
          ref={picker}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          hidden
          onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void picked(f) }}
        />
      </div>
      <div className="games__field-line">
        <span className="games__field-note" role="status">{note}</span>
        <button
          className="chest__act chest__act--danger games__field-remove"
          style={current ? undefined : { visibility: 'hidden' }}
          disabled={!current || locked || busy !== null}
          title="Remove this level from this device. Asks first"
          onClick={() => setConfirming(true)}
        >REMOVE</button>
      </div>
      {confirming && current && (
        <ConfirmModal
          title={`Remove “${current.name}”?`}
          body="It comes off this device. You can import it again from its zip."
          confirmLabel="REMOVE"
          cancelLabel="CANCEL"
          danger
          busy={busy === 'removing'}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
