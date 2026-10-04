/**
 * SecretsModal.tsx — REGION KEYS: every region you can open.
 *
 * A key is a number you computed, not a password you were given: the Cantor
 * root of one aligned region, hashed for the key and again for the lookup id
 * the relay knows it by (spec §7.2). This is the list of those, what each one
 * covers, where it came from, and what it costs to keep.
 *
 * Keys are not hierarchical: holding a region a mile wide says nothing about
 * the block inside it. So the list is flat, and forgetting one is not a loss
 * you cannot undo, since standing there again recomputes it. Anything a key
 * has already opened stays in the Stash whatever happens here.
 *
 * Below the keys are the scanned places: each spot you stood on at your own
 * head, with the thirteen cube keys you had there. They are a section of
 * their own and not rows in the key list, because holding every one of those
 * keys as a key is what once made this list a record of where the camera had
 * been. RESCAN ALL asks the relays about both at once.
 *
 * Both lists draw a hundred rows and a control for the next hundred, since a
 * device can keep thousands of either and a modal that renders them all is
 * slow to open. The places are not in memory at all (there can be a hundred
 * thousand): this reads them from storage a page at a time, newest first.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { KeyRound, MapPin } from 'lucide-react'
import { formatCellSize, formatDistance } from 'sno-core/scale'
import { formatAgo } from '../lib/time'
import { axisDistance } from '../lib/nearby'
import { RESCAN_BATCH, describeSkips, rescanAll, rescanPlace, type Skip } from '../lib/secrets/rescan'
import { describeError } from '../lib/secrets/db'
import { pagePlaces } from '../lib/secrets/vault'
import { useCyberspace } from '../store/useCyberspace'
import { SECRETS_MAX, useSecrets, heldList, type HeldKey, type Place, type SecretsSort, type SecretsStorage } from '../store/useSecrets'
import { sizeLabel } from '../scene/SecretRegions'
import { SCAN_MAX_HEIGHT, useShards } from '../store/useShards'
import { ConfirmModal } from './ConfirmModal'
import { Explanation } from './Explanation'
import { Checkbox } from './ui/Checkbox'
import { Field } from './ui/Switch'
import { useEscape } from '../hooks/useEscape'

const SORTS: Array<[SecretsSort, string]> = [['recent', 'MOST RECENT'], ['volume', 'LARGEST']]

/** Rows drawn per list before SHOW MORE. */
const PAGE = 100

/** The green of "found here", as everywhere else keys are drawn. */
export function SecretsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const keys = useSecrets((s) => s.keys)
  const storage = useSecrets((s) => s.storage)
  const placesVersion = useSecrets((s) => s.placesVersion)
  const rescan = useSecrets((s) => s.rescan)
  const discovered = useShards((s) => s.discovered)
  const showSecrets = useCyberspace((s) => s.showSecrets)
  const position = useCyberspace((s) => s.position)
  const [forgetAll, setForgetAll] = useState(false)
  const [forgetPlaces, setForgetPlaces] = useState(false)
  const [scanning, setScanning] = useState<string | null>(null)
  // Per SCAN button: how many it opened (or -1 when it failed), and a line
  // under its row when it failed or could not ask every relay in full.
  const [scanned, setScanned] = useState<Record<string, number>>({})
  const [scanNote, setScanNote] = useState<Record<string, string>>({})
  // The timers that turn a SCAN button back into SCAN, cleared if the panel closes first.
  const timers = useRef(new Set<number>())
  useEffect(() => {
    const pending = timers.current
    return () => { for (const t of pending) window.clearTimeout(t) }
  }, [])
  const [keysShown, setKeysShown] = useState(PAGE)
  const places = usePlacePages(placesVersion, storage.mode)

  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const limits = useCyberspace((s) => s.cloud.limits)
  const provider = useCyberspace((s) => s.cloud.provider)
  const cloudOff = useCyberspace((s) => s.cloudPrefs.mode === 'off')
  const buying = useSecrets((s) => s.buying)
  const buyError = useSecrets((s) => s.buyError)

  // Above what this machine sweeps for itself, up to what HOSAKA computes.
  const lowest = SCAN_MAX_HEIGHT + 1
  const highest = limits?.max_hop_height ?? lowest
  const canBuy = !cloudOff && highest >= lowest
  const [buyHeight, setBuyHeight] = useState(Math.min(highest, lowest + 4))
  const price = useMemo(() => {
    const ladder = provider?.pricing?.hop
    if (!ladder) return null
    const band = [...ladder].sort((a, b) => a.max_height - b.max_height).find((x) => buyHeight <= x.max_height)
    return band?.sats ?? null
  }, [provider, buyHeight])

  const sort = useSecrets((s) => s.sort)
  const list = useMemo(() => heldList(keys, sort), [keys, sort])
  const bought = useMemo(() => list.filter((k) => k.source === 'cloud').length, [list])
  // What RESCAN ALL asks about, at most: a key that is both is asked once.
  const askable = list.length + storage.placeKeys
  const requests = Math.ceil(askable / RESCAN_BATCH)
  const now = Math.floor(Date.now() / 1000)

  // What each region has actually yielded, so a key that opened something says so.
  const opened = useMemo(() => {
    const by = new Map<string, number>()
    for (const h of Object.values(discovered)) {
      if (!h.lookupId) continue
      by.set(h.lookupId, (by.get(h.lookupId) ?? 0) + 1)
    }
    return by
  }, [discovered])

  const go = (k: HeldKey): void => {
    // The middle of the region, not its corner: looking at a corner puts the
    // thing you asked about at the edge of the screen and everything else in
    // the middle. Half a side along each axis, per axis, because a movement's
    // region is a box.
    const mid = (axis: 'x' | 'y' | 'z'): bigint => {
      const h = BigInt(k.heights ? k.heights[axis] : k.height)
      return BigInt(k.base[axis]) + (1n << h) / 2n
    }
    useSecrets.getState().setOpen(false)
    useSecrets.getState().focus(k.lookupId)
    useCyberspace.getState().focusOn({ x: mid('x'), y: mid('y'), z: mid('z') }, k.plane, `REGION ${sizeLabel(k)}`, Math.max(0, k.height - 3))
  }

  // A place is one gibson, the spot itself; the zoom stays where it is. The
  // focus is the place's id so RETURN brings this list back, as it does for a
  // key; the scene dims the other cages only for a focus that is a held key.
  const look = (p: Place): void => {
    useSecrets.getState().setOpen(false)
    useSecrets.getState().focus(p.id)
    useCyberspace.getState().focusOn({ x: BigInt(p.position.x), y: BigInt(p.position.y), z: BigInt(p.position.z) }, p.plane, 'SCANNED PLACE')
  }

  // One SCAN button's answer, shown for a few seconds: a held key's lookup id
  // or a place's id, which never collide (a place id carries its plane). A
  // failure, or a relay that did not answer in full, is said under the row,
  // and the button can be pressed again either way.
  const scanOne = (id: string, what: string, run: () => Promise<{ found: number; skipped?: Skip[] }>): void => {
    setScanning(id)
    setScanNote((prev) => { const next = { ...prev }; delete next[id]; return next })
    const settle = (n: number): void => {
      setScanning((current) => (current === id ? null : current))
      setScanned((prev) => ({ ...prev, [id]: n }))
      const t = window.setTimeout(() => {
        timers.current.delete(t)
        setScanned((prev) => { const next = { ...prev }; delete next[id]; return next })
      }, 6000)
      timers.current.add(t)
    }
    run().then((r) => {
      if (r.skipped && r.skipped.length > 0) {
        const text = `Not every relay answered the SCAN of the ${what} above in full, so something there may have been missed: ${describeSkips(r.skipped)}. Press SCAN to ask again.`
        setScanNote((prev) => ({ ...prev, [id]: text }))
      }
      settle(r.found)
    }, (err: unknown) => {
      setScanNote((prev) => ({ ...prev, [id]: `SCAN of the ${what} above failed: ${describeError(err)}. Nothing was changed; press SCAN to ask again.` }))
      settle(-1)
    })
  }
  const scanLabel = (id: string): string =>
    scanning === id ? '…' : scanned[id] === undefined ? 'SCAN' : scanned[id] < 0 ? 'FAILED' : scanned[id] > 0 ? `+${scanned[id]}` : 'NONE'
  // Its own line under the row, so the row's buttons stay where they are.
  const scanError = (id: string): JSX.Element | null =>
    scanNote[id] === undefined ? null : <li className="secrets__error secrets__row-error">{scanNote[id]}</li>

  // Escape closes it as a tap outside does (arkinox, 2026-10-01).
  useEscape('modal', true, onClose)

  return createPortal(
    <div className="modal" role="dialog" aria-label="Region keys" aria-modal="true" onPointerDown={onClose}>
      <div className="modal__card secrets__box" onPointerDown={(e) => e.stopPropagation()}>
        <header className="panel__head secrets__head">
          <h2><KeyRound size={14} strokeWidth={2.25} aria-hidden /> Region keys</h2>
          <span className="tag">{list.length === 0 ? 'NO KEYS' : `${list.length} REGION${list.length === 1 ? '' : 'S'}`}</span>
          <button className="targets__remove secrets__close" onClick={onClose} aria-label="Close" title="Close">✕</button>
        </header>

        <div className="secrets__summary">
          <span>{storage.mode === 'indexeddb'
            ? `${formatBytes(storage.bytes)} of ${formatBytes(storage.budget)} on this device`
            : storage.mode === 'local' ? `${formatBytes(storage.bytes)} in localStorage and memory` : 'Opening storage…'}</span>
          <span className="secrets__gap" />
          <Field id="secrets-draw" label="Draw them in the scene">
            <Checkbox id="secrets-draw" checked={showSecrets} onCheckedChange={(v) => useCyberspace.getState().setShowSecrets(v === true)} />
          </Field>
        </div>

        <div className="secrets__body">
          <StorageNote storage={storage} />

          {/* The heights this machine cannot reach for itself. A cube of side
              2^12 it computes as you walk; 2^20 is a million pairings an axis. */}
          {canBuy && (
            <div className="secrets__buy">
              <span className="login__label">Buy a key where you stand</span>
              <div className="secrets__buy-row">
                <button className="secrets__step" disabled={!!buying || buyHeight <= lowest} onClick={() => setBuyHeight((h) => Math.max(lowest, h - 1))} aria-label="Smaller region">−</button>
                <span className="secrets__buy-size">2^{buyHeight} · {formatCellSize(buyHeight)}</span>
                <button className="secrets__step" disabled={!!buying || buyHeight >= highest} onClick={() => setBuyHeight((h) => Math.min(highest, h + 1))} aria-label="Larger region">+</button>
                <button
                  className="avatars__go secrets__buy-go"
                  disabled={!!buying}
                  onClick={() => { void useSecrets.getState().buy(anchor, anchorPlane, buyHeight) }}
                >{buying ? (buying.status === 'submitting' ? 'ASKING' : 'COMPUTING') : `BUY${price !== null ? ` · ${price} SATS` : ''}`}</button>
              </div>
              <span className="cloud__profile-note">
                {buying
                  ? `HOSAKA is computing the 2^${buying.height} cube around you. It lands in this list when it is done.`
                  : `Three axis trees at 2^${buyHeight}, which is a hop's work at that height and is priced as one. Paid from your HOSAKA balance.`}
              </span>
              {buyError && <span className="secrets__error">{buyError}</span>}
            </div>
          )}

          <div className="secrets__rescan">
            <div className="secrets__section-head">
              <span className="login__label">Rescan everything kept here</span>
              <span className="secrets__gap" />
              <button
                className="avatars__go secrets__rescan-go"
                disabled={rescan?.running === true || askable === 0}
                onClick={() => { void rescanAll().catch(() => { /* the status carries the error */ }) }}
              >{rescan?.running ? `ASKING ${rescan.done}/${rescan.requests}` : 'RESCAN ALL'}</button>
            </div>
            <span className="cloud__profile-note">
              Asks the relays what is hidden under every key kept here: the {list.length} held
              key{list.length === 1 ? '' : 's'} below and the {storage.placeKeys} cube key{storage.placeKeys === 1 ? '' : 's'} of
              the scanned places, each lookup id asked once and {RESCAN_BATCH} to a request (about {requests} request{requests === 1 ? '' : 's'}).
              The automatic scan only asks where you stand, as you arrive, so this is how something
              hidden after you left gets found. What comes back is opened with the key it is filed
              under, and a place key that opens something becomes a held key. A relay returns only so
              many events to one request, so a request that comes back that full is split and asked
              again until nothing is cut off.
            </span>
            {rescan && !rescan.running && rescan.error === null && (
              <span className="secrets__result">
                Asked about {rescan.asked} key{rescan.asked === 1 ? '' : 's'}: {rescan.found} item{rescan.found === 1 ? '' : 's'} opened, {rescan.fresh} new to this device
                {rescan.held > 0 ? `, and ${rescan.held} place key${rescan.held === 1 ? '' : 's'} now held` : ''}.
              </span>
            )}
            {rescan && !rescan.running && rescan.error === null && rescan.skipped.length > 0 && (
              <span className="secrets__error">
                Incomplete: not every relay answered in full, so something hidden may have been missed. {describeSkips(rescan.skipped)}.
                What was found is in your Stash; press RESCAN ALL to ask again.
              </span>
            )}
            {rescan && rescan.error !== null && (
              <span className="secrets__error">
                RESCAN ALL stopped: {rescan.error}. Whatever it opened before stopping is in your Stash; press RESCAN ALL to run it again.
              </span>
            )}
          </div>

          <section className="secrets__section" aria-label="Held keys">
            <div className="secrets__section-head">
              <span className="login__label">Held keys</span>
              <span className="tag">{list.length}</span>
              <span className="secrets__gap" />
              {list.length > 0 && <button className="secrets__forget-all" onClick={() => setForgetAll(true)}>FORGET ALL KEYS</button>}
            </div>
            <span className="cloud__profile-note">
              The keys this device holds: ones that opened something where a scan ran, the regions
              your hops crossed, and keys bought from HOSAKA. They are drawn in the scene and kept
              until you forget them. If storage passes its budget, opened and crossed keys go,
              oldest first, only after every scanned place has gone; bought keys never do. Every
              bought key is also copied to a small backstop in localStorage, so a key you paid for
              survives a visit where IndexedDB failed.
            </span>

            {list.length > 1 && (
              <div className="secrets__sort" role="radiogroup" aria-label="Order">
                <span className="login__label">Order</span>
                {SORTS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={sort === value}
                    className={`secret__act cloud__mode ${sort === value ? 'is-on' : ''}`}
                    onClick={() => useSecrets.getState().setSort(value)}
                  >{label}</button>
                ))}
              </div>
            )}

            <ul className="secrets__list">
              {list.slice(0, keysShown).map((k) => {
                const found = opened.get(k.lookupId) ?? 0
                return (
                  <Fragment key={k.lookupId}>
                  <li className="secrets__row">
                    <button className="secrets__go" onClick={() => go(k)} title="Look at this region">
                      <span className="secrets__where">
                        <KeyRound size={11} strokeWidth={2.25} aria-hidden />
                        {sizeLabel(k)}
                      </span>
                      {/* Every side, in real units: a region is a volume and one
                          number could only ever be one of its edges. */}
                      <span className="secrets__dims">{physicalSize(k)}</span>
                      <span className="secrets__meta">
                        {k.plane === 1 ? 'ideaspace' : 'dataspace'} · {k.source === 'cloud' ? 'bought' : k.source === 'hop' ? 'crossed' : 'opened'} · {formatAgo(k.at, now)}
                        {found > 0 && <span className="secrets__found"> · {found} found</span>}
                      </span>
                      <span className="secrets__id">{k.lookupId.slice(0, 16)}…</span>
                    </button>
                    <button
                      className="secrets__scan"
                      disabled={scanning === k.lookupId}
                      onClick={() => scanOne(k.lookupId, 'region', () => useShards.getState().rescan(k.lookupId, k.keyHex).then((found) => ({ found })))}
                      title="Ask the relay what is hidden in this region now"
                    >{scanLabel(k.lookupId)}</button>
                    <button
                      className="targets__remove"
                      onClick={() => useSecrets.getState().forget(k.lookupId)}
                      aria-label="Forget this key"
                      title="Forget this key. Standing there again computes it back."
                    >✕</button>
                  </li>
                  {scanError(k.lookupId)}
                  </Fragment>
                )
              })}
              {list.length === 0 && (
                <li className="avatars__empty">
                  Nothing opened yet. A key is held when it opens something where a scan runs, when a hop crosses its region, or when you buy one. The cubes around each spot you stand on are kept with the scanned places below, not here.
                </li>
              )}
            </ul>
            <ShowMore shown={keysShown} total={list.length} what="keys" onMore={() => setKeysShown((n) => n + PAGE)} />
          </section>

          <section className="secrets__section" aria-label="Scanned places">
            <div className="secrets__section-head">
              <span className="login__label">Scanned places</span>
              <span className="tag">{storage.places}</span>
              <span className="secrets__gap" />
              {storage.places > 0 && <button className="secrets__forget-all" onClick={() => setForgetPlaces(true)}>FORGET ALL PLACES</button>}
            </div>
            <span className="cloud__profile-note">
              Every spot you have stood on at the head of your own chain, meaning where your
              latest committed move left you, with the keys of the
              {` ${SCAN_MAX_HEIGHT + 1} `}cubes around it (sides of 2^0 to 2^{SCAN_MAX_HEIGHT} gibsons) that the
              scan computed there. They are not held keys and are not drawn; they are kept so
              RESCAN ALL, or SCAN on a row, can ask about those cubes again later. Looking around,
              spectating, exploring your history and hyperspace transit never add a place, and
              standing on the same spot again moves it to the top rather than adding it twice.
              Keys that nearby places share are stored once. If storage passes its budget, places
              are the first to go, the one stood on longest ago first.
            </span>

            <ul className="secrets__list">
              {places.rows.map((p) => {
                const away = axisDistance({ x: BigInt(p.position.x), y: BigInt(p.position.y), z: BigInt(p.position.z) }, position)
                return (
                  <Fragment key={p.id}>
                  <li className="secrets__row">
                    <button className="secrets__go" onClick={() => look(p)} title="Look at this place">
                      <span className="secrets__where">
                        <MapPin size={11} strokeWidth={2.25} aria-hidden />
                        {away === 0n ? 'Where you stand' : `${formatDistance(away)} from where you stand`}
                      </span>
                      <span className="secrets__dims">{p.keys.length} cube key{p.keys.length === 1 ? '' : 's'}, 2^0 to 2^{p.keys.length - 1}</span>
                      <span className="secrets__meta">
                        {p.plane === 1 ? 'ideaspace' : 'dataspace'} · stood here {formatAgo(p.at, now)}
                        {p.first < p.at && ` · first ${formatAgo(p.first, now)}`}
                      </span>
                      <span className="secrets__id">{p.keys[0]?.slice(0, 16)}…</span>
                    </button>
                    <button
                      className="secrets__scan"
                      disabled={scanning === p.id}
                      onClick={() => scanOne(p.id, 'place', () => rescanPlace(p.id))}
                      title="Ask the relays what is hidden in this place's cubes now"
                    >{scanLabel(p.id)}</button>
                    <button
                      className="targets__remove"
                      onClick={() => { void useSecrets.getState().forgetPlace(p.id) }}
                      aria-label="Forget this place"
                      title="Forget this place, and the cube keys no other place shares. Standing there again records it back."
                    >✕</button>
                  </li>
                  {scanError(p.id)}
                  </Fragment>
                )
              })}
              {storage.places === 0 && (
                <li className="avatars__empty">
                  No places yet. Each spot your committed moves leave you on is recorded here as you go.
                </li>
              )}
            </ul>
            {places.error && <span className="secrets__error">Could not read the places from storage: {places.error}</span>}
            <ShowMore shown={places.rows.length} total={storage.places} what="places" onMore={places.more} />
          </section>

          <Explanation>
            A region key is the Cantor root of one aligned volume containing your
            hop origin and destination. The key is used for your movement proof,
            but it can also decrypt location-encrypted content anchored to that
            same region. Your action chain already holds the proofs independently
            of these keys, so they can be deleted and recalculated later.
          </Explanation>
        </div>
      </div>

      {forgetAll && (
        <ConfirmModal
          title={`Forget all ${list.length} keys?`}
          body={`Anything they have already opened stays in your Stash. The keys themselves come back by standing in those regions again${bought > 0 ? `, except the ${bought} bought from HOSAKA, which this machine cannot compute and would have to be bought again` : ''}. Scanned places are not touched.`}
          confirmLabel="FORGET ALL KEYS"
          onConfirm={() => { useSecrets.getState().forgetAll(); setForgetAll(false) }}
          onCancel={() => setForgetAll(false)}
        />
      )}
      {forgetPlaces && (
        <ConfirmModal
          title={`Forget all ${storage.places} places?`}
          body="Each place is a spot you stood on and the cube keys the scan had there, kept so RESCAN ALL can look there again. Forgetting them frees that storage and takes nothing else: held keys, bought ones included, stay, and anything already opened stays in your Stash. Standing on a spot again records it again."
          confirmLabel="FORGET ALL PLACES"
          onConfirm={() => { void useSecrets.getState().forgetAllPlaces(); setForgetPlaces(false) }}
          onCancel={() => setForgetPlaces(false)}
        />
      )}
    </div>,
    document.body,
  )
}

/**
 * The scanned places on screen, read from storage a page at a time, newest
 * first: the first page when the panel opens and again whenever this tab
 * changes the places (as many rows as were showing), and the next page on
 * SHOW MORE. A read that a newer one overtakes is dropped.
 */
function usePlacePages(version: number, mode: SecretsStorage['mode']): { rows: Place[]; more: () => void; error: string | null } {
  const [rows, setRows] = useState<Place[]>([])
  const [error, setError] = useState<string | null>(null)
  // Every read takes a number; a result whose number is not the latest is dropped.
  const seq = useRef(0)
  const shown = useRef(PAGE)
  // While the rows are being read again, SHOW MORE waits: its page would be
  // the one after rows that are about to be replaced.
  const reloading = useRef(false)
  useEffect(() => {
    if (mode === 'loading') return
    const mine = ++seq.current
    reloading.current = true
    pagePlaces(null, shown.current).then(
      (page) => { if (mine === seq.current) { reloading.current = false; setRows(page); setError(null) } },
      (err: unknown) => { if (mine === seq.current) { reloading.current = false; setError(describeError(err)) } },
    )
    // Closing the panel, or a newer read, drops this one's result.
    return () => { seq.current++ }
  }, [version, mode])
  const more = useCallback(() => {
    const last = rows[rows.length - 1]
    if (!last || reloading.current) return
    const mine = ++seq.current
    pagePlaces({ at: last.at, id: last.id }, PAGE).then(
      (page) => {
        if (mine !== seq.current) return
        shown.current = rows.length + page.length
        setRows([...rows, ...page])
        setError(null)
      },
      (err: unknown) => { if (mine === seq.current) setError(describeError(err)) },
    )
  }, [rows])
  return { rows, more, error }
}

/**
 * Where these are kept and how safe that is, in a sentence or two. The first
 * thing in the list rather than behind EXPLAIN: whether the browser may clear
 * your keys is a status, not background. Not pinned above the list, where on
 * a phone it took a third of the card.
 */
function StorageNote({ storage }: { storage: SecretsStorage }): JSX.Element {
  const safari = 'Safari, for one, clears a site\'s storage after 7 days without a visit unless the app is on the home screen.'
  let text: string
  let safe = false
  if (storage.mode === 'loading') {
    text = 'Opening this device\'s storage for region keys.'
  } else if (storage.mode === 'local') {
    text = `Kept in localStorage, not IndexedDB. ${storage.reason ?? ''} Keys will not be kept beyond this browser's small localStorage, a few megabytes, so this list holds ${SECRETS_MAX} keys: every bought key always stays, and past ${SECRETS_MAX} the oldest opened and crossed keys are dropped to make room. The keys you hold or forget on this visit are noted in localStorage and applied to IndexedDB the next time it opens. Scanned places last only until this page closes.`
  } else if (storage.persisted === 'granted') {
    safe = true
    text = 'Protected: the browser agreed to keep this storage (navigator.storage.persist), so it will not clear it to make room. Clearing this site\'s data in the browser\'s settings still removes it.'
  } else if (storage.persisted === 'unsupported') {
    text = `This browser has no navigator.storage.persist, so there is no way to ask it to protect this storage, and it may clear it. ${safari}`
  } else if (storage.persisted === 'denied') {
    text = `The browser may clear this storage. It was asked to keep it (navigator.storage.persist) and did not agree, which leaves it free to clear this site's storage when space runs low or the site goes unvisited. ${safari}`
  } else {
    text = `The browser may clear this storage. Protection is asked for the first time something is saved on a visit, and until a browser agrees it is free to clear this site's storage. ${safari}`
  }
  return (
    <span className={`cloud__profile-note secrets__storage ${safe ? 'is-safe' : 'is-risk'}`}>
      {text}
      {storage.error && ` The last save failed (${storage.error}); what is listed here is still held until the page closes.`}
      {storage.backstopError && ` A bought key could not be copied to the backstop in localStorage (${storage.backstopError}). It is still held here, but a visit where IndexedDB fails would not have it; the copy is tried again with the next bought key and at the next load.`}
    </span>
  )
}

/** The next page of a long list, and why the list is paged at all. */
function ShowMore({ shown, total, what, onMore }: { shown: number; total: number; what: string; onMore: () => void }): JSX.Element | null {
  if (total <= shown) return null
  return (
    <div className="secrets__more">
      <button type="button" className="secret__act" onClick={onMore}>SHOW {Math.min(PAGE, total - shown)} MORE</button>
      <span className="cloud__profile-note">
        {total - shown} more {what} not shown. The list draws {PAGE} at a time so a long one stays quick to open and scroll.
      </span>
    </div>
  )
}

/** Every side of the region in real units, so "how big" has a whole answer. */
function physicalSize(k: HeldKey): string {
  if (!k.heights || (k.heights.x === k.heights.y && k.heights.y === k.heights.z)) {
    return `${formatCellSize(k.height)} on every side`
  }
  return `${formatCellSize(k.heights.x)} × ${formatCellSize(k.heights.y)} × ${formatCellSize(k.heights.z)}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
