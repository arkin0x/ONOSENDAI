import { useEffect, useRef } from 'react'
import { Canvas } from "@react-three/fiber"
import { Cyberspace } from './ThreeCyberspace'
import "../scss/CyberspaceViewer.scss"
import { Avatar } from './Avatar'
import { useCyberspaceStateReconciler } from '../hooks/cyberspace/useCyberspaceStateReconciler'
// import { Avatar } from './Avatar.tsx'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {

  const viewerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Canvas style={style}>
        <ambientLight intensity={2.0} />
        <Cyberspace>
          {/* <Avatar/> */}
          <Tester/>
        </Cyberspace>
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer

// LEFTOFF - treat tester as our new avatar class and build it up from the ground up. There is a memory leak in Avatar. see if we can utilize the engine to do the same thing as the avatar class but without modifying the display/camera.
const Tester = () => {
  const {position, velocity, rotation, simulationHeight, actionChainState} = useCyberspaceStateReconciler()
  useEffect(() => {
    console.log('position', position, 'velocity', velocity, 'rotation', rotation, 'simulationHeight', simulationHeight, 'actionChainState', actionChainState)
  }, [position, velocity, rotation, simulationHeight, actionChainState])
  return null
}