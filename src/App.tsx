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
import { useDiscovery } from './hooks/useDiscovery'
import { Hud } from './hud/Hud'
import { Targets } from './hud/Targets'
import { TouchControls } from './hud/TouchControls'
import { ScaleBar } from './hud/ScaleBar'
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

  const isMobile = useIsMobile()
  const targets = useTargets()
  // Off your own head there is nothing to drive: the movement controls stand
  // down and the explorer's RETURN TO LIVE is the way back.
  const atHead = useCyberspace((s) => s.atHead())
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

  // The anchor backfill runs full tilt while the panels are open (the sync
  // numbers are being watched) and breathes between batches while they are
  // closed, so playing in the scene gets the frames.
  useEffect(() => { setSyncPriority(showPanels) }, [showPanels])

  const [padOpen, setPadOpen] = useState(true)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const showPad = padOpen && !crowded && atHead
  // Off your own head the pad stands down, but scale still decides what the
  // scene draws, so its three cells come back on their own. Gated on the same
  // canvas tap as the pad, so hiding the overlay stays one gesture.
  const showScaleBar = padOpen && !crowded && !atHead

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
      {!crowded && <Targets targets={targets} />}
      {!crowded && !secretOpen && (
        <div className="instruments">
          {/* Ordered by how often each is reached for right now: hyperspace
              on top with its status bar, the chain under it, the XOR readout
              last. */}
          <LineScrubber />
          <HyperspaceBar />
          <ChainExplorer />
          <BitReadout />
        </div>
      )}
      {showPanels && <Hud menuOpen={crowded} />}
      <SpectateBar />
      {!crowded && <Compass3D onTap={() => setViewMenuOpen((open) => !open)} />}
      {!crowded && viewMenuOpen && <ViewMenu onClose={() => setViewMenuOpen(false)} />}
      {showPad && <TouchControls />}
      {showScaleBar && <ScaleBar />}
      {!crowded && !padOpen && atHead && (
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
