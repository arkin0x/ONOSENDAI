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

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Download, Plus, Trash2, Upload, X } from 'lucide-react'
import { BUILT_IN, BUILT_IN_NAME, explainPasteProblem, hexAt, parsePaletteText, type Palette } from 'sno-core/snoPalette'
import { rgbToHex } from 'sno-core/shards'
import { paletteNevent, usePaletteNet } from '../store/usePaletteNet'
import { useWorkshop, type NamedPalette } from '../store/useWorkshop'
import { ConfirmModal } from '../hud/ConfirmModal'
import { useEscape } from '../hooks/useEscape'

/** How the built-in is laid out, so the sheet can be read rather than scanned. */
const BANDS = [
  { from: 0, to: 191, title: '24 HUES × 8 STEPS', note: 'hue h step s is index h · 8 + s' },
  { from: 192, to: 223, title: 'STEELS', note: 'black to white, faintly cyan' },
  { from: 224, to: 255, title: 'SIGNATURES', note: "the client's own colors, the gamut corners, deep grounds" },
]

/**
 * How long the overlay takes to fold away.
 *
 * Short enough that picking several colors in a row does not feel like waiting
 * on an animation, long enough that the direction it goes is legible. The
 * color is applied before the fold starts, so this delays nothing but the
 * unmount.
 */
const FOLD_MS = 190

type Bytes = [number, number, number]
const bytes = (hex: string): Bytes => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Bytes

/** WCAG relative luminance, each channel taken to linear light first. */
function luminance(c: Bytes): number {
  const [r, g, b] = c.map((v) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The two inks a swatch's number can be written in, and how faded (styles.css, .palettes__sw and .palettes__n). */
const DARK_INK = bytes('#05070d')
const LIGHT_INK = bytes('#eef6ff')
const INK_ALPHA = 0.85

/** Contrast of faded ink over a swatch: the ink is blended over it as the browser paints it, then measured. */
function contrast(ink: Bytes, bg: Bytes): number {
  const seen = luminance(ink.map((v, i) => v * INK_ALPHA + bg[i] * (1 - INK_ALPHA)) as Bytes)
  const under = luminance(bg)
  return (Math.max(seen, under) + 0.05) / (Math.min(seen, under) + 0.05)
}

/**
 * Whether a swatch's number is written in light ink rather than dark.
 *
 * The number is how a color is named in a DNA (`'(171)`), so it has to read on
 * every swatch, from the deep grounds to the near whites. Whichever ink, faded
 * as it is drawn, stands out more against the swatch wins. A threshold on the
 * raw hex got the saturated mid tones wrong (171, the cyans, pure red and
 * magenta: review of PR 671).
 */
export function lightInk(hex: string): boolean {
  const bg = bytes(hex)
  return contrast(LIGHT_INK, bg) > contrast(DARK_INK, bg)
}

/** The contrast ratio a swatch's number is drawn at, for tests to hold a floor under. */
export function inkContrast(hex: string): number {
  const bg = bytes(hex)
  return Math.max(contrast(LIGHT_INK, bg), contrast(DARK_INK, bg))
}

export function PaletteModal({ onClose }: { onClose: () => void }): JSX.Element {
  const shard = useWorkshop((s) => s.current())
  const palettes = useWorkshop((s) => s.palettes)
  const color = useWorkshop((s) => s.color)
  const w = useWorkshop.getState
  const n = usePaletteNet.getState
  const busy = usePaletteNet((s) => s.publishing)
  /** Colors this author has reached for, newest first (useWorkshop.palette). */
  const recent = useWorkshop((s) => s.palette)

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
  const [ref, setRef] = useState('')
  const [pasteName, setPasteName] = useState('')
  // Said here rather than through the store's toast, which this modal covers.
  const [note, setNote] = useState<string | null>(null)
  const [shared, setShared] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [folding, setFolding] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const foldTimer = useRef<number | null>(null)

  // A fold in flight when this unmounts would call onClose into nothing.
  useEffect(() => () => { if (foldTimer.current !== null) window.clearTimeout(foldTimer.current) }, [])

  /**
   * Close by folding the overlay back into the color chip that opened it.
   *
   * The point is where it goes, not that it goes: this sheet is the chip's
   * contents, and shrinking it into the chip says so, where fading it out in
   * place would leave it belonging to the screen. Picking a color is a
   * decision, and the fold is the sheet acknowledging it rather than the
   * author having to dismiss a thing they are finished with.
   *
   * The transform cannot be written in CSS, because the chip sits in a corner
   * that moves with the layout, so its distance from the middle of the screen
   * is not a constant. Both rectangles are measured here and handed to the
   * stylesheet as custom properties.
   *
   * With reduced motion asked for, or with no chip on screen to fold into
   * (the bench is closed), it just closes.
   */
  const fold = (): void => {
    if (folding) return
    const root = rootRef.current
    const chip = document.querySelector('.ws__colorchip')
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!root || !chip || still) { onClose(); return }
    const from = root.getBoundingClientRect()
    const to = chip.getBoundingClientRect()
    root.style.setProperty('--fold-x', `${to.left + to.width / 2 - (from.left + from.width / 2)}px`)
    root.style.setProperty('--fold-y', `${to.top + to.height / 2 - (from.top + from.height / 2)}px`)
    root.style.setProperty('--fold-scale', `${to.width / from.width}`)
    setFolding(true)
    foldTimer.current = window.setTimeout(onClose, FOLD_MS)
  }

  /**
   * Put a palette on nostr, or publish an edit of one already there.
   *
   * An edit is a new event that names the old one, because a palette event is
   * immutable (DECK-0003 §1.3b). Objects already pointing at the old event
   * keep the colours they were published with, which is the point of it.
   */
  const share = async (p: NamedPalette): Promise<void> => {
    setNote(null); setShared(null)
    const where = await n().publishPalette(p.name, p.colors, p.event)
    // The store says why it failed, and says it into a toast this modal is
    // painted over, so it is repeated here rather than left unsaid.
    if (!where) { setNote(n().notice ?? 'That palette did not go out.'); return }
    w().notePalettePublished(p.id, where)
    setShared(paletteNevent(where))
    setNote(p.event ? `"${p.name}" is edited. This is the new event; the old one still says what it said.` : `"${p.name}" is on nostr.`)
  }

  /**
   * Whether what is in the box names an event to go and fetch, rather than
   * being the palette itself.
   *
   * Anything that is not a pointer is treated as the colors, which is the
   * common case: the tools people build palettes in hand out text, not nostr
   * references.
   */
  const pointer = /^(nostr:)?(nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]{20,}$/i.test(ref.trim())

  /**
   * Take in somebody else's palette, whether it is on nostr or on the clipboard.
   *
   * The two are one button because they are one intention. A pointer is
   * fetched and keeps the name its author gave it; anything else is read as
   * colors and needs a name here, because a pasted list carries none. espy's
   * copy format names each color but never the palette.
   */
  const bring = async (): Promise<void> => {
    setNote(null); setShared(null)

    if (!pointer) {
      const read = parsePaletteText(ref)
      if ('problem' in read) { setNote(explainPasteProblem(read.problem, read.found)); return }
      const name = pasteName.trim() || 'a pasted palette'
      const id = w().savePalette(name, read.colors)
      setRef(''); setPasteName('')
      setNote(`"${name}", ${read.colors.length} colors, is in the list.`)
      setSwitching({ id, name })
      return
    }

    setReading(true)
    try {
      const got = await n().fetchPalette(ref)
      if (!got) { setNote(n().notice ?? 'Nothing came back.'); return }
      const name = got.name ?? 'a palette from nostr'
      const id = w().savePalette(name, got.colors, got.event)
      setRef('')
      setNote(`"${name}", ${got.colors.length} colors, is in the list.`)
      setSwitching({ id, name })
    } finally {
      // Released whatever happened, so a relay that never answers does not
      // leave the button dead for the rest of the session.
      setReading(false)
    }
  }

  /**
   * Put a color in hand and fold the sheet away.
   *
   * The single place a color leaves this sheet, so the recent row and the
   * palette below it cannot drift apart in what picking means. The fold lives
   * here rather than at each call site for the same reason: a second way out
   * that forgot to close would be a bug nobody noticed until they met it.
   */
  const useColor = (hex: string): void => {
    w().colorSelected(hexToRgbLocal(hex))
    fold()
  }

  /**
   * The palette drawn below, and so the one every pick indexes into: the
   * built-in while building a palette (which starts from the built-in's
   * colors), the object's own otherwise. Picking and making read it rather
   * than `active`, so a pick always means the swatch the author saw.
   */
  const sheet = making ? BUILT_IN : active

  const take = (index: number): void => {
    if (making) {
      setPicked((p) => (p.includes(index) ? p.filter((i) => i !== index) : p.length < 256 ? [...p, index] : p))
      return
    }
    useColor(hexAt(sheet, index))
  }

  const create = (): void => {
    if (picked.length < 2) return
    const colors = picked.map((i) => sheet[i]) as Palette
    const id = w().savePalette(newName, colors)
    setMaking(false); setNewName(''); setPicked([])
    setSwitching({ id, name: newName.trim() || 'untitled' })
  }

  // Escape folds it as the close button does, back into the chip (arkinox,
  // 2026-10-01). Its own confirmations open later, so they close first.
  useEscape('modal', true, fold)

  // Through a portal, for the reason ConfirmModal gives: this is rendered from
  // inside .ws__corner, which has a z-index and a backdrop-filter and is
  // therefore a stacking context, so a full-screen modal left in there paints
  // under the chip row that follows it.
  return createPortal(
    <div className={`modal palettes${folding ? ' is-folding' : ''}`} ref={rootRef} role="dialog" aria-modal="true" aria-label="Palette">
      <div className="palettes__head">
        <div>
          <h2 className="palettes__title">PALETTE</h2>
          <p className="palettes__sub">
            {making
              ? `Tap colors to take them. ${picked.length} chosen, 2 or more makes a palette.`
              : `${activeName} · ${active.length} colors · a color on the wire is an index into this`}
          </p>
          {/*
            The color in hand, by number, without hovering anything.

            The number is what a DNA names a color by, and the tooltips that
            used to be the only place it was written never show on a phone
            (arkinox, 2026-11-11). Hidden while building a palette, where the
            sheet is the built-in and its numbers are about to change.
          */}
          {!making && (
            <p className="palettes__now">
              <span className="palettes__label">COLOR</span>
              <span className="palettes__now-sw" style={{ background: hex }} />
              {current >= 0 ? <b className="palettes__now-n">{current}</b> : null}
              <span className="palettes__now-hex">{current >= 0 ? hex : `${hex} · not in this palette`}</span>
            </p>
          )}
        </div>
        <button className="chip ws__icon" onClick={fold} aria-label="Close"><X size={16} strokeWidth={2.25} /></button>
      </div>

      <div className="palettes__body">
        {/*
          What you just used, above what you could use.

          256 swatches is a lot to hunt through for the color you were working
          in ten seconds ago, and an object is usually built out of a handful
          of them. Hidden while building a palette, where the row would be a
          second set of swatches meaning something different from the ones
          below it.
        */}
        {!making && recent.length > 0 && (
          <section className="palettes__band">
            <h3 className="palettes__band-title">RECENT <span>{recent.length} colors, newest first</span></h3>
            <div className="palettes__grid">
              {recent.map((h) => {
                const i = active.findIndex((_, n) => hexAt(active, n) === h)
                return (
                  <button
                    key={h}
                    className={`palettes__sw ${h === hex ? 'is-on' : ''}${lightInk(h) ? ' is-light' : ''}`}
                    style={{ background: h }}
                    title={i >= 0 ? `${i} · ${h}` : `${h}, not in this palette`}
                    aria-label={i >= 0 ? `Recently used color ${i}, ${h}` : `Recently used color ${h}`}
                    aria-pressed={h === hex}
                    onClick={() => useColor(h)}
                  >{i >= 0 ? <span className="palettes__n" aria-hidden="true">{i}</span> : null}</button>
                )
              })}
            </div>
          </section>
        )}
        {(making ? BANDS : [{ from: 0, to: sheet.length - 1, title: activeName.toUpperCase(), note: `${sheet.length} colors` }]).map((band) => (
          <section key={band.title + band.from} className="palettes__band">
            <h3 className="palettes__band-title">{band.title} <span>{band.note}</span></h3>
            <div className="palettes__grid">
              {sheet.slice(band.from, Math.min(band.to, sheet.length - 1) + 1).map((_, n) => {
                const i = band.from + n
                const on = making ? picked.includes(i) : i === current
                // No numbers while building a palette: a color's number in the
                // new one is its place in the picks, not this one, and a DNA
                // written from the built-in's would name the wrong colors.
                return (
                  <button
                    key={i}
                    className={`palettes__sw ${on ? 'is-on' : ''}${lightInk(hexAt(sheet, i)) ? ' is-light' : ''}`}
                    style={{ background: hexAt(sheet, i) }}
                    title={`${i} · ${hexAt(sheet, i)}`}
                    aria-label={`Color ${i}, ${hexAt(sheet, i)}`}
                    aria-pressed={on}
                    onClick={() => take(i)}
                  >{making ? (on ? <Check size={11} strokeWidth={3} /> : null) : <span className="palettes__n" aria-hidden="true">{i}</span>}</button>
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
                <button
                  className="workshop__mini"
                  disabled={busy}
                  title={p.event ? `Publish an edit of "${p.name}"` : `Publish "${p.name}" to nostr`}
                  aria-label={p.event ? `Publish an edit of ${p.name}` : `Publish ${p.name}`}
                  onClick={() => { void share(p) }}
                >
                  <Upload size={11} strokeWidth={2.25} />
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

            <div className="palettes__row">
              <span className="palettes__label">BRING ONE IN</span>
              {/* A textarea rather than an input because the thing most often
                  pasted here is many lines of "Name - #hex", and a 256 color
                  palette in a one line box cannot be checked before it is
                  taken. */}
              <textarea
                className="avatars__input login__input palettes__paste"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                rows={2}
                placeholder={'nevent1…, or paste colors:\nTomato - #FC4755'}
                aria-label="A palette event to read, or a list of colors"
                spellCheck={false}
              />
              <button className="workshop__btn" disabled={!ref.trim() || reading} onClick={() => { void bring() }}>
                <Download size={12} strokeWidth={2.25} /> BRING IT IN
              </button>
            </div>

            {/* Only for pasted colors. A fetched palette keeps the name its
                author published it under, and offering to rename it here would
                quietly break the link between the two. */}
            {!pointer && ref.trim() !== '' && (
              <div className="palettes__row">
                <span className="palettes__label">CALL IT</span>
                <input
                  className="avatars__input login__input palettes__name"
                  value={pasteName}
                  onChange={(e) => setPasteName(e.target.value)}
                  placeholder="a name for it"
                  aria-label="A name for the pasted palette"
                  spellCheck={false}
                />
              </div>
            )}

            {shared && (
              <div className="palettes__row">
                <span className="palettes__label">POINT AT IT</span>
                {/* Read-only and selectable: this is the reference an object
                    carries, and it is only useful if it can be copied out. */}
                <input className="avatars__input login__input palettes__name" value={shared} readOnly spellCheck={false} aria-label="This palette's reference" onFocus={(e) => e.currentTarget.select()} />
                <button className="workshop__btn" onClick={() => { void navigator.clipboard?.writeText(shared).catch(() => { /* select it by hand */ }) }}>COPY</button>
              </div>
            )}

            {note && <p className="palettes__note">{note}</p>}
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
