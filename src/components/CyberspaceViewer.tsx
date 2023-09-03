import { useEffect, useState, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from "@react-three/drei"
import { Cyberspace } from './ThreeCyberspace'
import { UNIVERSE_DOWNSCALE, UNIVERSE_SIZE, CENTERCOORD } from "../libraries/Cyberspace"
import { Construct } from '../../building-blocks/ThreeConstruct'
import { BigCoords, decodeHexToCoordinates, downscaleCoords } from '../libraries/Constructs'
import * as THREE from 'three'
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
    // const urlParams = new URLSearchParams(window.location.search)
    // const coordParam = urlParams.get('coord') || CENTERCOORD
    setCoord(decodeHexToCoordinates(hexLocation))
    // const sizeParam = urlParams.get('constructSize') || ""
    setSize(constructSize)
  }, [constructSize, hexLocation])

  const downscaled = downscaleCoords(coord, UNIVERSE_DOWNSCALE)
  const orbitTarget = new THREE.Vector3(downscaled.x, downscaled.y, downscaled.z)

  return (
    <div className="cyberspace-viewer" ref={viewerRef}>
      <Canvas style={style} camera={{
        near: 0.001, 
        far: scale*2*2*2*2*2*2*2*2,
        position: [0, 0, scale]
      }}>
        <ambientLight intensity={0.8} />
        <Cyberspace targetCoord={coord} targetSize={size} parentRef={viewerRef}>
          <Construct coord={coord} size={size}/>
        </Cyberspace>
        <OrbitControls target={orbitTarget} zoomSpeed={5}/>
      </Canvas>
    </div>
  )
}

export default CyberspaceViewer