import { useEffect, useState, useRef } from 'react'
import { Canvas, useThree, useFrame, Quaternion } from "@react-three/fiber"
import { Cyberspace } from './ThreeCyberspace'
import { UNIVERSE_DOWNSCALE, UNIVERSE_SIZE, CENTERCOORD, FRAME, DRAG } from "../libraries/Cyberspace"
import { Construct } from '../../building-blocks/ThreeConstruct'
import { BigCoords, decodeHexToCoordinates, downscaleCoords } from '../libraries/Constructs'
import * as THREE from 'three'
import { useCyberspaceStateReconciler } from '../hooks/cyberspace/useCyberspaceStateReconciler.ts'
import "../scss/CyberspaceViewer.scss"

export type CyberspaceViewerProps = {
  constructSize?: number,
  hexLocation?: string, // 64 character hex string
  style?: React.CSSProperties,
}

const CyberspaceViewer = ({constructSize = 1, hexLocation = CENTERCOORD, style = {height: "100%"}}: CyberspaceViewerProps) => {

  const [scale] = useState(UNIVERSE_SIZE)
  const [size, setSize] = useState(constructSize)
  const [coord, setCoord] = useState<BigCoords>(decodeHexToCoordinates(hexLocation))
  const viewerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCoord(decodeHexToCoordinates(hexLocation))
    setSize(constructSize)
  }, [constructSize, hexLocation])

  const downscaled = downscaleCoords(coord, UNIVERSE_DOWNSCALE)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Canvas style={style}>
        <ambientLight intensity={0.8} />
        <Cyberspace targetCoord={coord} targetSize={size} parentRef={viewerRef}>
          <Avatar/>
          <Construct coord={coord} size={size}/>
        </Cyberspace>
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer

const Avatar = () => {
  const [position, velocity, rotation, timestamp, mineDrift] = useCyberspaceStateReconciler()
  const [lerpPosition, setLerpPosition] = useState<THREE.Vector3Tuple>([0,0,0])
  const [lerpVelocity, setLerpVelocity] = useState<THREE.Vector3Tuple>([0,0,0])
  const [currentRotation, setCurrentRotation] = useState<THREE.Vector3Tuple>([0,0,0]) // rotation is based on last state + pointer drag
  const [processedTimestamp, setProcessedTimestamp] = useState<number>(0)
  const [throttle, setThrottle] = useState(1)

  useEffect(() => {
    // on mount, set up listener for W key to go forward. On unmount, remove listener.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "w") {
        // while holding W, mine drift events until one is found of the current throttle or higher or the W key is released.
        mineDrift(throttle, currentRotation)
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "w") {
        // stop mining drift events immediately when W is released
        mineDrift(0)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [])

  useEffect(() => {
    // set the avatar's position, based on the most recent state of cyberspace reconciler (action chain vs other avatar's actions)

    setStatePosition(position)
    setStateVelocity(velocity)
    setStateRotation(rotation)
    setStateTimestamp(timestamp)

    setLerpPosition(position)
    setLerpVelocity(velocity)
    setCurrentRotation(rotation)
    setProcessedTimestamp(timestamp)

  }, [position, velocity, rotation])

  useFrame(({ clock }) => {
    // apply physics to the avatar based on state to LERP animation until next state. If last state was a while ago, LERP to current position.

    // start at the timestamp of the state, and calculate the position 60 times per second until the timestamp matches the current Date.now()

    // calculate the 3D position of the avatar based on the statePosition, elapsed time since timestamp, and stateVelocity, and update the lerpPosition

    const elapsed = (Date.now() - processedTimestamp) // milliseconds since last processed frame or last state change
    let frames = Math.floor( elapsed / FRAME ) // the physics runs at 60 frames per second
    while (frames > 0) {
      const x = lerpPosition[0] + lerpVelocity[0]
      const y = lerpPosition[1] + lerpVelocity[1]
      const z = lerpPosition[2] + lerpVelocity[2]
      setLerpPosition([x,y,z])
      // multiply velocity by 0.999 to simulate friction every frame
      setLerpVelocity([lerpVelocity[0] * DRAG, lerpVelocity[1] * DRAG, lerpVelocity[2] * DRAG])
      setProcessedTimestamp(processedTimestamp + FRAME)
      frames--
    }





  })

  return (
    <camera position={lerpPosition} rotation={currentRotation} quaternion={}/>
  )
}