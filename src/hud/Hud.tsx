/**
 * Hud.tsx - the overlay: who you are, where you are, what the pending hop
 * would cost, and what the chain has cost so far.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { create } from 'zustand'
import { formatBig, formatStep } from '../lib/space'
import { formatCellSizeLong } from 'sno-core/scale'
import { geocode } from '../lib/geocode'
import { onEarthSurface } from '../lib/hyperspace/interest'
import { canonicalViewAt, forgetView, parseViewAt, readRecentViews, rememberView, RECENT_VIEWS_EVENT, RECENT_VIEWS_KEY, type RecentView, type ViewTarget } from '../lib/viewAt'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { shortHex } from '../lib/time'
import { ProfilePic } from './ProfileBadge'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { LoginModal } from './LoginModal'
import { NotificationsButton } from './Notifications'
import { ProfileModal } from './ProfileModal'
import { AvatarsPanel } from './AvatarsPanel'
import { DiscoveredPanel, HiddenPanel } from './DiscoveredPanel'
import { InventoryPanel } from './InventoryPanel'
import { ChainPanel } from './ChainPanel'
import { DerezzPanel } from './DerezzPanel'
import { HyperspacePanel } from './HyperspacePanel'
import { useHyperspace } from '../store/useHyperspace'
import { RelaysPanel } from './RelaysPanel'
import { TargetsPanel } from './TargetsPanel'
import { ShardsPanel } from './ShardsPanel'
import { Legend } from './Legend'
import { ViewPanel } from './ViewPanel'
import { ScaleLadder } from './ScaleLadder'
import { ProofPanel } from './ProofPanel'
import { CloudPanel } from './CloudPanel'
import { Explanation } from './Explanation'
import { StarredPlaces } from './StarredPlaces'
import { PanelSlot } from './PanelSlot'
import { usePanelLayout, type Column, type PanelId } from '../store/usePanelLayout'
import { jobInProgress } from '../lib/cloud'

const AXIS_LABEL: Record<string, string> = { x: 'X', y: 'Y', z: 'Z' }

function signed(axis: string, dir: number): string {
  return `${dir === 1 ? '+' : '-'}${AXIS_LABEL[axis]}`
}

function Brand(): JSX.Element {
  return (
    <header className="brand">
      {/* Intrinsic dimensions reserve the box before the file arrives, so
          even a cold cache cannot shift the layout under the pointer. */}
      <img src="/logo.png" alt="ONOSENDAI" width={1871} height={354} decoding="async" />
      <p>Cyberspace Protocol v2 spatial explorer</p>
    </header>
  )
}

const SIGNER_LABEL: Record<string, string> = {
  local: 'LOCAL KEY',
  nip07: 'EXTENSION',
  nip46: 'BUNKER',
}

/** How long a tapped readout says COPIED before its label returns. */
const COPIED_MS = 1200

/** Tap to copy: which key was copied last, and the copier. The clipboard gets the raw text. */
function useCopied(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (key: string, text: string): void => {
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(key); window.setTimeout(() => setCopied((c) => (c === key ? null : c)), COPIED_MS) },
      () => { /* no clipboard here: the value stays selectable */ },
    )
  }
  return [copied, copy]
}

function IdentityPanel(): JSX.Element {
  const identity = useCyberspace((s) => s.identity)
  const signerKind = useCyberspace((s) => s.signerKind)
  const live = useCyberspace((s) => s.live)
  const profile = useProfile(identity.pubkey)
  const [loginOpen, setLoginOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const name = profileLabel(profile, identity.npub)

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Identity</h2>
        <span className={`tag ${live ? 'tag--live' : 'tag--local'}`}>{live ? 'LIVE' : 'LOCAL'}</span>
      </header>

      <div className="identity__who">
        <ProfilePic pubkey={identity.pubkey} size={38} />
        <div className="identity__who-text">
          <span className="identity__name">{name}</span>
          <span className="identity__signer">{SIGNER_LABEL[signerKind] ?? signerKind}</span>
          <span className="secret__npub" title={identity.npub}>{shortHex(identity.npub, 14, 8)}</span>
        </div>
        <div className="identity__acts">
          <button className="identity__change" onClick={() => setProfileOpen(true)}>PROFILE</button>
          <button className="identity__change" onClick={() => setLoginOpen(true)}>CHANGE</button>
        </div>
      </div>
      <div className="identity__row">
        <NotificationsButton />
      </div>

      <Explanation>
        Your spawn location is equal to your public key. Use the generated key or
        sign in with your nostr keypair. LIVE indicates your proofs are being
        published so other identities can see your movements. LOCAL means proofs
        are stored on this device until you switch to LIVE.
      </Explanation>

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </section>
  )
}

const RECENT_KEY = RECENT_VIEWS_KEY
// Every pinned place (an End of Chain) and three others (viewAt readRecentViews).
const loadRecent = readRecentViews
function saveRecent(list: RecentView[]): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* private mode */ }
}

/**
 * What is typed into the Position panel's VIEW field, kept outside the panel:
 * BUILD mode moves the panel to the top of the menu and back (Hud below),
 * which mounts it afresh, and a coordinate half typed when DEPLOY turned
 * BUILD on was lost with it (review of #235).
 */
export const useViewDraft = create<{ text: string; setText: (text: string) => void }>((set) => ({
  text: '',
  setText: (text) => set({ text }),
}))

export function PositionPanel(): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const plane = useCyberspace((s) => s.plane)
  // Decimals go to the plane on show: yours at your head, the view's in a view.
  const lookedPlane = useCyberspace((s) => (s.atHead() ? s.plane : s.anchorPlane))
  const coordHex = useCyberspace((s) => s.coordHex())
  const sector = useCyberspace((s) => s.sector())
  const [copied, copy] = useCopied()
  const viewText = useViewDraft((s) => s.text)
  const setViewText = useViewDraft((s) => s.setText)
  const [viewBad, setViewBad] = useState(false)
  const [recent, setRecent] = useState<RecentView[]>(() => loadRecent())
  const [recentOpen, setRecentOpen] = useState(false)
  // A place added from elsewhere (the End of Chain a respawn leaves, viewAt
  // addRecentView): shown at once, with the list open so it is seen.
  useEffect(() => {
    const reload = (): void => { setRecent(loadRecent()); setRecentOpen(true) }
    window.addEventListener(RECENT_VIEWS_EVENT, reload)
    return () => window.removeEventListener(RECENT_VIEWS_EVENT, reload)
  }, [])
  const [finding, setFinding] = useState(false)
  const [viewNote, setViewNote] = useState<string | null>(null)
  const look = (typed: string, target: ViewTarget): void => {
    useCyberspace.getState().focusOn(target.position, target.plane, target.label, target.scaleExp, true)
    // A place on Earth gets the pin: marking the focal point is the whole
    // purpose of typing a latitude and longitude or a place name. A
    // coordinate or a triple of axes that is not on the ground gets none,
    // and leaves any standing pin alone.
    if (target.plane === 0 && onEarthSurface(target.position)) {
      useCyberspace.getState().dropPin(target.position, target.label, target.scaleExp)
    }
    const next = rememberView(recent, { input: canonicalViewAt(typed), label: target.label, plane: target.plane })
    setRecent(next)
    saveRecent(next)
  }
  // What is typed is read as it stands: axes, a coordinate, or a latitude and
  // longitude. Anything else is taken as a place by name and looked up once
  // (geocode.ts); what comes back is a latitude and longitude, remembered as
  // such under the place's own name, so the recent entry never needs the
  // lookup again.
  const view = async (): Promise<void> => {
    const typed = viewText.trim()
    const target = parseViewAt(typed, lookedPlane)
    if (target) { setViewBad(false); look(typed, target); return }
    if (!/[a-z]/i.test(typed)) { setViewBad(true); return }
    setFinding(true)
    setViewNote(null)
    try {
      const place = await geocode(typed)
      if (!place) { setViewBad(true); setViewNote(`No place found for "${typed}".`); return }
      const input = `${place.lat}, ${place.lon}`
      const found = parseViewAt(input, 0)
      if (!found) { setViewBad(true); return }
      setViewBad(false)
      setViewText(input)
      look(input, { ...found, label: place.name.toUpperCase() })
    } catch (err) {
      setViewBad(true)
      setViewNote(`Could not look that up: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setFinding(false)
    }
  }

  // Every figure copies on a tap, raw: the grouping commas are for reading,
  // not for pasting into a filter or a script.
  const readout = (key: string, label: string, shown: string, raw: string): JSX.Element => (
    <div key={key}>
      <dt className={copied === key ? 'is-copied' : ''}>{copied === key ? 'Copied' : label}</dt>
      <dd><button className="copy" onClick={() => copy(key, raw)} title="Tap to copy">{shown}</button></dd>
    </div>
  )

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Position</h2>
        <span className={`plane plane--${plane}`}>
          {plane === 0 ? 'DATASPACE' : 'IDEASPACE'}
        </span>
      </header>

      <dl className="stats stats--axes">
        {readout('x', 'X', formatBig(position.x), position.x.toString())}
        {readout('y', 'Y', formatBig(position.y), position.y.toString())}
        {readout('z', 'Z', formatBig(position.z), position.z.toString())}
        {readout('sector', 'Sector', sector, sector)}
      </dl>

      <button className="hash copy" onClick={() => copy('coord', coordHex)} title="Tap to copy">
        <span className={`hash__label ${copied === 'coord' ? 'is-copied' : ''}`}>{copied === 'coord' ? 'copied' : 'coord'}</span>
        <code>{coordHex}</code>
      </button>

      {/* The free view: look at any place without walking there. Three axis
          values, or a coordinate as the tags carry it; the cursor comes along,
          so the pad drives from there and RETURN on the bar brings the view
          home. The last three places typed wait under RECENT. */}
      <div className="viewat">
        <span className="legend__label">View a coordinate</span>
        <form
          className="avatars__find"
          onSubmit={(e) => { e.preventDefault(); void view() }}
        >
          <input
            className={`avatars__input ${viewBad ? 'is-bad' : ''}`}
            value={viewText}
            onChange={(e) => { setViewText(e.target.value); setViewBad(false); setViewNote(null) }}
            placeholder="x, y, z · a coordinate · a place on Earth"
            spellCheck={false}
            autoComplete="off"
            aria-label="A place to view"
            aria-invalid={viewBad}
          />
          <button className="avatars__go" type="submit" disabled={!viewText.trim() || finding} title="Look at this place without moving">{finding ? 'FINDING' : 'VIEW'}</button>
        </form>
        {viewNote && <p className="notice">{viewNote}</p>}
        {recent.length > 0 && (
          <div className="viewat__recent">
            <button className="viewat__toggle" onClick={() => setRecentOpen((o) => !o)} aria-expanded={recentOpen}>
              RECENT <span className="viewat__caret" aria-hidden="true">{recentOpen ? '▴' : '▾'}</span>
            </button>
            {recentOpen && (
              <ul className="viewat__list">
                {recent.map((r) => (
                  <li key={`${r.plane}:${r.input}`}>
                    <button className="viewat__item" onClick={() => { const target = parseViewAt(r.input, r.plane); if (target) { setViewText(r.input); look(r.input, { ...target, label: r.label }) } }} title={r.input}><span className={`plane plane--${r.plane} viewat__plane`}>{r.plane === 0 ? 'D' : 'I'}</span>{r.label}{r.pinned && <span className="viewat__kept" title="Kept in RECENT until you remove it with the × beside it, however many places you look at after it">KEPT</span>}</button>
                    {/* The shard list's delete, in the same place and the same
                        shape: the mark on the right of the row it removes. No
                        confirmation, unlike a shard, because a place is one
                        line of text that typing it again brings straight back. */}
                    <button
                      className="viewat__forget"
                      title={`Forget ${r.label}`}
                      aria-label={`Forget ${r.label}`}
                      onClick={() => { const next = forgetView(recent, r); setRecent(next); saveRecent(next) }}
                    >×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {/* Starred Places, under RECENT: a tap goes there the way a recent
            place does, under its nickname or the name it was starred with,
            and at the zoom it was starred at. */}
        <StarredPlaces onGo={(p, target) => { setViewText(p.input); look(p.input, { ...target, scaleExp: p.scaleExp ?? target.scaleExp }) }} />
      </div>
    </section>
  )
}

function ScalePanel(): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const axes = useCyberspace((s) => s.axes())

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Scale &amp; view</h2>
        <span className="scale-exp">2^{scaleExp}</span>
      </header>

      {/* Two columns: the axis key and the view facts on the left, the whole
          scale range on the right, so the ladder's height is not empty space
          beside three lines of text. */}
      <div className="scale__cols">
        <div className="scale__facts">
          <div className="axis-legend">
            <div className="axis-legend-item">
              <span className="axis-dot axis-dot--x"></span>
              <span className="axis-name">X axis</span>
            </div>
            <div className="axis-legend-item">
              <span className="axis-dot axis-dot--y"></span>
              <span className="axis-name">Y axis</span>
            </div>
            <div className="axis-legend-item">
              <span className="axis-dot axis-dot--z"></span>
              <span className="axis-name">Z axis (forward)</span>
            </div>
          </div>
          <dl className="stats stats--stack">
            <div>
              <dt>Step</dt>
              <dd>{formatStep(scaleExp)}</dd>
            </div>
            <div>
              <dt>Cursor</dt>
              <dd>{formatCellSizeLong(scaleExp)}</dd>
            </div>
            <div>
              <dt>Screen up</dt>
              <dd>{signed(axes.up.axis, axes.up.dir)}</dd>
            </div>
            <div>
              <dt>Screen right</dt>
              <dd>{signed(axes.right.axis, axes.right.dir)}</dd>
            </div>
            <div>
              <dt>Looking along</dt>
              <dd>{signed(axes.out.axis, -axes.out.dir)}</dd>
            </div>
          </dl>
        </div>
        <ScaleLadder />
      </div>

      <Explanation>
        2^0 is the atomic-scale view of cyberspace; things don't get any smaller.
        Your view can scale up exponentially until 2^85, which is the full size of
        cyberspace (along each axis). The cursor represents a cubic meter at 2^33.
        Earth is visible around 2^50.
      </Explanation>
    </section>
  )
}

const OFFICIAL: Array<{ href: string; name: string; what: string }> = [
  { href: 'https://github.com/arkin0x/cyberspace', name: 'Cyberspace v2 Specification', what: 'the core protocol documentation' },
  { href: 'https://straylight.cafe', name: 'straylight.cafe', what: 'cyberspace enthusiast community hub' },
  { href: 'https://cyberspace.international', name: 'cyberspace.international', what: 'education, proliferation, adoption of cyberspace' },
  { href: 'https://snocrash.art', name: 'SnoCrash', what: 'SNO format 3D model builder' },
  { href: 'https://github.com/arkin0x/ONOSENDAI/tree/v2', name: 'ONOSENDAI v2 Codebase', what: 'this client, on GitHub' },
]

function LinksPanel(): JSX.Element {
  return (
    <section className="panel panel--links">
      <header className="panel__head">
        <h2>Official</h2>
      </header>
      {OFFICIAL.map((l) => (
        <p key={l.href} className="links__row">
          <a href={l.href} target="_blank" rel="noopener noreferrer">{l.name}</a>
          <span className="links__what"> - {l.what}</span>
        </p>
      ))}
    </section>
  )
}

function Controls(): JSX.Element {
  const rows: Array<[string, string]> = [
    ['W A S D', 'move cursor one step'],
    ['Space', 'commit hop or sidestep (compute proof)'],
    ['X', 'cancel proof / recall cursor (building: stop a move or route from before, else build cursor to your avatar)'],
    ['B', 'build mode in / out: the movement keys and zoom then move the build cursor, never your avatar'],
    ['Shift + W A S D', 'rotate view 90°'],
    ['Tab', 'previous view'],
    ['Esc', 'close: dialog, then menu, then the latest chip'],
    ['C', 'canonical view (facing the black sun)'],
    ['Q / E', 'scale step up / down (zoom out / in)'],
    ['R / F', 'cursor along depth axis'],
    ['P', 'toggle plane'],
    ['H', 'hyperspace line scrubber'],
    ['[ / ]', 'chain explorer: back / forward one action (building: the build cursor goes to it)'],
    ['Home / End', 'chain explorer: spawn / live head (building: the same)'],
  ]

  return (
    <section className="panel panel--controls">
      <header className="panel__head">
        <h2>Controls</h2>
      </header>
      <dl className="keys">
        {rows.map(([key, description]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * Every panel under its layout id (usePanelLayout). The default order there
 * is the menu as it was before the order could change: the left column held
 * Identity, then the three bag panels (Keys and Chests B1, ruling 14) in a
 * bag's order of life (HIDDEN BAGS, on the relay and not yet opened by your
 * keys; DISCOVERED BAGS, opened where it stands; ITEMS, what you hold), then
 * Create, Avatars, Targets and the Official links; the right column Scale,
 * Position, Movement proof, Cloud compute, Proof chain, Hyperspace, View
 * (what the scene draws, just above the Legend that decodes it), Legend,
 * Controls, Derezz and Relays.
 */
const PANELS: Record<PanelId, () => JSX.Element> = {
  identity: IdentityPanel,
  hidden: HiddenPanel,
  discovered: DiscoveredPanel,
  items: InventoryPanel,
  create: ShardsPanel,
  avatars: AvatarsPanel,
  targets: TargetsPanel,
  links: LinksPanel,
  scale: ScalePanel,
  position: PositionPanel,
  proof: ProofPanel,
  cloud: CloudPanel,
  chain: ChainPanel,
  hyperspace: HyperspacePanel,
  view: ViewPanel,
  legend: Legend,
  controls: Controls,
  derezz: DerezzPanel,
  relays: RelaysPanel,
}

/**
 * Where a lifted panel lands for a pointer at (x, y): in the column under
 * the point (or nearest it, when the point is in the gap between the
 * columns), before the first panel there whose middle is below the point,
 * last when none is. The lifted panel is skipped, and so is a leading
 * panel: it is drawn at the top of the left column, not at its saved place,
 * and the saved order is what a drag edits.
 */
function dropTarget(hud: HTMLElement, lifting: PanelId, leads: readonly PanelId[], x: number, y: number): { column: Column; before: PanelId | null } | null {
  let column: HTMLElement | null = null
  let nearest = Infinity
  for (const col of hud.querySelectorAll<HTMLElement>('.hud__col')) {
    const r = col.getBoundingClientRect()
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
    if (d < nearest) { nearest = d; column = col }
  }
  if (!column) return null
  const name = column.dataset.column as Column
  for (const slot of column.querySelectorAll<HTMLElement>(':scope > [data-panel-id]')) {
    const id = slot.dataset.panelId as PanelId
    if (id === lifting || leads.includes(id)) continue
    const r = slot.getBoundingClientRect()
    if (y < r.top + r.height / 2) return { column: name, before: id }
  }
  return { column: name, before: null }
}

export function Hud({ menuOpen = false }: { menuOpen?: boolean }): JSX.Element {
  // With a destination picked, the ride is the thing you are doing: the
  // Hyperspace panel leads the left column until the destination is cleared.
  const rideSet = useHyperspace((s) => s.destination !== null)
  // HOSAKA outranks even that: while a payment is awaited or a job is under
  // way the cloud panel takes the first panel position, under the brand.
  const cloudLeads = useCyberspace((s) => s.cloud.status === 'awaiting_payment' || jobInProgress(s.cloud.status))
  // A move being computed outranks everything: wherever the work is happening,
  // the proof panel is the thing you are watching, so it takes the first
  // position and HOSAKA falls in behind it rather than above it.
  const proofLeads = useCyberspace((s) => s.proof.status === 'computing')
  // BUILD mode puts the Position panel first, above even a move under way
  // (arkinox, 2026-10-08): its VIEW, RECENT and starred places are how the
  // build cursor jumps. The left column comes first on a phone too, where
  // the columns stack, so it is the first panel on both. Back in its own
  // place on exit.
  const building = useBuilder((s) => s.active)
  // The saved layout (arkinox, 2026-10-10): read before the first render, so
  // a refresh shows the menu as it was left, and written on every fold and
  // move. A priority state above only rearranges what is drawn; it writes
  // nothing here, so when it ends the saved order applies again untouched.
  const order = usePanelLayout((s) => s.order)
  const [lifting, setLifting] = useState<PanelId | null>(null)
  const drag = useRef<{ id: PanelId; pointerId: number } | null>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const grabRef = useRef<HTMLDivElement>(null)

  const leads: PanelId[] = []
  if (building) leads.push('position')
  if (proofLeads) leads.push('proof')
  if (cloudLeads) leads.push('cloud')
  if (rideSet) leads.push('hyperspace')
  const left = [...leads, ...order.left.filter((id) => !leads.includes(id))]
  const right = order.right.filter((id) => !leads.includes(id))

  // The drag. The pointer is captured by the drag surface (the .hud__grab
  // div), not by the grip it started on: a lifted panel moves in the DOM as
  // the pointer passes other panels, and a column change mounts it afresh,
  // and either would end a capture held by the grip (a removed element
  // loses its capture, and a touch's events then go to the node it began
  // on). The surface never moves, so the gesture outlives every reorder.
  const grab = (id: PanelId, e: ReactPointerEvent<HTMLButtonElement>): void => {
    const surface = grabRef.current
    if (!surface || drag.current || e.button !== 0) return
    try { surface.setPointerCapture(e.pointerId) } catch { return }
    e.preventDefault()
    drag.current = { id, pointerId: e.pointerId }
    setLifting(id)
  }
  const over = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId || !hudRef.current) return
    const target = dropTarget(hudRef.current, d.id, leads, e.clientX, e.clientY)
    if (target) usePanelLayout.getState().move(d.id, target.before, target.column)
  }
  // Up, cancel and a lost capture all end it; the order is already saved.
  const drop = (): void => {
    if (!drag.current) return
    drag.current = null
    setLifting(null)
  }

  const slot = (id: PanelId): JSX.Element => {
    const Panel = PANELS[id]
    return (
      <PanelSlot key={id} id={id} lead={leads.includes(id)} lifting={lifting === id} onGrab={grab}>
        <Panel />
      </PanelSlot>
    )
  }

  const cls = ['hud', menuOpen && 'hud--menu', lifting && 'hud--dragging'].filter(Boolean).join(' ')
  return (
    <div ref={hudRef} className={cls}>
      <div className="hud__col hud__col--left" data-column="left">
        <Brand />
        {left.map(slot)}
      </div>
      <div className="hud__col hud__col--right" data-column="right">
        {right.map(slot)}
        {/* The license, just above the build. */}
        <div className="hud__license">
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="license noopener noreferrer">CC BY-SA 4.0</a>
        </div>
        {/* The build, last thing in the menu: 2, the day it was merged, how
            many PRs had merged that day, and which PR this is. */}
        <div className="hud__version" title="2 . day merged . PRs merged that day . this PR">{__ONOSENDAI_VERSION__}</div>
      </div>
      <div ref={grabRef} className="hud__grab" onPointerMove={over} onPointerUp={drop} onPointerCancel={drop} onLostPointerCapture={drop} aria-hidden="true" />
    </div>
  )
}
