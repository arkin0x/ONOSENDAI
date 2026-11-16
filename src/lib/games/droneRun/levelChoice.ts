/**
 * levelChoice.ts - which field DRONE RUN plays on this device: the BUILT-IN
 * FIELD (the bundled fixture world) or a level imported here (levelDb.ts),
 * by its id. Remembered per device in localStorage; never published or synced.
 * Read when a session's world is read (levelSource.ts), so a change applies
 * from the next ENTER.
 */

/** Where the choice is kept: absent or empty means the built-in field. */
export const LEVEL_CHOICE_KEY = 'onosendai:droneRun:field'

/** The imported level chosen, by id, or null for the built-in field. */
export function chosenLevel(): string | null {
  try {
    const v = localStorage.getItem(LEVEL_CHOICE_KEY)
    return v ? v : null
  } catch { return null }
}

/** Choose an imported level by id, or null for the built-in field. */
export function chooseLevel(id: string | null): void {
  try {
    if (id) localStorage.setItem(LEVEL_CHOICE_KEY, id)
    else localStorage.removeItem(LEVEL_CHOICE_KEY)
  } catch { /* private mode: the built-in field plays */ }
}
