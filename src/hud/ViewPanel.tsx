/**
 * ViewPanel.tsx - VIEW: what the scene draws, one switch to a row.
 *
 * Four things drawn in the scene can be turned off: the terrain dots, the hX
 * boxes, the chain trail and the region key cages. Another switch shades the
 * shards as if lit from your view, the headlamp (scene/headlamp.ts; arkinox,
 * 2026-10-23: "add the toggle to the View panel in the menu"). Their switches were in
 * three places (two chips under Movement proof, a switch in Proof chain, a
 * checkbox inside the Region keys list) and are here only now, just above
 * the Legend that says what each one means (arkinox, 2026-10-09). Each row
 * is a title and a gray line under it, in the style the trail switch had.
 *
 * Every switch writes the same store flag its old control did, kept on this
 * device as before (store/useLayers.ts for the dots, boxes and headlamp, useCyberspace
 * showTrail and showSecrets for the other two). It is a view preference
 * only: nothing here changes a proof, a move, the cursor or the chain.
 */

import type { ReactNode } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { useWalk } from '../store/useWalk'
import { Field, Switch } from './ui/Switch'
import { Explanation } from './Explanation'

interface ViewRow {
  id: string
  title: ReactNode
  hint: string
  on: boolean
  set: (on: boolean) => void
}

export function ViewPanel(): JSX.Element {
  const dots = useLayers((s) => s.dots)
  const boxes = useLayers((s) => s.boxes)
  const walkAvatarHidden = useLayers((s) => s.walkAvatarHidden)
  const walkLookSphere = useLayers((s) => s.walkLookSphere)
  const headlamp = useLayers((s) => s.headlamp)
  const gravity = useWalk((s) => s.gravity)
  const showTrail = useCyberspace((s) => s.showTrail)
  const showSecrets = useCyberspace((s) => s.showSecrets)

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
    // The ball above the menu button that WALK looks around with
    // (hud/WalkLookSphere.tsx). On by default; a drag on the scene still looks.
    {
      id: 'view-walk-look',
      title: 'Look sphere in WALK',
      hint: 'A ball above the menu button to drag and look around.',
      on: walkLookSphere,
      set: (v) => useLayers.getState().setLayer('walkLookSphere', v),
    },
    // GRAVITY in WALK (store/useWalk.ts), kept on this device; also Z and
    // the WALK pad's chip. Unlike the rows around it, it changes how a walk
    // moves (falls and jumps), never what a proof is.
    {
      id: 'view-walk-gravity',
      title: 'Gravity in WALK',
      hint: 'Fall, land and jump. Z.',
      on: gravity,
      set: (v) => useWalk.getState().setGravity(v),
    },
    {
      id: 'view-chain-trail',
      title: 'Chain trail',
      hint: 'The red line of your movement history.',
      on: showTrail,
      set: (v) => useCyberspace.getState().setShowTrail(v),
    },
    {
      id: 'view-region-keys',
      title: 'Region keys',
      hint: 'Green cages on the regions you hold keys for.',
      on: showSecrets,
      set: (v) => useCyberspace.getState().setShowSecrets(v),
    },
    // On by default. Off draws every shard face exactly its own color, as
    // the world always had it (scene/headlamp.ts).
    {
      id: 'view-headlamp',
      title: 'Headlamp',
      hint: 'Light shards from your view so their shape and depth show.',
      on: headlamp,
      set: (v) => useLayers.getState().setLayer('headlamp', v),
    },
  ]

  return (
    <section className="panel panel--view">
      <header className="panel__head">
        <h2>View</h2>
      </header>
      {rows.map((r) => (
        <Field key={r.id} id={r.id} label={r.title} hint={r.hint}>
          <Switch id={r.id} checked={r.on} onCheckedChange={r.set} />
        </Field>
      ))}
      <Explanation>
        Each switch turns one thing in the scene on or off. It changes only what
        this device draws, and the choice is kept on this device: nothing here
        moves you or your cursor, or changes a proof or your chain. Terrain dots
        color each cell by its terrain K, how much work a hop there has to
        compute, from navy for the least through teal, green and amber to hot
        pink for the most; turning them off also stops the terrain scan. hX boxes
        are the nested power-of-two boundaries around you, named by their heights
        (h3, h4, h5 and up); a move that crosses a higher one costs more work.
        Hide avatar in WALK takes your own avatar out of the way while you walk in
        first person, where the camera sits inside it. Look sphere in WALK puts a
        ball above the menu button while you walk: drag it to look around, as a
        drag on the scene does. Chain trail draws your
        movement history as a red line. Region keys draws a green cage around
        each region you hold the key for. Headlamp lights shards from your view,
        as a flashlight would: a face turned away from you, or far off, is
        darker, so shapes of one color show their depth; off, every face is
        exactly its own color.
      </Explanation>
    </section>
  )
}
