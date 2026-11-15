/**
 * deployHintPrefs.ts - the deploy bar's hint switches as this device's
 * player last set them (arkinox, 2026-11-15: "i think these 3 hint settings
 * (toggles) should stay what you set them after the initial defaults of all 3
 * being turned on").
 *
 * The three are PUBLISH HEIGHT HINT (the bag's `H` tag, spec §8.6), PUBLISH
 * SECTOR HINT (the sector hint, spec §7.7, §10) and PUBLISH CONTENTS (what is
 * inside, by kind and count; lib/hidden.ts bagContentsTags). All three start
 * ON for a player who never touched them. A fourth, PUBLISH THAT MONEY IS
 * INSIDE, starts OFF (arkinox, 2026-11-15: "money off by default"): money is
 * said only when the player turns it on, whatever PUBLISH CONTENTS says
 * (lib/hidden.ts bagContentsTags). A switch flipped by hand in the
 * deploy bar (useShards `setDeployBag`) is saved here and every later hide
 * starts from it: a new bag, your bag already in the region, an EDIT or a
 * MOVE alike, across hides, reloads and sessions. What the switches show is
 * what the bag goes out with.
 *
 * Kept per device, in localStorage, like the other choices about how this
 * client behaves (useLayers, walkGravity, usePanelLayout). The deploy bar's
 * other settings are not kept anywhere, and nothing about a bag's public face
 * is stored per identity, so there is no identity store for this to join.
 *
 * Only a hand flip is saved. What the client forces for its own reasons never
 * is: the sector hint going off above height 30 (a sector cannot contain the
 * region) and coming back lower down, a room's bag with no hints at all
 * (lib/doors.ts ROOM_BAG_SETTINGS), a shard into a chest taking the chest's
 * bag, and the bags a game or the tutorial writes itself (lib/games
 * worldDeploy, tutorial/stage.ts), which never read these.
 *
 * Nothing was kept before this, so there is no older saved value to migrate.
 */

import type { BagSettings } from '../lib/hidden'
import { SECTOR_HINT, hintFits, isSectorHint } from '../lib/hint'

export const HINT_PREFS_KEY = 'onosendai:deployHints'

export interface HintPrefs {
  /** PUBLISH HEIGHT HINT: the bag's `H` tag. */
  height: boolean
  /** PUBLISH SECTOR HINT. */
  sector: boolean
  /** PUBLISH CONTENTS: every kind inside but money. */
  contents: boolean
  /** PUBLISH THAT MONEY IS INSIDE: cashu, said only with this on. */
  money: boolean
}

/** Three ON, money OFF (arkinox, 2026-11-15: "money off by default"). */
export const DEFAULT_HINT_PREFS: HintPrefs = { height: true, sector: true, contents: true, money: false }

/** This visit's choice when storage would not take it (blocked, private mode, quota): read before storage. */
let visit: HintPrefs | null = null

/** The saved choice, or the defaults (three ON, money OFF) where there is none or it cannot be read. */
export function loadHintPrefs(): HintPrefs {
  if (visit) return visit
  let raw: string | null
  try {
    raw = localStorage.getItem(HINT_PREFS_KEY)
  } catch {
    return DEFAULT_HINT_PREFS
  }
  if (raw === null) return DEFAULT_HINT_PREFS
  try {
    const p = JSON.parse(raw) as Partial<Record<keyof HintPrefs, unknown>>
    const pick = (k: keyof HintPrefs): boolean => (typeof p?.[k] === 'boolean' ? p[k] as boolean : DEFAULT_HINT_PREFS[k])
    // A choice saved before the money switch was kept names no `money`: OFF.
    return { height: pick('height'), sector: pick('sector'), contents: pick('contents'), money: pick('money') }
  } catch {
    return DEFAULT_HINT_PREFS
  }
}

/** Save the switches a hand flip changed; the others keep what they were. */
export function saveHintPrefs(patch: Partial<HintPrefs>): void {
  if (Object.keys(patch).length === 0) return
  const next = { ...loadHintPrefs(), ...patch }
  try {
    localStorage.setItem(HINT_PREFS_KEY, JSON.stringify(next))
    visit = null
  } catch {
    visit = next // storage blocked: kept for this visit
  }
}

/** What a change to the bag settings says about the four switches, if anything. */
export function hintPrefsOf(patch: Partial<BagSettings>): Partial<HintPrefs> {
  return {
    ...('heightTag' in patch && patch.heightTag !== undefined ? { height: patch.heightTag } : {}),
    ...('hint' in patch && patch.hint !== undefined ? { sector: patch.hint !== null } : {}),
    ...('contents' in patch && patch.contents !== undefined ? { contents: patch.contents } : {}),
    ...('money' in patch && patch.money !== undefined ? { money: patch.money } : {}),
  }
}

/**
 * `settings` with the four switches as saved, for a bag at `height`. The
 * sector hint ON keeps a finer hint box another client wrote on the bag
 * (the switch's "on keeps it as it is"), and is the sector hint otherwise,
 * where a sector can contain the region; `held` says it is ON but too small
 * here, so it comes back on lower down (useShards `deployHintHeld`). OFF is
 * no hint, never held. The riddle stays the bag's. Money is the saved
 * switch, not the bag's: a bag that announced money before stops when you
 * hide into it again with the switch off.
 */
export function withHintPrefs(settings: BagSettings, height: number, prefs: HintPrefs = loadHintPrefs()): { bag: BagSettings; held: boolean } {
  const kept = settings.hint && !isSectorHint(settings.hint) && hintFits(settings.hint, height) ? settings.hint : null
  const hint = !prefs.sector ? null : kept ?? (hintFits(SECTOR_HINT, height) ? SECTOR_HINT : null)
  return { bag: { ...settings, heightTag: prefs.height, hint, contents: prefs.contents, money: prefs.money }, held: prefs.sector && hint === null }
}

/**
 * The settings a deploy's bag goes out with, from what resolveBagSettings
 * made of the bar and the bag's current copy: the four switches exactly as
 * the bar shows them, so a bag never goes out with a hint the bar showed off
 * or without one it showed on, even when this device did not know the bag
 * or another device rewrote it since. ON keeps whatever hint box the bag
 * already carries, which may be a finer box another client or device wrote
 * rather than the sector the bar describes: ON never widens or drops a
 * hint already out. The riddle stays as resolved. Money goes out only as
 * the bar shows it, so no copy of the bag, older or from another device,
 * says money the bar showed off.
 */
export function asShown(resolved: BagSettings, shown: BagSettings, height: number): BagSettings {
  const hint = shown.hint === null ? null : resolved.hint ?? (hintFits(shown.hint, height) ? shown.hint : null)
  return { ...resolved, heightTag: shown.heightTag, hint, contents: shown.contents, money: shown.money }
}
