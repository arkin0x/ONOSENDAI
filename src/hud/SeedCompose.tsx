/**
 * SeedCompose.tsx - SEED in BUILD (DECK-0008): pick a DNA, see what it grows,
 * and plant it at the build cursor.
 *
 * A DNA is one of the six original DNAs (the spec's vectors, the Seed Garden's) or
 * one pasted or imported as text, checked as it is typed (sno-core
 * tryParseDna; the engine's words under the box). The preview grows the bloom
 * in the seeds worker at the build cursor's terroir, at a block age from day
 * 0 to day 30 of the past month's blocks, at the chosen scale. The price is
 * the DNA's caps in bits (§7), with about how long this device takes to mine
 * it. PLANT ▸ hands it to the deploy (useShards `startDeploySeed`), which
 * mines the work at COMMIT, once its place and time are fixed.
 *
 * Caps (§7), shown to people as the SIZE LIMIT (owner, 2026-11-10: "size
 * limit" reads at once; the code and the DNA's `caps` tag keep the spec's
 * word): the original DNAs' (8,000 vertices, 6,000 symbols, 40 days; 21 bits) or
 * the free caps (2,048, 2,048, 32 days; 16 bits). An original DNA defaults to its
 * own, a pasted DNA to the free caps; a bloom stops growing at its caps.
 *
 * The bloom at day 31, grown where the seed lands, says how far it reaches;
 * that sizes its hide height, from 3 to 12 (owner ruling 2026-11-10), shown
 * here and carried to the deploy (plant.ts seedHideHeight).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { BASE_CAPS, capsPrice, type Caps } from 'sno-core/seeds'
import { CardSpin } from '../scene/CardSpin'
import { Explanation } from './Explanation'
import { useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { useHyperspace, getStopByHeight } from '../store/useHyperspace'
import { buildPlane, buildStepOf } from '../lib/buildCursor'
import { deployPoint } from '../lib/space'
import { positionHex } from '../lib/events'
import { useCalibration } from '../lib/calibration'
import { minerCount } from '../lib/avatarWorker'
import { describeDuration } from '../lib/avatarMine'
import { ORIGINAL_CAPS, ORIGINAL_DNAS, originalDnaId } from '../lib/seeds/originalDnas'
import { bloomReachGibsons, dnaTextRefusal, miningSeconds, PREVIEW_DAYS, previewRequest, readDnaText, seedHideFor, SEED_HIDE_MAX, type SeedFit } from '../lib/seeds/plant'
import type { Position } from '../lib/space'
import type { Plane } from 'cyberspace-core'
import { MAX_COMPUTE_HEIGHT } from '../store/useCyberspace'
import { growInWorker } from '../lib/seeds/growClient'
import { bloomShard } from '../lib/seeds/bloomShard'
import { dnaResolver, headerBook, trustedTip } from '../lib/seeds/seedSources'

/** The largest DNA text a written DNA may be (DECK-0008 §3.1), so an import reads no more. */
const MAX_DNA_BYTES = 8192
/**
 * The largest scale offered: 2^30 gibsons a unit, about a hand's width. The
 * hide height no longer grows with the scale (12 at most, owner ruling
 * 2026-11-10), so no scale sends the bag's key to HOSAKA; a bloom larger than
 * its cube draws past it.
 */
const MAX_SCALE = 30

/** The bloom a DNA grows at the cursor, at a day of the past month, grown in the worker. */
function usePreview(text: string, ok: boolean, caps: Caps, coord: string, scale: number, day: number): ShardModel | null {
  const [shard, setShard] = useState<ShardModel | null>(null)
  const tip = useHyperspace((s) => s.tipHeight)
  useEffect(() => {
    if (!ok) { setShard(null); return }
    let stale = false
    // A slider dragged sends one request when it rests, not one a pixel.
    const timer = setTimeout(() => {
      const now = trustedTip() ?? tip ?? 975_300
      const req = previewRequest({ text, caps, coord, scale, tip: now, day, hashOf: (h) => headerBook.hash(h) ?? getStopByHeight(h)?.blockHash })
      void growInWorker(req).then((answer) => {
        if (stale) return
        if (answer.type !== 'bloom') { setShard(null); return }
        const name = readDnaText(text)
        setShard(bloomShard(answer.buffers, name.ok ? name.name : 'bloom', scale, `preview:${req.clock}:${scale}:${coord}:${caps.vertices}:${text.length}`))
      }, () => { if (!stale) setShard(null) })
    }, 80)
    return () => { stale = true; clearTimeout(timer) }
  }, [text, ok, caps, coord, scale, day, tip])
  return shard
}

/**
 * The hide height SEED finds here (plant.ts seedHideFor): each height's own
 * landing point, the bloom grown there at day 31 in the worker, the smallest
 * from 3 to 12 that holds it. With the point the preview grows at, so the
 * preview is the bloom that lands.
 */
function useSeedFit(text: string, ok: boolean, caps: Caps, cursor: Position, plane: Plane, step: number, scale: number): { fit: SeedFit | undefined; point: Position; state: 'pending' | 'done' | 'failed' } {
  const fallback = useMemo(() => deployPoint(cursor, step, SEED_HIDE_MAX), [cursor, step])
  const [result, setResult] = useState<{ fit: SeedFit | undefined; point: Position; state: 'pending' | 'done' | 'failed' }>({ fit: undefined, point: fallback, state: 'pending' })
  const tip = useHyperspace((s) => s.tipHeight)
  useEffect(() => {
    setResult({ fit: undefined, point: fallback, state: ok ? 'pending' : 'done' })
    if (!ok) return
    let stale = false
    const timer = setTimeout(() => {
      const now = trustedTip() ?? tip ?? 975_300
      const reachAt = async (p: Position): Promise<number | undefined> => {
        const req = previewRequest({ text, caps, coord: positionHex(p, plane), scale, tip: now, day: PREVIEW_DAYS, hashOf: (h) => headerBook.hash(h) ?? getStopByHeight(h)?.blockHash })
        const answer = await growInWorker({ ...req, key: 'preview-reach' })
        return answer.type === 'bloom' ? bloomReachGibsons(answer.buffers.positions, scale) : undefined
      }
      seedHideFor(cursor, plane, step, MAX_COMPUTE_HEIGHT, reachAt).then((r) => {
        if (stale) return
        const fit = r.reach !== undefined ? { height: r.height, reach: r.reach, cursor: positionHex(cursor, plane), step } : undefined
        setResult({ fit, point: r.point, state: fit ? 'done' : 'failed' })
      }, () => { if (!stale) setResult({ fit: undefined, point: fallback, state: 'failed' }) })
    }, 120)
    return () => { stale = true; clearTimeout(timer) }
  }, [text, ok, caps, cursor, plane, step, scale, tip, fallback])
  return result
}

/** The owner's published event for an original DNA, resolved (lib/seeds/dnaStore), and its size limit. */
function useOwnerDna(id: string | null): { state: 'none' | 'fetching' | 'missing' } | { state: 'ok'; caps: Caps } {
  const [got, setGot] = useState<{ id: string; caps: Caps | null } | null>(null)
  useEffect(() => {
    if (!id) return
    let stale = false
    void dnaResolver.resolve(id).then((v) => { if (!stale) setGot({ id, caps: v.state === 'ok' ? v.caps : null }) })
    return () => { stale = true }
  }, [id])
  if (!id) return { state: 'none' }
  if (!got || got.id !== id) return { state: 'fetching' }
  return got.caps ? { state: 'ok', caps: got.caps } : { state: 'missing' }
}

export function SeedCompose({ onDone }: { onDone: () => void }): JSX.Element {
  // An original DNA by index, or the pasted text.
  const [pick, setPick] = useState<number | 'paste'>(0)
  const [pasted, setPasted] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [day, setDay] = useState(PREVIEW_DAYS)
  const [scale, setScale] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  // Small caps or the original DNAs'; null follows the pick (an original DNA its own, a pasted DNA the free caps).
  const [capsPick, setCapsPick] = useState<'small' | 'large' | null>(null)
  const cursor = useCyberspace((s) => s.cursor)
  const plane = useCyberspace(buildPlane)
  const step = useCyberspace(buildStepOf)
  const sha256PerSec = useCalibration((s) => s.sha256PerSec)

  const text = pick === 'paste' ? pasted : ORIGINAL_DNAS[pick].text
  const refusal = pick === 'paste' && !pasted.trim() ? null : dnaTextRefusal(text)
  const ok = refusal === null && text.trim() !== ''
  // An original DNA the owner has published is planted as that event, at its own size limit (owner ruling 2026-11-10).
  const ownerId = pick === 'paste' ? null : originalDnaId(ORIGINAL_DNAS[pick].name)
  const owned = useOwnerDna(ownerId)
  const chosen: Caps = (capsPick ?? (pick === 'paste' ? 'small' : 'large')) === 'small' ? BASE_CAPS : ORIGINAL_CAPS
  const caps: Caps = ownerId && owned.state === 'ok' ? owned.caps : chosen
  // Where the seed lands, at the height it will hide at, and that height.
  const seedFit = useSeedFit(text, ok, caps, cursor, plane, step, scale)
  const coord = useMemo(() => positionHex(seedFit.point, plane), [seedFit.point, plane])
  const preview = usePreview(text, ok, caps, coord, scale, day)
  const hideHeight = seedFit.fit?.height ?? Math.min(SEED_HIDE_MAX, MAX_COMPUTE_HEIGHT)
  const price = capsPrice(caps) ?? 0
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
    if (ownerId && owned.state !== 'ok') return
    useShards.getState().startDeploySeed({ text, caps, scale, title: '', ...(ownerId ? { dnaId: ownerId } : {}), ...(seedFit.fit ? { fit: seedFit.fit } : {}) })
    onDone()
  }

  return (
    <div className="shards__compose seedc">
      <div className="seedc__picks" role="group" aria-label="DNA">
        {ORIGINAL_DNAS.map((d, i) => (
          <button key={d.name} aria-pressed={pick === i} className={`seedc__pick ${pick === i ? 'is-on' : ''}`} onClick={() => { setPick(i); setCapsPick(null) }}>{d.name.toUpperCase()}</button>
        ))}
        <button aria-pressed={pick === 'paste'} className={`seedc__pick ${pick === 'paste' ? 'is-on' : ''}`} onClick={() => { setPick('paste'); setCapsPick(null) }}>PASTE</button>
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
      {ownerId ? (
        <p className="seedc__price">{owned.state === 'ok' ? 'SIZE LIMIT SET BY THIS DNA' : owned.state === 'missing' ? 'THIS DNA IS NOT ON YOUR RELAYS YET' : 'FETCHING THIS DNA…'}</p>
      ) : (
      <div className="seedc__row" role="group" aria-label="Size limit">
        <span className="secret__label seedc__label--wide">SIZE LIMIT</span>
        <button aria-pressed={caps === BASE_CAPS} className={`seedc__pick ${caps === BASE_CAPS ? 'is-on' : ''}`} onClick={() => setCapsPick('small')} title="2,048 vertices, 2,048 symbols, 32 days">SMALL</button>
        <button aria-pressed={caps === ORIGINAL_CAPS} className={`seedc__pick ${caps === ORIGINAL_CAPS ? 'is-on' : ''}`} onClick={() => setCapsPick('large')} title="8,000 vertices, 6,000 symbols, 40 days">LARGE</button>
      </div>
      )}
      <p className="seedc__price">
        PRICE {price} BITS · {seconds === null ? 'MINING TIME UNKNOWN UNTIL CALIBRATED' : `${describeDuration(seconds).toUpperCase()} TO MINE HERE`}
      </p>
      <p className="seedc__price" title="Seeds hide at 12 or lower so anyone looking nearby finds them. Raise it on the next bar to hide one.">
        HIDE HEIGHT {seedFit.state === 'pending' && ok ? '…' : hideHeight}
      </p>

      <div className="shards__actions">
        <button className="avatars__go" onClick={onDone}>CANCEL</button>
        <button className="avatars__go" disabled={!ok || seedFit.state === 'pending' || (ownerId !== null && owned.state !== 'ok')} onClick={plant} title="Aim it at the build cursor; its work is mined when you hide it">PLANT ▸</button>
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
