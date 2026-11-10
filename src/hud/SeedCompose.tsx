/**
 * SeedCompose.tsx - SEED in BUILD (DECK-0008): pick a DNA, see what it grows,
 * and plant it at the build cursor.
 *
 * A DNA is one of the six starters (the spec's vectors, the Seed Garden's) or
 * one pasted or imported as text, checked as it is typed (sno-core
 * tryParseDna; the engine's words under the box). The preview grows the bloom
 * in the seeds worker at the build cursor's terroir, at a block age from day
 * 0 to day 30 of the past month's blocks, at the chosen scale. The price is
 * the DNA's caps in bits (§7), with about how long this device takes to mine
 * it. PLANT ▸ hands it to the deploy (useShards `startDeploySeed`), which
 * mines the work at COMMIT, once its place and time are fixed.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { capsPrice, tryParseDna } from 'sno-core/seeds'
import { CardSpin } from '../scene/CardSpin'
import { Explanation } from './Explanation'
import { useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { useHyperspace, getStopByHeight } from '../store/useHyperspace'
import { buildPlane } from '../lib/buildCursor'
import { positionHex } from '../lib/events'
import { useCalibration } from '../lib/calibration'
import { minerCount } from '../lib/avatarWorker'
import { describeDuration } from '../lib/avatarMine'
import { STARTER_CAPS, STARTER_DNAS } from '../lib/seeds/starterDnas'
import { dnaTextRefusal, miningSeconds, PREVIEW_DAYS, previewRequest } from '../lib/seeds/plant'
import { growInWorker } from '../lib/seeds/growClient'
import { bloomShard } from '../lib/seeds/bloomShard'
import { headerBook, trustedTip } from '../lib/seeds/seedSources'

/** The largest DNA text a written DNA may be (DECK-0008 §3.1), so an import reads no more. */
const MAX_DNA_BYTES = 8192
/** The scales offered: one gibson a unit, up to a sector. */
const MAX_SCALE = 30

/** The bloom a DNA grows at the cursor, at a day of the past month, grown in the worker. */
function usePreview(text: string, ok: boolean, coord: string, scale: number, day: number): ShardModel | null {
  const [shard, setShard] = useState<ShardModel | null>(null)
  const tip = useHyperspace((s) => s.tipHeight)
  useEffect(() => {
    if (!ok) { setShard(null); return }
    let stale = false
    // A slider dragged sends one request when it rests, not one a pixel.
    const timer = setTimeout(() => {
      const now = trustedTip() ?? tip ?? 975_300
      const req = previewRequest({ text, caps: STARTER_CAPS, coord, scale, tip: now, day, hashOf: (h) => headerBook.hash(h) ?? getStopByHeight(h)?.blockHash })
      void growInWorker(req).then((answer) => {
        if (stale || answer.type !== 'bloom') return
        const name = tryParseDna(text)
        setShard(bloomShard(answer.buffers, name.ok ? name.dna.name : 'bloom', scale, `preview:${req.clock}:${scale}:${coord}:${text.length}`))
      })
    }, 80)
    return () => { stale = true; clearTimeout(timer) }
  }, [text, ok, coord, scale, day, tip])
  return shard
}

export function SeedCompose({ onDone }: { onDone: () => void }): JSX.Element {
  // A starter by index, or the pasted text.
  const [pick, setPick] = useState<number | 'paste'>(0)
  const [pasted, setPasted] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [day, setDay] = useState(PREVIEW_DAYS)
  const [scale, setScale] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace(buildPlane)
  const coord = useMemo(() => positionHex(cursor, plane), [cursor, plane])
  const sha256PerSec = useCalibration((s) => s.sha256PerSec)

  const text = pick === 'paste' ? pasted : STARTER_DNAS[pick].text
  const refusal = pick === 'paste' && !pasted.trim() ? null : dnaTextRefusal(text)
  const ok = refusal === null && text.trim() !== ''
  const preview = usePreview(text, ok, coord, scale, day)
  const price = capsPrice(STARTER_CAPS) ?? 0
  const seconds = miningSeconds(price, sha256PerSec ?? null, minerCount())

  const importFile = async (file: File | undefined): Promise<void> => {
    setImportError(null)
    if (!file) return
    if (file.size > MAX_DNA_BYTES) { setImportError(`That file is ${file.size.toLocaleString('en-US')} bytes. A DNA is at most 8,192.`); return }
    try {
      setPasted(await file.text())
      setPick('paste')
    } catch {
      setImportError('That file could not be read.')
    }
  }

  const plant = (): void => {
    if (!ok) return
    useShards.getState().startDeploySeed({ text, caps: STARTER_CAPS, scale, title: '' })
    onDone()
  }

  return (
    <div className="shards__compose seedc">
      <div className="seedc__picks" role="radiogroup" aria-label="DNA">
        {STARTER_DNAS.map((d, i) => (
          <button key={d.name} role="radio" aria-checked={pick === i} className={`seedc__pick ${pick === i ? 'is-on' : ''}`} onClick={() => setPick(i)}>{d.name.toUpperCase()}</button>
        ))}
        <button role="radio" aria-checked={pick === 'paste'} className={`seedc__pick ${pick === 'paste' ? 'is-on' : ''}`} onClick={() => setPick('paste')}>PASTE</button>
      </div>

      {pick === 'paste' && (
        <>
          <textarea className="shards__textarea seedc__text" rows={8} spellCheck={false} placeholder="Paste a DNA in SEEDO" value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="DNA text" />
          <div className="seedc__row">
            <button className="secret__act seedc__import" onClick={() => fileRef.current?.click()}>IMPORT FILE</button>
            <input ref={fileRef} type="file" accept=".txt,.seedo,text/plain" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        </>
      )}
      {(refusal || importError) && <p className="shards__compose-note shards__compose-note--warn" role="alert">{importError ?? refusal}</p>}

      <div className="seedc__preview">
        {preview ? <CardSpin shard={preview} size={200} /> : <div className="seedc__empty">{ok ? 'Growing…' : 'No bloom yet'}</div>}
      </div>
      <label className="seedc__row seedc__slider">
        <span className="secret__label">DAY</span>
        <input type="range" min={0} max={PREVIEW_DAYS} step={1} value={day} onChange={(e) => setDay(Number(e.target.value))} aria-label="Block age in days" />
        <span className="seedc__value">{day}</span>
      </label>
      <div className="seedc__row">
        <span className="secret__label">SCALE</span>
        <button className="seedc__step" onClick={() => setScale((u) => Math.max(0, u - 1))} disabled={scale === 0} aria-label="Smaller scale">−</button>
        <span className="seedc__value">2^{scale}</span>
        <button className="seedc__step" onClick={() => setScale((u) => Math.min(MAX_SCALE, u + 1))} disabled={scale === MAX_SCALE} aria-label="Larger scale">+</button>
      </div>
      <p className="seedc__price">
        PRICE {price} BITS · {seconds === null ? 'MINING TIME UNKNOWN UNTIL CALIBRATED' : `${describeDuration(seconds).toUpperCase()} TO MINE HERE`}
      </p>

      <div className="shards__actions">
        <button className="avatars__go" onClick={onDone}>CANCEL</button>
        <button className="avatars__go" disabled={!ok} onClick={plant} title="Aim it at the build cursor; its work is mined when you hide it">PLANT ▸</button>
      </div>
      <Explanation>
        <ul className="buildbar__explain">
          <li>A seed grows from its DNA, one generation a day of blocks.</li>
          <li>Everyone who finds it grows the same bloom.</li>
          <li>The preview uses the last month of blocks. The real bloom starts today.</li>
          <li>Planting pays once, in work mined on this device.</li>
        </ul>
      </Explanation>
    </div>
  )
}
