/**
 * PaletteModal.tsx - all 256 colours at once, and which set of them this
 * object uses.
 *
 * A colour in this format is an index, not three numbers (DECK-0003 §1.3), so
 * the thing to look at is the whole palette rather than a wheel of every colour
 * a screen can make. The wheel was honest when a colour could be anything and
 * became a lie the moment it could not: it offered colours that would move when
 * you published. This shows exactly what an object can hold.
 *
 * Switching palettes keeps every index and changes what the indices name, which
 * is what an indexed format has always meant by it and is why the switch asks
 * first. There is no way to make it not change the object, and a version that
 * quietly re-matched colours by eye would be a different feature wearing this
 * one's name.
 */

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus, Trash2, X } from 'lucide-react'
import { BUILT_IN, BUILT_IN_NAME, hexAt, type Palette } from 'sno-core/snoPalette'
import { rgbToHex } from 'sno-core/shards'
import { useWorkshop } from '../store/useWorkshop'
import { ConfirmModal } from '../hud/ConfirmModal'

/** How the built-in is laid out, so the sheet can be read rather than scanned. */
const BANDS = [
  { from: 0, to: 191, title: '24 HUES × 8 STEPS', note: 'hue h step s is index h · 8 + s' },
  { from: 192, to: 223, title: 'STEELS', note: 'black to white, faintly cyan' },
  { from: 224, to: 255, title: 'SIGNATURES', note: "the client's own colors, the gamut corners, deep grounds" },
]

export function PaletteModal({ onClose }: { onClose: () => void }): JSX.Element {
  const shard = useWorkshop((s) => s.current())
  const palettes = useWorkshop((s) => s.palettes)
  const color = useWorkshop((s) => s.color)
  const w = useWorkshop.getState

  const active: Palette = shard?.palette ?? BUILT_IN
  const activeName = shard?.palette ? (shard.paletteName ?? 'a palette of its own') : BUILT_IN_NAME
  const activeId = useMemo(
    () => palettes.find((p) => p.colors.length === active.length && p.colors.every((c, i) => c[0] === active[i][0] && c[1] === active[i][1] && c[2] === active[i][2]))?.id ?? null,
    [palettes, active],
  )
  const hex = rgbToHex(color)
  const current = active.findIndex((_, i) => hexAt(active, i) === hex)

  const [making, setMaking] = useState(false)
  const [newName, setNewName] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [switching, setSwitching] = useState<{ id: string | null; name: string } | null>(null)
  const [forgetting, setForgetting] = useState<{ id: string; name: string } | null>(null)

  const take = (index: number): void => {
    if (making) {
      setPicked((p) => (p.includes(index) ? p.filter((i) => i !== index) : p.length < 256 ? [...p, index] : p))
      return
    }
    w().colorSelected(hexToRgbLocal(hexAt(active, index)))
  }

  const create = (): void => {
    if (picked.length < 2) return
    const colors = picked.map((i) => active[i]) as Palette
    const id = w().savePalette(newName, colors)
    setMaking(false); setNewName(''); setPicked([])
    setSwitching({ id, name: newName.trim() || 'untitled' })
  }

  const sheet = making ? BUILT_IN : active

  // Through a portal, for the reason ConfirmModal gives: this is rendered from
  // inside .ws__corner, which is positioned and carries a z-index and is
  // therefore a stacking context. A z-index of 300 inside a context that sits
  // at 3 is still 3 against the rest of the page, so a full-screen modal left
  // in there paints under the chip row.
  return createPortal(
    <div className="modal palettes" role="dialog" aria-modal="true" aria-label="Palette">
      <div className="palettes__head">
        <div>
          <h2 className="palettes__title">PALETTE</h2>
          <p className="palettes__sub">
            {making
              ? `Tap colors to take them. ${picked.length} chosen, 2 or more makes a palette.`
              : `${activeName} · ${active.length} colors · a color on the wire is an index into this`}
          </p>
        </div>
        <button className="chip ws__icon" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2.25} /></button>
      </div>

      <div className="palettes__body">
        {(making ? BANDS : [{ from: 0, to: sheet.length - 1, title: activeName.toUpperCase(), note: `${sheet.length} colors` }]).map((band) => (
          <section key={band.title + band.from} className="palettes__band">
            <h3 className="palettes__band-title">{band.title} <span>{band.note}</span></h3>
            <div className="palettes__grid">
              {sheet.slice(band.from, Math.min(band.to, sheet.length - 1) + 1).map((_, n) => {
                const i = band.from + n
                const on = making ? picked.includes(i) : i === current
                return (
                  <button
                    key={i}
                    className={`palettes__sw ${on ? 'is-on' : ''}`}
                    style={{ background: hexAt(sheet, i) }}
                    title={`${i} · ${hexAt(sheet, i)}`}
                    aria-label={`Color ${i}, ${hexAt(sheet, i)}`}
                    aria-pressed={on}
                    onClick={() => take(i)}
                  >{making && on ? <Check size={11} strokeWidth={3} /> : null}</button>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="palettes__foot">
        {making ? (
          <>
            <input
              className="avatars__input login__input palettes__name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="a name for it"
              aria-label="Palette name"
              spellCheck={false}
            />
            <button className="workshop__btn workshop__btn--warn" disabled={picked.length < 2} onClick={create}>
              MAKE IT ({picked.length})
            </button>
            <button className="workshop__btn" onClick={() => { setMaking(false); setPicked([]); setNewName('') }}>CANCEL</button>
          </>
        ) : (
          <>
            <span className="palettes__label">USE</span>
            <button
              className={`workshop__mode ${activeId === null && !shard?.palette ? 'is-on' : ''}`}
              onClick={() => setSwitching({ id: null, name: BUILT_IN_NAME })}
            >BUILT-IN</button>
            {palettes.map((p) => (
              <span key={p.id} className="palettes__one">
                <button className={`workshop__mode ${activeId === p.id ? 'is-on' : ''}`} onClick={() => setSwitching({ id: p.id, name: p.name })}>
                  {p.name} <em>{p.colors.length}</em>
                </button>
                <button className="workshop__mini workshop__mini--danger" title={`Forget "${p.name}"`} aria-label={`Forget ${p.name}`} onClick={() => setForgetting({ id: p.id, name: p.name })}>
                  <Trash2 size={11} strokeWidth={2.25} />
                </button>
              </span>
            ))}
            <span className="workshop__gap" />
            <button className="workshop__btn" onClick={() => { setMaking(true); setPicked([]) }}>
              <Plus size={12} strokeWidth={2.25} /> NEW PALETTE
            </button>
          </>
        )}
      </div>

      {switching && (
        <ConfirmModal
          title={`Put this object on ${switching.id === null ? 'the built-in palette' : `"${switching.name}"`}?`}
          body={
            <>
              <p>
                A color here is an index, not three numbers. Switching keeps every index and changes
                what the indices name, so <b>this object will change color</b>. That is what switching a
                palette means, and there is no version of it that leaves the object alone.
              </p>
              <p>
                An index the new palette does not reach falls back to the built-in&apos;s color at that
                index, so nothing collapses onto one color and nothing is lost. Recolor by hand
                afterward, and undo puts it back.
              </p>
            </>
          }
          confirmLabel="SWITCH"
          onConfirm={() => { w().usePalette(switching.id); setSwitching(null) }}
          onCancel={() => setSwitching(null)}
        />
      )}

      {forgetting && (
        <ConfirmModal
          title={`Forget "${forgetting.name}"?`}
          body={<>It leaves this list. Objects already using it keep their colors, because an object carries its palette with it.</>}
          confirmLabel="FORGET"
          onConfirm={() => { w().forgetPalette(forgetting.id); setForgetting(null) }}
          onCancel={() => setForgetting(null)}
        />
      )}
    </div>,
    document.body,
  )
}

/** Local, to keep this file's imports to the two modules it really depends on. */
function hexToRgbLocal(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
}
