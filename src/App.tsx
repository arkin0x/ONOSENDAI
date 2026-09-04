import { useCallback, useEffect, useState } from 'react'
import { BitReadout } from './hud/BitReadout'
import { ChainExplorer } from './hud/ChainExplorer'
import { HyperspaceBar } from './hud/HyperspaceBar'
import { LineScrubber } from './hud/LineScrubber'
import { SpectateBar } from './hud/SpectateBar'
import { Workshop } from './workshop/Workshop'
import { DeployBar } from './hud/DeployBar'
import { DeploymentDetail } from './hud/DeploymentDetail'
import { SecretModal } from './hud/SecretModal'
import { FocusBar } from './hud/FocusBar'
import { KeyFoundChip } from './hud/KeyFoundChip'
import { ToastChip } from './hud/ToastChip'
import { LootDetail } from './hud/LootDetail'
import { CloudApproval, CreditedModal, InvoiceModal, PaidModal } from './hud/InvoiceModal'
import { HosakaOffer } from './hud/HosakaOffer'
import { HosakaPulse } from './hud/HosakaPulse'
import { useOfferView } from './store/useOffer'
import { useDiscovery } from './hooks/useDiscovery'
import { Hud } from './hud/Hud'
import { Targets } from './hud/Targets'
import { TouchControls } from './hud/TouchControls'
import { ViewMenu } from './hud/ViewMenu'
import { Compass3D } from './scene/Compass3D'
import { Scene } from './scene/Scene'
import { useCanvasTap } from './hooks/useCanvasTap'
import { useKeyboard } from './hooks/useKeyboard'
import { useProofListener } from './hooks/useProofListener'
import { useIsMobile } from './hooks/useIsMobile'
import { useTargets } from './hooks/useTargets'
import { startCalibration } from './lib/calibration'
import { startPublisher } from './lib/publisher'
import { startSelfSync } from './lib/selfSync'
import { startTracker } from './lib/tracker'
import { useCyberspace } from './store/useCyberspace'
import { useHyperspace } from './store/useHyperspace'
import { setSyncPriority } from './lib/hyperspace/anchors'

/** How long after the panels open the anchor sync goes full tilt. */
const SYNC_PRIORITY_DELAY_MS = 1500
import { useShards } from './store/useShards'

export default function App(): JSX.Element {
  // The keyboard is unconditional. The on-screen controls are a second way in,
  // not a replacement: both call the same store actions, so WASD and the pad
  // cannot drift apart, and nothing about having a pointer takes the keys away.
  useKeyboard()
  useProofListener()
  // The background scan for hidden shards near where you are looking.
  useDiscovery()
  // The chain drains to the relay from here on, whenever Live is on, and the
  // targets' positions are kept current.
  useEffect(() => { startPublisher(); startTracker(); startSelfSync(); startCalibration(); void useCyberspace.getState().initSigner(); useHyperspace.getState().startSync() }, [])
  // A cloud job paid or computing when the tab last closed is picked up here,
  // if the chain head is still the one it was bound to. Also fetches the caps.
  useEffect(() => { void useCyberspace.getState().resumeCloudJob() }, [])
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
  const targets = useTargets()
  // Spectating locks the panels: they describe you, and the scene is not about
  // you right now. The bar carries what matters and the way out.
  const spectating = useCyberspace((s) => s.spectate !== null)

  // Panels start open on a desktop and closed on a phone, and after that the
  // hamburger owns it on both. It used to be derived from the breakpoint, which
  // was necessary while the hamburger only existed on mobile: a stored `false`
  // would have stranded a desktop HUD with no control to bring it back.
  const [panelsOpen, setPanelsOpen] = useState(!isMobile)
  const showPanels = panelsOpen && !spectating

  // Opening a deployment's wire record flies the scene to the shard, and on a
  // phone that overlay sits along the bottom over the hamburger. So tapping a
  // deployment closes the panels: the shard is what you asked to look at, the
  // overlay is how you act on it, and EXIT frees the hamburger again. Only on a
  // phone, where the two fight for the space; a desktop shows both at once.
  const inspecting = useShards((s) => s.inspecting !== null)
  useEffect(() => {
    if (inspecting && isMobile) setPanelsOpen(false)
  }, [inspecting, isMobile])

  // Reading a hidden thing owns the screen: the top-aligned modal sits where
  // the instrument stack lives, so the stack stands aside and the hamburger
  // folds instead of layering underneath it.
  const secretOpen = useShards((s) => s.selectedSecret !== null)
  useEffect(() => { if (secretOpen) setPanelsOpen(false) }, [secretOpen])

  // Only a phone has to choose between reading the panels and driving. On a
  // desktop there is room for both at once.
  const crowded = isMobile && showPanels

  // While the HOSAKA offer card is up it has the screen to itself: the panels,
  // instruments, compass and pad step aside until the cursor comes back
  // within reach, NOT NOW, or the menu opens.
  const offerUp = useOfferView(crowded || secretOpen) !== null

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

  const [padOpen, setPadOpen] = useState(true)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  // The pad no longer depends on being at your own head. Off-head it empties
  // its movement cells and keeps its scale ones (TouchControls), because scale
  // is the one axis that still means something while viewing or spectating.
  const showPad = padOpen && !crowded

  const onSceneTap = useCallback(() => {
    // A tap while the view menu is up dismisses that first, so one gesture never
    // has two meanings.
    setViewMenuOpen((menu) => {
      if (menu) return false
      setPadOpen((open) => !open)
      return false
    })
  }, [])
  useCanvasTap(onSceneTap, !crowded)

  return (
    <div className="app">
      <Scene />
      {!crowded && !offerUp && <Targets targets={targets} />}
      {!crowded && !secretOpen && !offerUp && (
        <div className="instruments">
          {/* Ordered by how often each is reached for right now: hyperspace
              on top with its status bar, the chain under it, the XOR readout
              last. */}
          <LineScrubber />
          <HyperspaceBar />
          <FocusBar />
          <KeyFoundChip />
          <ToastChip />
          <ChainExplorer />
          <BitReadout />
        </div>
      )}
      {showPanels && !offerUp && <Hud menuOpen={crowded} />}
      <SpectateBar />
      {!crowded && !offerUp && <Compass3D onTap={() => setViewMenuOpen((open) => !open)} />}
      {!crowded && !offerUp && viewMenuOpen && <ViewMenu onClose={() => setViewMenuOpen(false)} />}
      {showPad && !offerUp && <TouchControls />}
      {/* Off-head too: tapping a block hides the pad like any scene tap, and
          without this there was no way to bring it back while viewing. */}
      {!crowded && !padOpen && !offerUp && (
        <button
          className="chip touchhint"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); setPadOpen(true) }}
          aria-label="Show controls"
        >CONTROLS</button>
      )}
      {crowded && <div className="mobile-overlay" />}
      <Workshop />
      <DeployBar />
      <DeploymentDetail />
      <SecretModal />
      <LootDetail />
      <HosakaOffer hidden={crowded || secretOpen} />
      {/* While the panels are open the job is on screen in Cloud compute; the pulse is for when it is not. */}
      {!showPanels && <HosakaPulse />}
      <CloudApproval />
      <InvoiceModal />
      <PaidModal />
      <CreditedModal />
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
