/**
 * BlockImport.tsx: IMPORT A BUILD, the panel that turns a .schem,
 * .litematic or .nbt file into a workshop shard (store/useBlockImport,
 * design 4.7). Opened by IMPORT in the workshop when the file picked is a
 * block build, and by the button on onosendai.tech/import.
 *
 * One card, steps in order down it: drop, preview, colours, scale, fit,
 * save, place. A rail of numbered steps across the top lights each as it is
 * reached; everything below it keeps its place, so nothing jumps when a
 * build finishes or a colour changes (the status line and the fit block
 * reserve their height).
 *
 * The look: a HUD panel with the house chamfer, targeting corners on the
 * drop zone and the preview, and a numbered step rail, drawn by hand in
 * styles.css (no UI library). Drawn from the sci-fi HUD and wizard
 * collections on Dribbble: albemala's "Sci-Fi Futuristic UIs", kasrangh's
 * "Upload Wizard" and Tredadesigner's "Stepper".
 */

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BUILT_IN_HEX } from 'sno-core/snoPalette'
import { ModalClose } from '../hud/ui/ModalClose'
import { Field, Switch } from '../hud/ui/Switch'
import { Checkbox } from '../hud/ui/Checkbox'
import { useEscape } from '../hooks/useEscape'
import { blockName, shortName } from '../lib/blocks/blockGrid'
import { FORMAT_LABEL } from '../lib/blocks/blockGrid'
import { UNITS, type BlockUnit } from '../lib/blocks/blockBuild'
import { colourFor } from '../lib/blocks/colourTable'
import { BLOCK_ACCEPT } from '../lib/blocks/readBlockFile'
import { IMPORTS_FOLDER, useBlockImport } from '../store/useBlockImport'
import { BlockPreview } from './BlockPreview'
import { FullnessBar } from './FullnessBar'

const STEPS = ['DROP', 'PREVIEW', 'COLOURS', 'SCALE', 'FIT', 'SAVE'] as const

const n = (v: number): string => v.toLocaleString('en-US')
const dims = (s: readonly number[], k = 1): string => s.map((v) => n(v * k)).join(' × ')

export function BlockImport(): JSX.Element | null {
  const s = useBlockImport()
  const input = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  useEscape('modal', s.open, () => { if (picking) setPicking(null); else s.close() })

  // One row per block name, "from your file": every stair of oak is one row, whichever way it faces.
  const rows = useMemo(() => {
    const by = new Map<string, { name: string; count: number; colour: number; decor: boolean; hidden: boolean; see: boolean }>()
    for (const f of s.summary?.states ?? []) {
      const name = blockName(f.state)
      const row = by.get(name)
      if (row) row.count += f.count
      else by.set(name, { name, count: f.count, colour: colourFor(f.state, f.look, s.choices), decor: f.look.decor, hidden: f.look.hidden, see: f.look.layer !== 'solid' })
    }
    return [...by.values()].sort((a, b) => Number(a.hidden || a.decor) - Number(b.hidden || b.decor) || b.count - a.count)
  }, [s.summary, s.choices])

  if (!s.open) return null
  const plan = s.plan
  const reached = s.step === 'drop' || s.step === 'reading' ? 0 : s.step === 'saved' ? 6 : plan ? 5 : 1
  const gib = 1 << s.unit
  const pieces = plan && !plan.single ? plan.objects : []
  const counts = { solid: 0, glass: 0, ice: 0, water: 0 }
  for (const o of pieces) counts[o.layer]++
  const pieceWords = [counts.solid && `${counts.solid} solid`, counts.glass && `${counts.glass} glass`, counts.ice && `${counts.ice} ice`, counts.water && `${counts.water} water`].filter(Boolean).join(', ')

  let line: string
  if (s.error) line = s.error
  else if (s.step === 'drop') line = 'Read on this device. Nothing is uploaded.'
  else if (s.step === 'reading') line = `Reading ${s.fileName}…`
  else if (s.step === 'saving') line = 'Saving to your workshop…'
  else if (s.step === 'saved') line = s.saved?.published ?? `Saved in ${IMPORTS_FOLDER} in your workshop.`
  else if (s.building || !plan) line = 'Building…'
  else line = `${plan.name}: ${n(plan.blocks)} blocks, ${dims(plan.size)}`

  const pick = (list: FileList | null): void => { const f = list?.[0]; if (f) void s.pick(f) }
  const working = s.step === 'saving'

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Import a build" onPointerDown={() => { if (!working) s.close() }}>
      <div
        className="modal__card blockimport"
        onPointerDown={(e) => e.stopPropagation()}
        onDragOver={(e) => { if (!Array.from(e.dataTransfer.types).includes('Files')) return; e.preventDefault(); if (!dropping) setDropping(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false) }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDropping(false); if (s.step === 'drop' || s.step === 'ready') pick(e.dataTransfer.files) }}
      >
        <div className="modal__head">
          <h2 className="modal__title blockimport__title">IMPORT A BUILD</h2>
          <ModalClose onClose={() => s.close()} disabled={working} />
        </div>

        <ol className="blockimport__rail" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} className={i < reached ? 'is-done' : i === reached ? 'is-now' : ''}>
              <span className="blockimport__num">{String(i + 1).padStart(2, '0')}</span>
              <span className="blockimport__step">{label}</span>
            </li>
          ))}
        </ol>

        <div className={`blockimport__line ${s.error ? 'is-bad' : ''}`} aria-live="polite">{line}</div>

        <input ref={input} type="file" accept={BLOCK_ACCEPT} hidden aria-hidden tabIndex={-1} onChange={(e) => { pick(e.currentTarget.files); e.currentTarget.value = '' }} />

        <div className="blockimport__body">
          {(s.step === 'drop' || s.step === 'reading') && (
            <button type="button" className={`blockimport__drop ${dropping ? 'is-over' : ''}`} disabled={s.step === 'reading'} onClick={() => input.current?.click()}>
              <span className="blockimport__corner blockimport__corner--tl" aria-hidden />
              <span className="blockimport__corner blockimport__corner--br" aria-hidden />
              <span className="blockimport__dropbig">{s.step === 'reading' ? 'READING' : 'DROP A FILE HERE'}</span>
              <span className="blockimport__dropsmall">.schem, .litematic or .nbt: tap to pick one</span>
            </button>
          )}

          {s.summary && (s.step === 'ready' || s.step === 'saving' || s.step === 'saved') && (
            <div className="blockimport__grid">
              <section className="blockimport__left">
                <BlockPreview layers={plan?.preview ?? null} size={plan?.size ?? null} />
                <div className="blockimport__meta">{FORMAT_LABEL[s.summary.format]}: {s.fileName}</div>
                {s.summary.regions.length > 1 && (
                  <div className="blockimport__section">
                    <h3 className="blockimport__h">REGIONS</h3>
                    <ul className="blockimport__regions">
                      {s.summary.regions.map((r, i) => (
                        <li key={`${r.name}:${i}`}>
                          <Field id={`blockimport-region-${i}`} label={r.name} hint={`${n(r.blocks)} blocks, ${dims(r.size)}`}>
                            <Checkbox id={`blockimport-region-${i}`} checked={s.include.includes(i)} disabled={s.step !== 'ready'} onCheckedChange={() => s.toggleRegion(i)} />
                          </Field>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <section className="blockimport__right">
                <div className="blockimport__section">
                  <h3 className="blockimport__h">COLOURS</h3>
                  <div className="blockimport__switches">
                    <Field id="blockimport-merge" label="MERGE SIMILAR" hint="One colour for blocks of one kind: smaller, smoother">
                      <Switch id="blockimport-merge" checked={s.choices.mergeSimilar} disabled={s.step !== 'ready'} onCheckedChange={(v) => s.setMerge(v)} />
                    </Field>
                    <Field id="blockimport-decor" label="DECORATIONS" hint="Plants, torches and lanterns as small markers">
                      <Switch id="blockimport-decor" checked={s.choices.showDecor} disabled={s.step !== 'ready'} onCheckedChange={(v) => s.setDecor(v)} />
                    </Field>
                  </div>
                  <div className="blockimport__fromfile">FROM YOUR FILE: TAP A COLOUR TO CHANGE IT</div>
                  <ul className="blockimport__colours">
                    {rows.map((r) => {
                      const off = r.hidden || (r.decor && !s.choices.showDecor)
                      const own = s.choices.overrides[r.name] !== undefined
                      return (
                        <li key={r.name} className={off ? 'is-off' : ''}>
                          <button
                            type="button"
                            className={`blockimport__swatch ${r.see ? 'is-see' : ''}`}
                            style={{ background: BUILT_IN_HEX[r.colour] }}
                            aria-label={`Colour for ${shortName(r.name)}`}
                            aria-expanded={picking === r.name}
                            disabled={off || s.step !== 'ready'}
                            onClick={() => setPicking(picking === r.name ? null : r.name)}
                          />
                          <span className="blockimport__bname">{shortName(r.name).replace(/_/g, ' ')}</span>
                          <span className="blockimport__count">{r.hidden ? 'NOT DRAWN' : r.decor && !s.choices.showDecor ? 'SKIPPED' : own ? `YOURS · ${n(r.count)}` : n(r.count)}</span>
                          {picking === r.name && (
                            <div className="blockimport__palette" role="group" aria-label={`Pick a colour for ${shortName(r.name)}`}>
                              {BUILT_IN_HEX.map((hex, i) => (
                                <button key={i} type="button" className={i === r.colour ? 'is-on' : ''} style={{ background: hex }} aria-label={`Colour ${i}`} onClick={() => { s.setColour(r.name, i); setPicking(null) }} />
                              ))}
                              {own && <button type="button" className="blockimport__ours" onClick={() => { s.setColour(r.name, null); setPicking(null) }}>OUR COLOUR</button>}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>

                <div className="blockimport__section">
                  <h3 className="blockimport__h">SCALE</h3>
                  <div className="blockimport__units" role="group" aria-label="Gibsons a block">
                    {UNITS.map((u: BlockUnit) => (
                      <button key={u} type="button" className={`blockimport__unit ${s.unit === u ? 'is-on' : ''}`} aria-pressed={s.unit === u} disabled={s.step !== 'ready'} onClick={() => s.setUnit(u)}>
                        {1 << u} {u === 0 ? 'GIBSON' : 'GIBSONS'}
                      </button>
                    ))}
                  </div>
                  <div className="blockimport__meta">
                    {plan ? `Real size: ${dims(plan.size, gib)} gibsons. It hides at height ${plan.height} or more.` : ' '}
                  </div>
                </div>

                <div className="blockimport__section blockimport__fit">
                  <h3 className="blockimport__h">FIT</h3>
                  {plan && plan.single && <FullnessBar payload={plan.objects[0].bytes} words="One shard: fits one hidden object." note="" />}
                  {plan && !plan.single && (
                    <div className="blockimport__pieces">
                      <div className="blockimport__piecebar" aria-hidden>{pieces.map((o, i) => <span key={i} className={`is-${o.layer}`} />)}</div>
                      <p>This build is hidden in {pieces.length} pieces ({pieceWords}). Each piece is signed once.</p>
                      <p className="blockimport__dim">Glass, ice and water are pieces of their own, drawn see-through. Very old clients will not open a build in pieces.</p>
                    </div>
                  )}
                  {!plan && <div className="blockimport__meta">{' '}</div>}
                </div>

                <div className="blockimport__section">
                  <Field id="blockimport-publish" label="PUBLISH" hint={s.publish ? 'On: anyone can see it, anywhere' : 'Off: it stays yours until you hide it'}>
                    <Switch id="blockimport-publish" className="ui-switch--ok" checked={s.publish} disabled={s.step !== 'ready'} onCheckedChange={(v) => s.setPublish(v)} />
                  </Field>
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="modal__row">
          {s.step === 'saved'
            ? <>
                <button type="button" className="modal__cancel" onClick={() => s.close()}>DONE</button>
                <button type="button" className="modal__confirm" onClick={() => s.place()}>PLACE</button>
              </>
            : <>
                <button type="button" className="modal__cancel" disabled={working} onClick={() => (s.step === 'ready' ? input.current?.click() : s.close())}>{s.step === 'ready' ? 'ANOTHER FILE' : 'CANCEL'}</button>
                <button type="button" className="modal__confirm" disabled={s.step !== 'ready' || !plan || s.building} onClick={() => void s.save()}>{working ? 'SAVING' : 'SAVE TO WORKSHOP'}</button>
              </>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
