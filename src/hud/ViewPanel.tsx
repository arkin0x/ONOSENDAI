/**
 * ViewPanel.tsx - SETTINGS: what the scene draws and how WALK moves, one
 * switch to a row, in five groups.
 *
 * Titled View until arkinox renamed it Settings (2026-11-02); its layout id
 * is still `view` (store/usePanelLayout.ts), so a saved menu order keeps it
 * where it was.
 *
 * The rows sit under five subheadings with a thin rule between them, in the
 * owner's order (arkinox, 2026-11-22: "let's group the settings in the
 * Settings panel with subheadings and HRs"; SETTINGS_GROUPS below):
 * Protocol visualization (chain trail, terrain dots, hX boxes, region keys,
 * spatial audio), Movement (gravity, hard mode gravity, fluid walk, optimize
 * chain), Interface (look sphere), Effects (headlamp, glow, hide avatar,
 * sound effects) and Sync (sync hidden list). Interface also holds the
 * screen's two ways, SHOW EVERYTHING and NEWCOMER VIEW
 * (hud/NewcomerSetting.tsx); in the newcomer view only Interface shows. Each row is a title and a gray line under it, in
 * the style the trail switch had; its switch keeps the id it always had, so a
 * link that opens Settings at a row (hud/settingsLink.ts) still finds it.
 *
 * The scene's switches were in three places (two chips under Movement proof,
 * a switch in Proof chain, a checkbox inside the Region keys list) and are
 * here only now (arkinox, 2026-10-09). The headlamp shades the shards as if
 * lit from your view (scene/headlamp.ts; arkinox, 2026-10-23).
 *
 * Every switch writes the same store flag its old control did, kept on this
 * device as before (store/useLayers.ts for the dots, boxes and headlamp, useCyberspace
 * showTrail and showSecrets for the trail and region keys). The view rows
 * change only what this device draws: nothing here changes a proof, a move,
 * the cursor or the chain.
 *
 * Optimize chain (store/walkLimits.ts; the Chain sync limit of 2026-11-18,
 * named "Pause fluid walk when your chain falls behind" on 2026-11-22 and
 * Optimize chain later that day) is the one row that changes what WALK does
 * far ahead of your chain: on, fluid WALK switches itself off 21 moves ahead
 * and back on at 15 (store/fluidSwitch.ts); off, it never does. While fluid is
 * paused, the Fluid WALK row keeps your choice and says it is paused. The
 * slowdown and the LOSING SYNC warning it also turned on are parked
 * (store/walkLimits.ts SYNC_SLOWDOWN_ON).
 *
 * One row reaches the relay: Sync hidden list, your list of hidden things
 * saved encrypted to you (store/hidesSync.ts; owner ruling, 2026-11-15).
 *
 * The first-arrival tutorial's switch was a row here until the owner moved it,
 * with RESTART TUTORIAL, into the menu's Tutorial panel (2026-11-13,
 * hud/TutorialPanel.tsx).
 */

import { Fragment, type ReactNode } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { useWalk } from '../store/useWalk'
import { useFluidWalk } from '../store/fluidSwitch'
import { useHidesSync } from '../store/hidesSync'
import { setSfxOn, useSfxOn } from '../store/sfxSwitch'
import { Field, Switch } from './ui/Switch'
import { Explanation } from './Explanation'
import { WALK_LIMITS_ROW } from './settingsLink'
import { NewcomerSetting } from './NewcomerSetting'
import { useNewcomerView } from '../newcomer/useNewcomer'

interface ViewRow {
  id: string
  title: ReactNode
  hint: string
  on: boolean
  set: (on: boolean) => void
}

/** The sync limit's title (arkinox, 2026-11-22: "optimize chain (pause fluid walk)"). */
export const WALK_LIMITS_TITLE = 'Optimize chain'

/** The sync limit's line: what it does and why ("explain that this reduces new chain events to help your chain catch up"). */
export const WALK_LIMITS_HINT = 'Pauses fluid walk when your chain falls behind. Walking without fluid makes fewer new chain events, so your chain catches up.'

/** The Fluid WALK row's line while it is paused for the chain. */
export const FLUID_PAUSED_HINT = 'Paused while your chain catches up.'

/** The Spatial Audio row, in the owner's words (arkinox, 2026-11-22): the title and its gray line, where he wrote a dash between them. */
export const SPATIAL_AUDIO_TITLE = 'Spatial Audio'
export const SPATIAL_AUDIO_HINT = 'See spatial audio sources and fade perimeters.'

/** The Sound effects row (owner, 2026-11-24): every sound through lib/sfx.ts obeys it. */
export const SFX_TITLE = 'Sound effects'
export const SFX_HINT = 'Short game sounds, like the boing when you bounce.'

/** Hard Mode Gravity's row, in the owner's words (arkinox, 2026-11-22): his dash parts the title from its line. */
export const HARD_GRAVITY_TITLE = 'Hard Mode Gravity'
export const HARD_GRAVITY_HINT = 'Gravity will not turn off if there is nothing to catch your fall.'

/**
 * The panel's groups, in order, each a subheading and its rows' switch ids in
 * order (arkinox, 2026-11-22; Hide avatar moved from Movement to Effects the
 * same day). Every row in the panel is in exactly one group; a row added to
 * the panel but to no group shows under Other at the end, never nowhere.
 */
export const SETTINGS_GROUPS: ReadonlyArray<{ id: string; title: string; rows: readonly string[] }> = [
  { id: 'protocol', title: 'Protocol visualization', rows: ['view-chain-trail', 'view-terrain-dots', 'view-hx-boxes', 'view-region-keys', 'view-spatial-audio'] },
  { id: 'movement', title: 'Movement', rows: ['view-walk-gravity', 'view-walk-gravity-hard', 'view-walk-fluid', WALK_LIMITS_ROW] },
  { id: 'interface', title: 'Interface', rows: ['view-walk-look'] },
  { id: 'effects', title: 'Effects', rows: ['view-headlamp', 'view-glow', 'view-block-shading', 'view-walk-avatar', 'view-sfx'] },
  { id: 'sync', title: 'Sync', rows: ['view-hides-sync'] },
]

export function ViewPanel(): JSX.Element {
  const dots = useLayers((s) => s.dots)
  const boxes = useLayers((s) => s.boxes)
  const walkAvatarHidden = useLayers((s) => s.walkAvatarHidden)
  const walkLookSphere = useLayers((s) => s.walkLookSphere)
  const headlamp = useLayers((s) => s.headlamp)
  const spatialAudio = useLayers((s) => s.spatialAudio)
  const glow = useLayers((s) => s.glow)
  const blockShading = useLayers((s) => s.blockShading)
  const walkLimits = useLayers((s) => s.walkLimits)
  const gravity = useWalk((s) => s.gravity)
  const hardGravity = useWalk((s) => s.hardGravity)
  const fluidWalk = useFluidWalk((s) => s.on)
  const fluidPaused = useFluidWalk((s) => s.on && s.paused)
  const showTrail = useCyberspace((s) => s.showTrail)
  const showSecrets = useCyberspace((s) => s.showSecrets)
  const hidesSync = useHidesSync((s) => s.enabled)
  const hidesStatus = useHidesSync((s) => s.status)
  const hidesNote = useHidesSync((s) => s.note)
  const sfxOn = useSfxOn()
  // The newcomer view shows Interface only: the screen's two ways and the look sphere (newcomer/reveal.ts).
  const plain = useNewcomerView()

  const rows: ViewRow[] = [
    // A dot's color is the terrain K of its cell, the height of the temporal
    // tree a hop there has to compute: navy for K 0 up through teal, green
    // and amber to hot pink at K 16 (ShaderPointField, palette TERRAIN_STOPS).
    // Hiding them also stops the terrain scan (Scene, useTerrainVolume).
    {
      id: 'view-terrain-dots',
      title: 'Terrain dots',
      hint: 'Terrain difficulty: warmer dots cost more work to hop to.',
      on: dots,
      set: (v) => useLayers.getState().setLayer('dots', v),
    },
    // The h of hX keeps its case under the label's capitals: h3, h4 and h5
    // name the heights of the nested cells.
    {
      id: 'view-hx-boxes',
      title: <><span className="view__hx">h</span>X boxes</>,
      hint: 'The math barriers where moving costs increase.',
      on: boxes,
      set: (v) => useLayers.getState().setLayer('boxes', v),
    },
    // On means hidden: the camera is inside your avatar in WALK, and some
    // shapes are more in the way than they are worth seeing.
    {
      id: 'view-walk-avatar',
      title: 'Hide avatar in WALK',
      hint: 'Walk without your own avatar around the camera.',
      on: walkAvatarHidden,
      set: (v) => useLayers.getState().setLayer('walkAvatarHidden', v),
    },
    // The ball in the bottom right that WALK looks around with
    // (hud/WalkLookSphere.tsx). On by default; a drag on the scene still looks.
    {
      id: 'view-walk-look',
      title: 'Look sphere in WALK',
      hint: 'A ball in the bottom right to drag and look around.',
      on: walkLookSphere,
      set: (v) => useLayers.getState().setLayer('walkLookSphere', v),
    },
    // GRAVITY in WALK (store/useWalk.ts), kept on this device; also Z and
    // the WALK pad's chip. Like the rest of Movement, it changes how a walk
    // moves (falls and jumps), never what a proof is.
    {
      id: 'view-walk-gravity',
      title: 'Gravity in WALK',
      hint: 'Fall, land and jump.',
      on: gravity,
      set: (v) => useWalk.getState().setGravity(v),
    },
    // Hard Mode Gravity (store/useWalk.ts gravityOffOverVoid; arkinox,
    // 2026-11-22), off by default: off, a move with nothing below to catch
    // you turns gravity off; on, you fall to the invisible floor, as before.
    {
      id: 'view-walk-gravity-hard',
      title: HARD_GRAVITY_TITLE,
      hint: HARD_GRAVITY_HINT,
      on: hardGravity,
      set: (v) => useWalk.getState().setHardGravity(v),
    },
    // Fluid WALK (store/walkFluid.ts, store/fluidSwitch.ts): the walk keys
    // speed you up instead of stepping, and moves still land on whole
    // gibsons. Off is the step WALK exactly as it was. ?fluidwalk=1 or 0
    // sets it for one visit. Paused for the chain (store/fluidSwitch.ts), it
    // shows your choice (on) and says it is paused; a tap is a switch by
    // hand to off, which ends the pause and cancels the return.
    {
      id: 'view-walk-fluid',
      title: 'Fluid WALK',
      hint: fluidPaused ? FLUID_PAUSED_HINT : 'Hold to glide. Moves still land on whole gibsons.',
      on: fluidWalk,
      set: (v) => useFluidWalk.getState().set(v),
    },
    // WALK's sync limit (store/walkLimits.ts): since 2026-11-22 only the
    // fluid pause, at 21 moves ahead of your chain, back on at 15. The
    // parked LOSING SYNC warning's line opens the menu here
    // (hud/settingsLink.ts).
    {
      id: WALK_LIMITS_ROW,
      title: WALK_LIMITS_TITLE,
      hint: WALK_LIMITS_HINT,
      on: walkLimits,
      set: (v) => useLayers.getState().setLayer('walkLimits', v),
    },
    {
      id: 'view-chain-trail',
      title: 'Chain trail',
      hint: 'The red line of your movement history.',
      on: showTrail,
      set: (v) => useCyberspace.getState().setShowTrail(v),
    },
    // Off by default (arkinox, 2026-11-12); a saved ON is kept (useCyberspace loadShowSecrets).
    {
      id: 'view-region-keys',
      title: 'Region keys',
      hint: 'Green cages on the regions you hold keys for.',
      on: showSecrets,
      set: (v) => useCyberspace.getState().setShowSecrets(v),
    },
    // On by default. Off draws every shard face exactly its own color, as
    // the world always had it (scene/headlamp.ts), and with Block shading
    // the lamp at your eye on TERRAIN's blocks is only a glimmer
    // (terrain/terrainMaterial.ts EYE_GLIMMER).
    {
      id: 'view-headlamp',
      title: 'Headlamp',
      hint: 'Light shards and nearby blocks from your view.',
      on: headlamp,
      set: (v) => useLayers.getState().setLayer('headlamp', v),
    },
    // Each hidden sound and the blue rings where it plays at full
    // volume (DECK-0007 `fade`; scene/AudioSpheres.tsx). Sound spheres until
    // arkinox renamed it, off by default (2026-11-22); drawing only, every
    // sound still plays. Both show while audio is placed in BUILD.
    {
      id: 'view-spatial-audio',
      title: SPATIAL_AUDIO_TITLE,
      hint: SPATIAL_AUDIO_HINT,
      on: spatialAudio,
      set: (v) => useLayers.getState().setLayer('spatialAudio', v),
    },
    // The halos round a POINTS object's points, LIGHT or FOG (DECK-0003
    // §1.16; scene/PointBillboards.tsx). On by default; off for a slow phone.
    // The workshop's bench draws them either way, so an author sees them.
    {
      id: 'view-glow',
      title: 'Glow',
      hint: 'Light and fog that objects cast.',
      on: glow,
      set: (v) => useLayers.getState().setLayer('glow', v),
    },
    // TERRAIN's blocks darkened by the light that reaches them: caves, creases
    // and corners darker, glowing blocks lighting what is round them
    // (lib/terrain/light.ts; owner, 2026-11-26). On by default; off draws them
    // fully lit as before and works out no light, for a slow phone.
    {
      id: 'view-block-shading',
      title: 'Block shading',
      hint: 'Darker caves and corners.',
      on: blockShading,
      set: (v) => useLayers.getState().setLayer('blockShading', v),
    },
    // The game's short sounds through lib/sfx.ts, the bounce's boing among
    // them (owner, 2026-11-24). On by default, kept per identity in
    // IndexedDB (store/sfxSwitch.ts). MUTE ALL silences them too.
    {
      id: 'view-sfx',
      title: SFX_TITLE,
      hint: SFX_HINT,
      on: sfxOn,
      set: (v) => setSfxOn(v),
    },
    // Your list of hidden things, saved to the relay encrypted to you, so every
    // device signed in as you lists it (store/hidesSync.ts; owner ruling,
    // 2026-11-15). On by default; off keeps the list on this device.
    {
      id: 'view-hides-sync',
      title: 'Sync hidden list',
      hint: hidesSync && (hidesStatus === 'unsupported' || hidesStatus === 'error') && hidesNote ? hidesNote : 'Your hidden things on every device signed in as you.',
      on: hidesSync,
      set: (v) => useHidesSync.getState().setEnabled(v),
    },
  ]

  const byId = new Map(rows.map((r) => [r.id, r]))
  const grouped = new Set(SETTINGS_GROUPS.flatMap((g) => g.rows))
  const ungrouped = rows.filter((r) => !grouped.has(r.id)).map((r) => r.id)
  const all = ungrouped.length ? [...SETTINGS_GROUPS, { id: 'other', title: 'Other', rows: ungrouped }] : SETTINGS_GROUPS
  const groups = plain ? all.filter((g) => g.id === 'interface') : all

  return (
    <section className="panel panel--view">
      <header className="panel__head">
        <h2>Settings</h2>
      </header>
      {groups.map((g, i) => (
        <Fragment key={g.id}>
          {i > 0 && <hr className="view__rule" />}
          <div className="view__group" role="group" aria-labelledby={`view-group-${g.id}`}>
            <h3 className="view__subhead" id={`view-group-${g.id}`}>{g.title}</h3>
            {g.id === 'interface' && <NewcomerSetting />}
            {g.rows.map((id) => byId.get(id)).filter((r): r is ViewRow => r !== undefined).map((r) => (
              <Field key={r.id} id={r.id} label={r.title} hint={r.hint}>
                <Switch id={r.id} checked={r.on} onCheckedChange={r.set} />
              </Field>
            ))}
          </div>
        </Fragment>
      ))}
      <Explanation>
        Each switch turns one thing on or off, and the choice is kept on this
        device. Protocol visualization draws what the protocol is doing around
        you. It changes only what this device draws: nothing there moves you
        or your cursor, or changes a proof or your chain. Chain trail draws
        your movement history as a red line. Terrain dots color each cell by
        its terrain K, how much work a hop there has to compute, from navy for
        the least through teal, green and amber to hot pink for the most;
        turning them off also stops the terrain scan. hX boxes are the nested
        power-of-two boundaries around you, named by their heights (h3, h4, h5
        and up); a move that crosses a higher one costs more work. Region keys
        draws a green cage around each region you hold the key for. Spatial
        Audio shows each hidden sound you have found or placed, its box and
        the blue rings around it: inside the rings it plays at full volume,
        and it fades to silence at its region's walls. It is off unless you
        turn it on, and shows while you place a sound in BUILD; a sound whose
        card you open, or that you VIEW, shows until you close it or look
        away. Either way every sound still plays.
        Movement changes how WALK moves, never what a proof is. Gravity in
        WALK makes you fall, land and jump. Hard Mode Gravity keeps gravity on
        even when there is nothing below to catch your fall. Fluid WALK lets
        you hold to glide; moves still land on whole gibsons.
        Optimize chain turns Fluid WALK off for you when you get 21 moves
        ahead of your chain, and back on once you are 15 or fewer ahead, if
        you had it on. You keep walking the whole time: without fluid, WALK
        takes straighter paths, so it makes fewer moves and your chain catches
        up. Turning Fluid WALK off yourself while it is paused keeps it off.
        Turned off, Fluid WALK never pauses, and the CHAIN chip still shows
        how far ahead you are. If your chain falls far behind and something
        interrupts it, like closing the tab or losing connection, moves that
        have not reached your chain can be lost.
        In Interface, Screen picks how much the screen shows: everything, or
        the newcomer view, which shows only what the tour has reached, with
        plain names on the buttons. Look sphere in WALK puts a ball in the bottom right while
        you walk: drag it to look around, as a drag on the scene does.
        In Effects, Headlamp lights shards from your view, as a flashlight would:
        a face turned away from you, or far off, is darker, so shapes of one
        color show their depth; off, every face is exactly its own color.
        Glow draws the light or fog some objects cast around their points;
        turn it off if a slow phone struggles. The workshop still shows glow
        on the object you are making. Hide avatar in WALK takes your own
        avatar out of the way while you walk in first person, where the
        camera sits inside it. Sound effects plays the game's short sounds,
        like the boing when you bounce on a shard; turn it off for quiet. It
        is kept for each identity you sign in as. MUTE ALL in NOW PLAYING
        silences these sounds too.
        In Sync, Sync hidden list is the one switch here that reaches the relay.
        Your list of hidden things is saved to the relay, encrypted so only
        you can read it. Any device signed in as you shows the same list and
        can open what is in it. Nothing is saved while you are LOCAL. If your
        signer cannot encrypt for you (it has no NIP-44), the list stays on
        this device. Turn it off to keep the list on this device only.
      </Explanation>
    </section>
  )
}
