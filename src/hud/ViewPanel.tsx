/**
 * ViewPanel.tsx - VIEW: what the scene draws, one switch to a row.
 *
 * Four things drawn in the scene can be turned off: the terrain dots, the hX
 * boxes, the chain trail and the region key cages. Their switches were in
 * three places (two chips under Movement proof, a switch in Proof chain, a
 * checkbox inside the Region keys list) and are here only now, just above
 * the Legend that says what each one means (arkinox, 2026-10-09). Each row
 * is a title and a gray line under it, in the style the trail switch had.
 *
 * Every switch writes the same store flag its old control did, kept on this
 * device as before (store/useLayers.ts for the dots and boxes, useCyberspace
 * showTrail and showSecrets for the other two). It is a view preference
 * only: nothing here changes a proof, a move, the cursor or the chain.
 */

import type { ReactNode } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { Field, Switch } from './ui/Switch'

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
    </section>
  )
}
