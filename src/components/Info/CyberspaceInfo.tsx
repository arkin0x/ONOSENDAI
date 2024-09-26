import { useRef, useState } from 'react'
import { Canvas, useFrame } from "@react-three/fiber"
import "../../scss/CyberspaceViewer.scss"
import { Fog } from 'three'
// import { BlockMarkers } from './BlockMarkers'
// import { Constructs } from './Constructs'
// import { ObjectMarkers } from './ObjectMarkers'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { OrbitControls } from '@react-three/drei'
import { CoordinateText } from '../Hud/CoordinateText'
import COLORS from '../../data/Colors'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceInfo = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {
  return (
    <div className="cyberspace-info">
      <div id="info">
        <Canvas style={style}>
          <ambientLight intensity={2.0} />
          <OrbitControls />
          <Terminal />
          <EffectComposer>
            <Bloom mipmapBlur levels={9} intensity={20} luminanceThreshold={0.001} luminanceSmoothing={0} />
          </EffectComposer>
        </Canvas>
      </div>
    </div>
  )
}

export default CyberspaceInfo 

function Terminal() {
  const cursorOnChar = ">"
  const cursorOffChar = "\u00A0"
  const cursorBlinkRate = 30
  const cursorTimerReset = 60
  const [cursor, setCursor] = useState(cursorOnChar)
  const cursorRef = useRef(cursorTimerReset)

  useFrame(() => {
    cursorRef.current -= 1
    if (cursorRef.current <= 0) {
      cursorRef.current = cursorTimerReset
      setCursor(cursorOnChar)
    }
    if (cursorRef.current < cursorBlinkRate) {
      setCursor(cursorOffChar)
    }
  })

  return (
    <CoordinateText
      position={{x: 50, y: 50}}
      color={COLORS.BITCOIN}
      text={`test${cursor}`}
      align='left'
    />
  )
}
