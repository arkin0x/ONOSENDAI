// import { useEffect, useRef } from 'react'
import { useContext, useEffect, useRef } from 'react'
import { Canvas } from "@react-three/fiber"
import { Cyberspace } from './ThreeCyberspace'
import "../scss/CyberspaceViewer.scss"
import { useCyberspaceStateReconciler } from '../hooks/cyberspace/useCyberspaceStateReconciler'
import { useEngine } from '../hooks/cyberspace/useEngine'
import { IdentityContext } from '../providers/IdentityProvider'
import { Quaternion } from 'three'
// import { useCyberspaceStateReconciler } from '../hooks/cyberspace/useCyberspaceStateReconciler'
// import { Avatar } from './Avatar.tsx'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Tester/>
      <Canvas style={style}>
        <ambientLight intensity={2.0} />
        {/* <Cyberspace> */}
          {/* <Avatar/> */}
        {/* </Cyberspace> */}
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer

// DEBUG RELAY ONLY
const DEBUG_RELAY = {'wss://cyberspace.nostr1.com': {read: true, write: true}}

// LEFTOFF - treat tester as our new avatar class and build it up from the ground up. There is a memory leak in Avatar. see if we can utilize the engine to do the same thing as the avatar class but without modifying the display/camera.
const Tester = () => {
  const {actions, position, velocity, rotation, simulationHeight, actionChainState} = useCyberspaceStateReconciler()

  const { identity } = useContext(IdentityContext)

  const { drift, stopDrift, setGenesisAction, setLatestAction } = useEngine(identity.pubkey, DEBUG_RELAY)

  useEffect(() => {
    // console.log(actions)
    if (actionChainState.status === 'valid') {
      setGenesisAction(actionChainState.genesisAction)
      setLatestAction(actionChainState.latestAction)
      console.log('READY')
    }
  }, [actions, position, velocity, rotation, simulationHeight, actionChainState])

  function debugActions(){
    return actions.map((action, index) => {
      return (
        <div key={index} style={{margin: "1rem", wordWrap: "break-word"}}>
          {action.created_at}<br/>
          {action.id}<br/>
          {JSON.stringify(action.tags).replace(',','\n')}
        </div>
      )
    })
  }

  function move(){
    console.log('MOVE')
    drift(1, new Quaternion(0,0,0,1))
  }

  return (
    <div id="tester" style={{"color": "#777"}}>
      <div id="actions">
        <button onClick={move}>Move</button>
      </div>
      <div id="debug">
        {debugActions()} 
      </div>
    </div>
  )
}

