import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { BitReadout } from './hud/BitReadout'
import { CrashNote } from './hud/CrashNote'
import { ChainExplorer } from './hud/ChainExplorer'
import { HyperspaceBar, HyperspaceViewBar } from './hud/HyperspaceBar'
import { InstrumentStack } from './hud/InstrumentStack'
import { LineScrubber } from './hud/LineScrubber'
import { SpectateBar } from './hud/SpectateBar'
import { Workshop } from './workshop/Workshop'
import { DeployBar } from './hud/DeployBar'
import { StashModals } from './hud/StashModals'
import { ThumbHost } from './scene/ThumbStage'
import { SecretModal } from './hud/SecretModal'
import { FocusBar } from './hud/FocusBar'
import { BuildBar } from './hud/BuildBar'
import { KeyFoundChip } from './hud/KeyFoundChip'
import { ActionModal } from './hud/ActionModal'
import { NotificationsModal, NotificationsToast, useNotificationsLoop } from './hud/Notifications'
import { AgentTalkHost } from './hud/AgentTalk'
import { useAgentDmWatch } from './hooks/useAgentDmWatch'
import { NearbyChip } from './hud/NearbyChip'
import { NowPlayingChip, SoundChip } from './hud/NowPlaying'
import { GoalChip } from './hud/GoalChip'
import { watchNearbyReturn } from './lib/nearbyReturn'
import { startCoordRoute } from './store/useCoordRoute'
import { DemoCoach } from './hud/DemoCoach'
import { TvScreen } from './hud/TvScreen'
import { isTvPath, useTv } from './store/useTv'
import { isBroadcast, reloadBroadcast } from './lib/tv/broadcast'
import { parseDemoRoute } from './lib/demoRoute'
import { startWorkshopRoute } from './lib/workshopRoute'
import { restoreAfterUnfinishedTour, useDemo } from './store/useDemo'
import { ToastChip } from './hud/ToastChip'
import { StarNickname } from './hud/StarNickname'
import { StarredPlaceCard } from './hud/StarredPlaceCard'
import { LootDetail } from './hud/LootDetail'
import { NearbyLootModal } from './hud/NearbyLootModal'
import { CloudApproval, CreditedModal, InvoiceModal, PaidModal } from './hud/InvoiceModal'
import { HosakaOffer } from './hud/HosakaOffer'
import { ChainConflictPrompt } from './hud/ChainConflict'
import { ChainStatusModal } from './hud/ChainStatus'
import { BrokenChainChip, BrokenChainModal } from './hud/BrokenChain'
import { VersionChip } from './hud/VersionChip'
import { startVersionGate } from './lib/versionGate'
import { HosakaPulse } from './hud/HosakaPulse'
import { useOfferView } from './store/useOffer'
import { useDiscovery } from './hooks/useDiscovery'
import { Hud } from './hud/Hud'
import { Targets } from './hud/Targets'
import { PersonModal } from './hud/PersonModal'
import { ProfileView } from './hud/ProfileView'
import { ProfileModal } from './hud/ProfileModal'
import { useProfileView } from './store/useProfileView'
import { TouchControls } from './hud/TouchControls'
import { WalkLookSphere } from './hud/WalkLookSphere'
import { SyncWarning } from './hud/SyncWarning'
import { RouteOverlay } from './hud/RouteOverlay'
import { ViewMenu } from './hud/ViewMenu'
import { Compass3D } from './scene/Compass3D'
import { PresenceChip } from './hud/PresenceChip'
import { startPresence } from './store/usePresence'
import { hydrateRoster } from './store/useRoster'
import { ChatDock } from './hud/ChatDock'
import { useChatFeed } from './hooks/useChatFeed'
import { watchConnectivity } from './lib/relay'
import { Scene } from './scene/Scene'
import { useCanvasTap } from './hooks/useCanvasTap'
import { setMenuCovering, useKeyboard } from './hooks/useKeyboard'
import { useEscape, useModalUp } from './hooks/useEscape'
import { useProofListener } from './hooks/useProofListener'
import { useIsMobile } from './hooks/useIsMobile'
import { useTargets } from './hooks/useTargets'
import { startCalibration } from './lib/calibration'
import { startPublisher } from './lib/publisher'
import { startSelfSync } from './lib/selfSync'
import { startMutes } from './store/useMutes'
import { watchBlockedSpectation } from './lib/spectator'
import { startTracker } from './lib/tracker'
import { useCyberspace } from './store/useCyberspace'
import { useHyperspace } from './store/useHyperspace'
import { useSecrets, watchFocus } from './store/useSecrets'
import { useInventory } from './store/useInventory'
import { useShardFolders } from './store/useShardFolders'
import { useFound } from './store/useFound'
import { useAvatars } from './store/useAvatars'
import { setSyncPriority } from './lib/hyperspace/anchors'

/** How long after the panels open the anchor sync goes full tilt. */
const SYNC_PRIORITY_DELAY_MS = 1500
import { useShards } from './store/useShards'
import { useBuilder } from './store/useBuilder'
import { CHAT_COVERS_PAD, linkChatAndPad, tapScene, usePad } from './store/usePad'

export default function App(): JSX.Element {
  // Reactions and comments that tag you: the first page per identity, then a poll.
  useNotificationsLoop()
  // New private messages from your agents, for the dot on AGENTS and the
  // toast; only while you have an agent (arkinox, 2026-10-11).
  useAgentDmWatch()
  // The keyboard is unconditional. The on-screen controls are a second way in,
  // not a replacement: both call the same store actions, so WASD and the pad
  // cannot drift apart, and nothing about having a pointer takes the keys away.
  useKeyboard()
  useProofListener()
  // The chain drains to the relay from here on, whenever Live is on, and the
  // targets' positions are kept current.
  useEffect(() => { startVersionGate(); startPublisher(); startTracker(); startPresence(); startSelfSync(); startMutes(); watchBlockedSpectation(); startCalibration(); void useCyberspace.getState().initSigner(); useHyperspace.getState().startSync(); useAvatars.getState().loadMine(); void useSecrets.getState().load(); void useInventory.getState().load(); void useShardFolders.getState().load(); void useFound.getState().load(); watchFocus(); watchNearbyReturn() }, [])
  // onosendai.tech/C/<hex>: a place or a region to open on (store/useCoordRoute.ts).
  useEffect(() => startCoordRoute(), [])
  // onosendai.tech/demo (or /demo/<step>): the guided tour (store/useDemo.ts).
  useEffect(() => {
    const step = parseDemoRoute(window.location.pathname)
    if (step !== null) useDemo.getState().start(step || undefined)
    else restoreAfterUnfinishedTour()
    // Back off /demo while the tour runs leaves it, as EXIT does; Forward
    // onto a /demo entry starts it again, as loading that address would.
    const onPop = (): void => {
      const at = parseDemoRoute(window.location.pathname)
      const d = useDemo.getState()
      if (at === null && d.active) d.exit()
      else if (at !== null && !d.active) d.start(at || undefined)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  // onosendai.tech/tv: Cyberspace TV (store/useTv.ts). Back off /tv turns
  // it off, Forward onto /tv turns it on, as loading that address would.
  useEffect(() => {
    // An address TV cannot open now (BUILD, a deploy, the tour) is put
    // back to /, so it never says /tv over a scene that is not TV.
    const open = (): void => {
      if (useTv.getState().start()) return
      // The stream waits and tries again (lib/tv/broadcast); it never leaves /tv.
      if (isBroadcast()) { reloadBroadcast(); return }
      try { window.history.replaceState(null, '', '/') } catch { /* no history here */ }
    }
    if (isTvPath(window.location.pathname)) open()
    const onPop = (): void => {
      const at = isTvPath(window.location.pathname)
      const tv = useTv.getState()
      if (!at && tv.on) tv.stop()
      else if (at && !tv.on) open()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  // onosendai.tech/workshop: the shard workshop, as OPEN WORKSHOP opens it (lib/workshopRoute.ts).
  useEffect(() => startWorkshopRoute(), [])
  // The feeds that watch other people, the loot and the anchors are reissued
  // when the tab returns from a real absence or the network comes back; a
  // socket that died while the tab was away looks open and delivers nothing.
  useEffect(() => watchConnectivity(), [])
  // The Avatars list kept on this device is read now, so the menu opens on
  // it; the relays are asked when the panel first mounts (useRoster).
  useEffect(() => { void hydrateRoster() }, [])
  // A cloud job paid or computing when the tab last closed is picked up here,
  // if the chain head is still the one it was bound to. Also fetches the caps.
  useEffect(() => { void useCyberspace.getState().resumeCloudJob() }, [])
  // Cubes from a staged hop whose move landed before they finished: the
  // ticket outlives the tab, so a phone put away mid job collects on return.
  useEffect(() => { void useCyberspace.getState().collectCloudKeys() }, [])
  // Back from the wallet: a phone suspends the tab while another app is up,
  // so the invoice poll's timer is still counting when the tab returns. Ask
  // HOSAKA at once instead of waiting the interval out; harmless otherwise.
  useEffect(() => {
    const back = (): void => {
      if (document.visibilityState !== 'visible') return
      const s = useCyberspace.getState()
      s.wakeSigner()
      s.checkCloudPayment()
    }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('pageshow', back)
    window.addEventListener('focus', back)
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('pageshow', back); window.removeEventListener('focus', back) }
  }, [])

  const isMobile = useIsMobile()
  // Spectating locks the panels: they describe you, and the scene is not about
  // you right now. The bar carries what matters and the way out.
  const spectating = useCyberspace((s) => s.spectate !== null)

  // Panels start open on a desktop and closed on a phone, and after that the
  // hamburger owns it on both. It used to be derived from the breakpoint, which
  // was necessary while the hamburger only existed on mobile: a stored `false`
  // would have stranded a desktop HUD with no control to bring it back.
  const [panelsOpen, setPanelsOpen] = useState(!isMobile)
  const showPanels = panelsOpen && !spectating

  // Reading a hidden thing owns the screen: the top-aligned modal sits where
  // the instrument stack lives, so the stack stands aside and the hamburger
  // folds instead of layering underneath it. This is also what closes the
  // panels when a Stash row opens your own thing: the wire record that did
  // it on a phone is part of this card now (arkinox, 2026-10-20).
  const secretOpen = useShards((s) => s.selectedSecret !== null)
  useEffect(() => { if (secretOpen) setPanelsOpen(false) }, [secretOpen])
  // Deploying is the same kind of thing: the bar sits at the top, the panels
  // close at once so the scene is clear to choose a place, and the
  // instruments and compass stay out of the way until it is placed or dropped.
  const deploying = useShards((s) => s.pending !== null)
  useEffect(() => { if (deploying) setPanelsOpen(false) }, [deploying])
  // VIEW from the position panel or a target: on a phone the panels cover the
  // scene, so the view they asked for closes them; RETURN is on the bar.
  const driving = useCyberspace((s) => s.focus?.drive === true)
  const stationView = useHyperspace((s) => s.viewOwned)
  // A region tapped in the Secrets list is the same kind of asking: the panels
  // are what you were reading, and the region is what you asked to see.
  const viewingSecret = useSecrets((s) => s.focused !== null)
  // Any view that begins, driven or not: VIEW on a Nearby Loot row while
  // spectating ends the spectation, and the panels hidden behind it would
  // come straight back over the thing just asked for.
  const viewing = useCyberspace((s) => s.focus !== null)
  // BUILD from the Stash panel, even from a view already driven: the scene is
  // where building happens, so on a phone the panels fold away.
  const building = useBuilder((s) => s.active)
  const touring = useDemo((s) => s.active)
  // The question bubble lives in the menu; on a phone the menu covers the
  // scene, so starting the tour from it closes it. Only on the start:
  // opening the menu during the tour (its menu step) leaves it open.
  useEffect(() => { if (touring && isMobile) setPanelsOpen(false) }, [touring, isMobile])
  useEffect(() => { if ((driving || stationView || viewingSecret || viewing || building) && isMobile) setPanelsOpen(false) }, [driving, stationView, viewingSecret, viewing, building, isMobile])
  // A second VIEW (or RECENT) into a view already driven, as in BUILD mode
  // where VIEW is how the build cursor jumps: none of the flags above change,
  // so the fold above does not fire again and the menu stayed over the place
  // just asked for. A driven view's focus is replaced on every VIEW; with the
  // menu covering the scene nothing else can replace it (the pad and the keys
  // stand down), so a new one is always a VIEW from the panels.
  const drivenFocus = useCyberspace((s) => (s.focus?.drive ? s.focus : null))
  useEffect(() => { if (drivenFocus && isMobile) setPanelsOpen(false) }, [drivenFocus, isMobile])

  // Only a phone has to choose between reading the panels and driving. On a
  // desktop there is room for both at once.
  const crowded = isMobile && showPanels
  // The keys stand down with the pad while the menu covers the scene.
  useEffect(() => { setMenuCovering(crowded) }, [crowded])

  // While the HOSAKA offer card is up it has the screen to itself: the panels,
  // instruments, compass and pad step aside until the cursor comes back
  // within reach, NOT NOW, or the menu opens.
  // Kept here as a flag that OfferWatch sets: the offer is worked out from the
  // cursor, and reading it here re-rendered the whole app (every chip, panel
  // and modal host) on every WALK press and every landing (arkinox,
  // 2026-10-30: walking stuttered).
  const [offerUp, setOfferUp] = useState(false)

  // Escape closes the menu after any modal and before any chip (arkinox,
  // 2026-10-01: "ESC should exit modals, then exit menu, then close ui
  // overlay chips"). On a desktop too, where the panels start open beside
  // the scene: one order everywhere, and the hamburger puts them back. Only
  // while they are on screen, so the HOSAKA card standing them aside, or
  // spectating locking them, leaves Escape for what is showing instead.
  useEscape('menu', showPanels && !offerUp, () => setPanelsOpen(false))

  // The anchor backfill runs full tilt while the panels are open (the sync
  // numbers are being watched) and breathes between batches while they are
  // closed, so playing in the scene gets the frames. Full tilt starts a
  // moment after the panels open, not with them: on a phone the batches
  // (index merges, signature checks) landed in the very frames the menu was
  // trying to paint and the open took over a second.
  useEffect(() => {
    if (!showPanels) { setSyncPriority(false); return }
    const t = window.setTimeout(() => setSyncPriority(true), SYNC_PRIORITY_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [showPanels])

  const padOpen = usePad((s) => s.open)
  // On a phone the open chat dock runs through the controls' column, so the
  // two take turns there: whichever was opened last wins (usePad).
  useEffect(() => linkChatAndPad(() => window.matchMedia(CHAT_COVERS_PAD).matches), [])
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  // The pad no longer depends on being at your own head. Off-head it empties
  // its movement cells and keeps its scale ones (TouchControls), because scale
  // is the one axis that still means something while viewing or spectating.
  // Hidden, not unmounted, while a modal is up: the pad hovered over every
  // modal (arkinox, 2026-10-10), but it also owns the SWITCH TO LIVE
  // confirmation, which is a modal itself. Unmounting the pad when that card
  // opened took the card with it, and LIVE could not be reached (arkinox,
  // the same evening: "the local button is stuck"). The card portals to the
  // body, so a hidden pad still shows it; the pad's open state is kept, so
  // it is back the moment the last modal closes.
  const modalUp = useModalUp()
  const showPad = padOpen && !crowded

  const onSceneTap = useCallback(() => {
    // A tap while the view menu is up dismisses that first, so one gesture never
    // has two meanings.
    if (viewMenuOpen) { setViewMenuOpen(false); return }
    // With the chat open over the controls, this folds the chat (usePad).
    tapScene()
  }, [viewMenuOpen])
  // Cyberspace TV has the screen to itself: the panels, chips, pad and
  // modals are about you, and the picture is not. A tap on the picture
  // does nothing (it used to fold the hidden pad: review of #370).
  const tv = useTv((s) => s.on)
  useCanvasTap(onSceneTap, !crowded && !tv)

  if (tv) {
    return (
      <div className="app">
        <WorldScans />
        <Scene />
        <TvScreen />
      </div>
    )
  }

  return (
    <div className="app">
      <WorldScans />
      <OfferWatch hidden={crowded || secretOpen} onChange={setOfferUp} />
      <Scene />
      {!crowded && !offerUp && <TargetsHere />}
      {!crowded && !secretOpen && !offerUp && !deploying && (
        <div className="instruments">
          {/* Grouped, not ordered by hand (InstrumentStack.tsx): chips with a
              RETURN on top, what is true right now in the middle, toasts at
              the bottom (arkinox, 2026-10-14). */}
          <InstrumentStack groups={{
            return: <>
              <HyperspaceViewBar />
              <FocusBar />
              {/* BUILD mode, where the free view's bar would be: it rides that view. */}
              <BuildBar />
            </>,
            status: <>
              {/* A newer deploy, first of all when it requires a RELOAD to move (lib/versionGate.ts). */}
              <VersionChip />
              {/* A broken chain first: nothing else moves you until you respawn.
                  It stays in BUILD mode too; building is not moving. */}
              <BrokenChainChip />
              {/* The trip GOAL planned, until it is cleared (useGoal.ts). */}
              <GoalChip />
              {/* BUILD mode keeps the stack to what building needs (arkinox,
                  2026-10-08): the line and XOR BITS step aside and come back
                  on exit. */}
              {/* Not during the /demo tour (arkinox, 2026-10-15). */}
              {!building && !touring && <LineScrubber />}
              <HyperspaceBar />
              {/* In BUILD mode too (arkinox, 2026-10-08): scrubbing a chain,
                  yours or a spectated avatar's, aims the build cursor at the
                  action instead of going into history (useBuilder walkChain). */}
              <ChainExplorer />
              {!building && <BitReadout />}
              {/* Under XOR BITS while anything is unread (arkinox, 2026-09-28). */}
              <NotificationsToast />
              {/* What was just found, what is open to you here, then the scan. */}
              <KeyFoundChip />
              <NearbyChip />
              <PresenceChip />
              {/* Hidden audio held back until a tap, then what cyberspace is playing (DECK-0007). */}
              <SoundChip />
              <NowPlayingChip />
            </>,
            toast: <ToastChip />,
          }} />
        </div>
      )}
      {showPanels && !offerUp && <CrashNote where="the menu"><Hud menuOpen={crowded} /></CrashNote>}
      <SpectateBar />
      {!crowded && !offerUp && !deploying && <Compass3D onTap={() => setViewMenuOpen((open) => !open)} />}
      {/* Not while spectating: the spectate bar owns the bottom of the screen,
          and on a foldable's wide screen the folded CHAT chip sat on top of
          it. You cannot speak from someone else's head anyway. */}
      {!crowded && !offerUp && !deploying && !secretOpen && !spectating && <ChatDock />}
      {/* The nickname field for a place just starred, over the star (StarNickname.tsx). */}
      <StarNickname />
      {!crowded && !offerUp && !deploying && viewMenuOpen && <ViewMenu onClose={() => setViewMenuOpen(false)} />}
      <div hidden={modalUp}>
        {showPad && !offerUp && <TouchControls />}
        {/* Not while placing: the deploy bar docks in this same corner
            (arkinox, 2026-10-12), and placing moves no avatar, so there is
            no route to show. */}
        {showPad && !offerUp && !deploying && <RouteOverlay />}
        {/* WALK's look ball, above the menu button (WalkLookSphere.tsx). Not
            tied to the pad, which a tap on the scene folds; not while the
            menu covers the scene or the deploy bar holds this corner. */}
        {!crowded && !offerUp && !deploying && <WalkLookSphere />}
      </div>
      {/* Off-head too: tapping a block hides the pad like any scene tap, and
          without this there was no way to bring it back while viewing. */}
      {!crowded && !padOpen && !offerUp && !modalUp && (
        <button
          className="chip touchhint"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); usePad.getState().setOpen(true) }}
          aria-label="Show controls"
        >CONTROLS</button>
      )}
      {/* The /demo tour's caption panel, only while the tour runs. */}
      <DemoCoach />
      {/* WALK's lag, centered over everything and touching nothing. */}
      <SyncWarning />
      {crowded && <div className="mobile-overlay" />}
      <Workshop />
      {/* The one hidden canvas that draws every list's shard pictures, there only while it has some to draw. */}
      <ThumbHost />
      {/* Docked in the lower left, a gap short of the pad while the pad is on
          screen (arkinox, 2026-10-12). */}
      <DeployBar pad={showPad && !offerUp && !modalUp} />
      {/* One boundary for the record and its neighbors: a crash in one modal
          shows its error where the modal was, and the scene stays up. */}
      <CrashNote where="a modal">
        <StashModals />
        <SecretModal />
        <ActionModal />
        <NotificationsModal />
        <AgentTalkHost />
        <LootDetail />
        <NearbyLootModal />
        <StarredPlaceCard />
        <PersonModal />
        {/* Last, so a profile opened from any card above sits over it. */}
        <ProfileView />
        <ProfileEditor />
      </CrashNote>
      <HosakaOffer hidden={crowded || secretOpen} />
      {/* While the panels are open the job is on screen in Cloud compute; the pulse is for when it is not. */}
      {!showPanels && <HosakaPulse />}
      <CloudApproval />
      <InvoiceModal />
      <PaidModal />
      <CreditedModal />
      {/* A held chain that met a chain on the relays: up until answered, over everything. */}
      <ChainConflictPrompt />
      {/* The explanation behind the chain status strip under the LIVE/LOCAL switch. */}
      <ChainStatusModal />
      {/* Which action broke your chain, why, and RESPAWN behind its warning. */}
      <BrokenChainModal />
      <button
        className="hamburger-menu"
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => setPanelsOpen((open) => !open)}
        disabled={spectating}
        aria-label={spectating ? 'Panels locked while spectating' : panelsOpen ? 'Hide panels' : 'Show panels'}
      >
        <span className={`hamburger-icon ${panelsOpen ? 'hamburger-icon--open' : ''}`}>
          <span></span>
          <span></span>
          <span></span>
        </span>
      </button>
    </div>
  )
}

/** Your own profile's editor, from the Identity panel's PROFILE or a profile's EDIT PROFILE (useProfileView). */
/**
 * The scans that follow where you are (hidden shards near you, the chat's
 * neighbours). Their own component, so a move re-renders this and not the
 * app: both read the anchor, which changes with every step.
 */
function WorldScans(): null {
  // The background scan for hidden shards near where you are looking.
  useDiscovery()
  useChatFeed()
  return null
}

/** The targets' markers, positioned from where you stand; read here so a move re-renders only them. */
function TargetsHere(): JSX.Element {
  return <Targets targets={useTargets()} />
}

/**
 * Whether the HOSAKA offer card is up, handed to the app only when it
 * changes. Laid out before paint, so the panels step aside in the same frame
 * the card appears.
 */
function OfferWatch({ hidden, onChange }: { hidden: boolean; onChange: (up: boolean) => void }): null {
  const up = useOfferView(hidden) !== null
  useLayoutEffect(() => { onChange(up) }, [up, onChange])
  return null
}

function ProfileEditor(): JSX.Element | null {
  const editing = useProfileView((s) => s.editing)
  return editing ? <ProfileModal onClose={() => useProfileView.getState().stopEditing()} /> : null
}
