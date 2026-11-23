/**
 * StampLibrary.tsx - what STAMP's OBJECT stamps, chosen from your whole
 * workshop library (owner, 2026-11-23: "in the workshop, with the stamp
 * tool, if we could have a panel toggle buttons for 'Copy' or 'Link'.
 * Default would be Copy - here your whole local workshop shard list is
 * shown, and when you select a shard, the stamp tool will copy the geometry
 * of the selected shard into your scene").
 *
 *   COPY  the shard's points and faces put into this one as your own, to edit
 *         like anything you drew (lib/stampCopy.ts). Everything it places is
 *         read and flattened in; no reference is left behind.
 *   LINK  the shard placed as one object by reference, which follows it
 *         (DECK-0003 §1.10). A shard of yours that is not published goes out
 *         sealed beside whatever you hide (#868), so a local one can be linked
 *         as a published one can; the published objects under your key that
 *         are not in this library, and anyone's by address, are here too.
 *
 * At the bottom, always in the same place: the fullness bar (FullnessBar)
 * with what one stamp of the chosen shard would add, hatched, and refused in
 * words when it would pass what one hidden object holds; SNAP TO ITS SIZE
 * (so a 16-gibson piece steps by 16) and STAMP IT, a half-width pair as the
 * CREATE panel's buttons are.
 *
 * The look: the rows are the Shard Feed's, an 80px chamfered picture beside
 * two lines; the two ways are a pair of chamfered tiles with a lit edge on
 * the one in use, after the mode switches of the sci-fi asset browsers and
 * HUD kits on Dribbble (pbranigan's "HUD FUI Inspiration", albemala's "Sci-Fi
 * Futuristic UIs") and the asset panels of 3D builder concepts (Contra,
 * "3D Builder Dashboard" by Cansaas and Kraftbase): one strong choice up
 * top, a quiet list, the cost of the choice pinned where the thumb is.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Crosshair, Grid2x2Check, Link } from 'lucide-react'
import { fromPayload, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { Sheet } from './shell/Sheet'
import { FullnessBar } from './FullnessBar'
import { prepareStamp } from './stampPrepare'
import { objectsOf, parseObjectAddress } from './ObjectPicker'
import { GENERAL_RELAYS } from '../lib/contacts'
import { fetchRef } from '../lib/parts'
import { keepOwnTable } from '../lib/carried'
import { queryAny } from '../lib/relay'
import { stillPublished } from '../lib/partForm'
import { stampRefusal } from '../lib/shardFullness'
import { stampedShard, stampSize, type StampForm } from '../lib/stampCopy'
import { withAuthoredConstrain } from '../lib/walkConstrain'
import { readRelays } from '../store/useRelays'
import { useCyberspace } from '../store/useCyberspace'
import { usePublished } from '../store/usePublished'
import { useWorkshop, type StampObject } from '../store/useWorkshop'
import { useShardFolders } from '../store/useShardFolders'
import { useEscape } from '../hooks/useEscape'
import { useScrollMemory } from '../hooks/useScrollMemory'
import { ShardFolders, modelEditedAt, modelName, modelRef, useNewestFirst } from '../hud/ShardFolders'
import { ShardThumb } from '../hud/ShardThumb'
import { Chamfer, THUMB_PX } from '../hud/ui/Chamfer'
import { SearchField } from '../hud/ui/SearchField'

const OBJECT_KIND = 33331
const WAIT_MS = 5000
const bytes = (s: ShardModel): number => new TextEncoder().encode(JSON.stringify(toPayload(withAuthoredConstrain(s)))).length

/** The two ways, as their tiles say them. */
const FORMS: Array<{ form: StampForm; label: string; line: string; icon: typeof Copy }> = [
  { form: 'copy', label: 'COPY', line: 'Its points and faces, yours to edit', icon: Copy },
  { form: 'link', label: 'LINK', line: 'One object that follows the shard', icon: Link },
]

/** The size SNAP TO ITS SIZE steps by, in whole gibsons on this grid, for its button: "16 × 16". */
export function snapLabel(size: [number, number, number] | null, plane: 0 | 1 | 2): string {
  if (!size) return 'GRID'
  const axes = [0, 1, 2].filter((k) => k !== plane)
  const n = (t: number): string => { const g = t / 120; return Number.isInteger(g) ? String(g) : g.toFixed(1) }
  return axes.map((k) => (size[k] > 0 ? n(size[k]) : '1')).join(' × ')
}

export function StampLibrary({ onClose }: { onClose: () => void }): JSX.Element {
  const me = useCyberspace((s) => s.identity.pubkey)
  const form = useWorkshop((s) => s.stampForm)
  const snapOn = useWorkshop((s) => s.stampSnap)
  const chosen = useWorkshop((s) => s.stampObject)
  const shards = useWorkshop((s) => s.shards)
  const current = useWorkshop((s) => s.current())
  const facing = useWorkshop((s) => s.stampFacing)
  const plane = useWorkshop((s) => s.plane)
  const level = useWorkshop((s) => s.level)
  const ledger = usePublished((s) => s.ledger)
  const [query, setQuery] = useState('')
  const [reading, setReading] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [elsewhere, setElsewhere] = useState<ReturnType<typeof objectsOf> | null>(null)
  const [address, setAddress] = useState('')
  const [addressNote, setAddressNote] = useState<string | null>(null)
  const w = useWorkshop.getState
  useEscape('modal', true, onClose)

  // Newest first, as every list of your shards (hud/ShardFolders).
  const library = useNewestFirst(shards, modelRef, modelEditedAt)
  const foldersRead = useShardFolders((s) => s.storage !== 'loading')
  const listScroll = useScrollMemory('workshop-stamp-objects', foldersRead)

  // LINK reaches past the library too: what this key published from elsewhere (snocrash, another browser).
  useEffect(() => {
    if (form !== 'link' || elsewhere !== null || !me) return
    let live = true
    void queryAny([...new Set([...readRelays(), ...GENERAL_RELAYS])], { kinds: [OBJECT_KIND], authors: [me] }, WAIT_MS)
      .then((events) => { usePublished.getState().learn(events); if (live) setElsewhere(objectsOf(events)) }, () => { if (live) setElsewhere([]) })
    return () => { live = false }
  }, [form, elsewhere, me])
  const localIds = useMemo(() => new Set(shards.map((s) => s.id)), [shards])
  const notHere = useMemo(() => (elsewhere ?? []).filter((o) => !localIds.has(o.address.split(':').slice(2).join(':'))), [elsewhere, localIds])

  // The last pick asked: a slower read of an earlier pick never replaces it.
  const asked = useRef(0)
  const choose = async (shard: ShardModel, ref: Ref, author: string | null, own: boolean): Promise<void> => {
    const ticket = ++asked.current
    setReading(shard.id)
    setProblem(null)
    try {
      const prepared = await prepareStamp(shard, ref, author, own)
      if (ticket !== asked.current) return
      const { missing, ...object } = prepared
      if (missing > 0) setProblem(`${missing === 1 ? 'One object' : `${missing} objects`} it places could not be read: COPY needs them all.`)
      w().setStampObject(object as StampObject)
    } catch {
      if (ticket === asked.current) setProblem('That shard could not be read. Try it again.')
    } finally {
      if (ticket === asked.current) setReading(null)
    }
  }
  // Signed out there is no author to name: COPY still works (LINK refuses it in words, workshop/stampTap.ts).
  const pickLocal = (s: ShardModel): void => { void choose(s, ['a', `${OBJECT_KIND}:${me ?? ''}:${s.id}`], me || null, true) }

  const byAddress = async (): Promise<void> => {
    const parsed = parseObjectAddress(address)
    if (!parsed) { setAddressNote('That is not an object address. Paste an naddr1… or 33331:<pubkey>:<d>.'); return }
    setAddressNote('Asking the relays…')
    const ref: Ref = parsed.relay ? ['a', parsed.address, parsed.relay] : ['a', parsed.address]
    const raw = await fetchRef(ref).catch(() => null)
    const read = raw == null ? null : fromPayload(raw, parsed.address)
    const author = parsed.address.split(':')[1]
    const shard = read && keepOwnTable(read, author)
    if (!shard) { setAddressNote(raw == null ? 'No relay had that object.' : 'That object is not one the format can read.'); return }
    setAddressNote(null)
    await choose(shard, ref, author, false)
  }

  // What one stamp would leave this shard as, at the middle of the grid on the working level: the bar's hatched run.
  const nowBytes = useMemo(() => (current ? bytes(current) : 0), [current])
  const selfAddress = me && current ? `${OBJECT_KIND}:${me}:${current.id}` : undefined
  const projection = useMemo(() => {
    if (!current || !chosen) return null
    const at: [number, number, number] = [0, 0, 0]
    at[plane] = level
    const r = stampedShard(current, chosen, form, at, facing, false, selfAddress)
    if (!r.ok) return { why: r.why, after: null as number | null }
    const after = bytes(r.shard)
    return { why: stampRefusal(nowBytes, after), after }
  }, [current, chosen, form, facing, plane, level, nowBytes, selfAddress])
  // Whether each shard of yours is published and unedited, once per change of the library or the ledger, not per row and keystroke.
  const published = useMemo(() => (form === 'link' ? new Set(shards.filter((s) => stillPublished(s, ledger, me)).map((s) => s.id)) : new Set<string>()), [form, shards, ledger, me])
  const size = chosen?.size && current ? stampSize(chosen.size, facing, current.unit) : null
  const isSelf = (s: ShardModel): boolean => s.id === current?.id
  const blocked = !chosen || !!projection?.why || reading !== null
  const footWords = reading ? 'Reading what it places…' : !chosen ? 'Choose a shard to see what it adds.' : projection?.why ?? undefined

  return (
    <Sheet name="Choose what STAMP places" title="STAMP" sub={chosen ? chosen.name : undefined} onClose={onClose} tall className="stamplib-sheet" bodyRef={listScroll}>
      <div className="stamplib">
        <div className="stamplib__forms" role="radiogroup" aria-label="How it is stamped">
          {FORMS.map((f) => {
            const on = form === f.form
            return (
              <button key={f.form} role="radio" aria-checked={on} className={`stamplib__form${on ? ' is-on' : ''}`} onClick={() => w().setStampForm(f.form)}>
                <span className="stamplib__form-head"><f.icon size={16} strokeWidth={2.25} aria-hidden /><b>{f.label}</b></span>
                <span className="stamplib__form-line">{f.line}</span>
              </button>
            )
          })}
        </div>

        {(shards.length > 1 || query !== '') && <SearchField className="workshop__search" value={query} onChange={setQuery} placeholder="Search shards and folders" label="Search your shards and folders" />}

        <ul className="stamplib__list">
          <ShardFolders items={library} refOf={modelRef} nameOf={modelName} query={query} row={(s, f) => {
            const empty = s.vertices.length === 0 && (s.parts?.length ?? 0) === 0
            const self = isSelf(s)
            // LINK never places the shard into itself; COPY of it puts a second copy of its points down, as DUPLICATE in place would.
            const off = empty || reading !== null || (form === 'link' && (self || !me))
            const on = chosen?.local === true && chosen.shard.id === s.id
            const state = empty ? 'EMPTY' : form === 'link' && !me ? 'SIGN IN TO LINK YOUR SHARDS' : form === 'link' && self ? 'THIS SHARD' : form === 'link' ? (published.has(s.id) ? 'PUBLISHED: FOLLOWS ITS EDITS' : 'NOT PUBLISHED: SEALED WITH YOUR HIDE') : self ? 'THIS SHARD' : ''
            return (
              <li key={s.id} {...f.drag} className={on ? 'is-on' : undefined}>
                <button className="stamplib__row" disabled={off} aria-pressed={on} onClick={() => { if (f.selecting) { f.toggle(); return } pickLocal(s) }} title={off ? state : `${form === 'copy' ? 'Copy' : 'Link'} "${s.name}"`}>
                  <Chamfer className="stamplib__thumb"><ShardThumb shard={s} size={THUMB_PX} own /></Chamfer>
                  <span className="stamplib__name">{f.mark(s.name)}</span>
                  <span className="stamplib__meta">
                    <span>{s.vertices.length} points · {s.faces.length} faces{s.parts?.length ? ` · ${s.parts.length} placed` : ''}</span>
                    <span className="stamplib__state">{reading === s.id ? 'READING' : state}</span>
                  </span>
                </button>
                {f.tool}
              </li>
            )
          }} />
        </ul>

        {form === 'link' && (
          <>
            {/* A line kept while the relays are asked, so the address field below never jumps. */}
            {notHere.length === 0 && <p className="login__note stamplib__addrnote">{me && elsewhere === null ? 'Reading your published objects…' : ''}</p>}
            {notHere.length > 0 && (
              <div className="login__section">
                <span className="login__label">Published from elsewhere</span>
                <ul className="stamplib__list stamplib__list--plain">
                  {notHere.map((o) => {
                    const on = chosen?.local !== true && chosen?.ref[1] === o.address
                    return (
                      <li key={o.address} className={on ? 'is-on' : undefined}>
                        <button className="stamplib__row" aria-pressed={on} disabled={reading !== null} onClick={() => { void choose(o.shard, ['a', o.address], o.address.split(':')[1] ?? null, false) }}>
                          <Chamfer className="stamplib__thumb"><ShardThumb shard={o.shard} size={THUMB_PX} /></Chamfer>
                          <span className="stamplib__name">{o.shard.name}</span>
                          <span className="stamplib__meta"><span>{o.shard.vertices.length} points · {o.shard.faces.length} faces</span><span className="stamplib__state">PUBLISHED: FOLLOWS ITS EDITS</span></span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            <div className="login__section">
              <label className="login__label" htmlFor="stamplib-address">Anyone&apos;s, by address</label>
              <input id="stamplib-address" className="avatars__input login__input" type="text" spellCheck={false} autoComplete="off" placeholder="naddr1… or 33331:<pubkey>:<d>" value={address} onChange={(e) => setAddress(e.target.value)} />
              <button className="secret__act login__act" disabled={!address.trim() || addressNote === 'Asking the relays…'} onClick={() => void byAddress()}>USE THIS OBJECT</button>
              <p className="login__note stamplib__addrnote">{addressNote ?? ''}</p>
            </div>
          </>
        )}

        {/* Pinned at the bottom, always the same height: the cost of the choice where the thumb is. */}
        <div className="stamplib__foot">
          <FullnessBar payload={nowBytes} next={projection?.after ?? null} words={footWords} note={problem ?? undefined} />
          <div className="stamplib__acts">
            <button className={`stamplib__act${snapOn ? ' is-on' : ''}`} aria-pressed={snapOn} onClick={() => w().setStampSnap(!snapOn)} title="Step by the shard's own size, so pieces of one size line up edge to edge (G)">
              <Grid2x2Check size={15} strokeWidth={2.25} aria-hidden />
              <span>SNAP: {snapOn ? snapLabel(size, plane) : 'GRID'}</span>
              <kbd className="ws__key" aria-hidden>G</kbd>
            </button>
            <button className="stamplib__act stamplib__act--go" disabled={blocked} onClick={onClose} title={blocked ? footWords ?? '' : 'Tap the grid to stamp it where the ghost shows'}>
              <Crosshair size={15} strokeWidth={2.25} aria-hidden />
              <span>STAMP IT</span>
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
