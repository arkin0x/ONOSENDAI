import React, { useRef, useState } from 'react'
import { Canvas, useFrame } from "@react-three/fiber"
import "../../scss/CyberspaceViewer.scss"
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { OrbitControls } from '@react-three/drei'
import { CoordinateText } from '../Hud/CoordinateText'
import COLORS from '../../data/Colors'

export type CyberspaceViewerProps = {
  style?: React.CSSProperties,
}

const CyberspaceInfo = ({style = {height: "100svh"}}: CyberspaceViewerProps) => {
  const [messageIncrement, setMessageIncrement] = useState(0)
  function nextMessage() {
    setMessageIncrement(messageIncrement + 1)
  }
  return (
    <div className="cyberspace-info">
      <div id="info">
        <Canvas style={style} onClick={nextMessage}>
          <ambientLight intensity={2.0} />
          <OrbitControls />
          <Terminal 
            animate={messageIncrement === 0}
            text={"Cyberspace.\nA consensual hallucination experienced daily\nby billions of legitimate operators, in every\nnation, by children being taught mathematical\nconcepts... A graphic representation of data\nabstracted from banks of every computer in the\nhuman system. Unthinkable complexity.\nLines of light ranged in the nonspace of the\nmind, clusters and constellations of data.\nLike city lights, receding...\n\n- Neuromancer, William Gibson (1984)"} 
            position={{x: 1, y: 90}} 
            callback={nextMessage} 
          /> 
          { messageIncrement > 0 && 
            <Terminal 
              animate={messageIncrement === 1}
              text={"In the metaverse, it's always night.\n\n- Snow Crash, Neal Stephenson (1992)"} 
              position={{x: 30, y: 60}} 
              callback={nextMessage} 
            />
          }
          { messageIncrement > 1 && 
            <Terminal 
              animate={messageIncrement === 2}
              text={"Cyberspace is not the internet.\nIt is a 256 bit coordinate system which may\nonly be interacted with via proof of work.\nThe thermodynamic protocol ensures that\nchanges to the system are verifiable and may\nbe enacted by anyone without a central\nauthority."} 
              position={{x: 1, y: 45}} 
              color={COLORS.LOGO_BLUE}
              callback={nextMessage} 
            />
          }
          { messageIncrement > 2 && 
            <Terminal 
              animate={messageIncrement === 3}
              text={"NOSTR is the underlying decentralized\nmessaging layer of cyberspace. Each NOSTR\nidentity can act as an avatar in cyberspace;\nits home coordinate is its hex pubkey."} 
              position={{x: 1, y: 25}} 
              color={COLORS.LIGHT_PURPLE}
            />
          }
          <EffectComposer>
            <Bloom mipmapBlur levels={9} intensity={20} luminanceThreshold={0.001} luminanceSmoothing={0} />
          </EffectComposer>
        </Canvas>
      </div>
    </div>
  )
}

export default CyberspaceInfo 

type TerminalProps = {
  animate: boolean
  text: string
  position: {
    x: number
    y: number
  }
  color?: string | number
  align?: "left" | "center" | "right"
  callback?: () => void
}

function Terminal({ animate, text, position, color, align, callback }: TerminalProps) {
  const cursorOnChar = '>'
  const cursorOffChar = '\u00A0'
  const cursorBlinkRate = 30
  const typingSpeed = 4 // Frames per character
  const displayedTextRef = useRef('')
  const [cursor, setCursor] = useState(cursorOnChar)
  const indexRef = useRef(0)
  const frameCountRef = useRef(0)
  const cursorFrameRef = useRef(0)
  const callbackCalledRef = useRef(false)
  const [, setForceUpdate] = React.useState({}) // State to force re-render

  useFrame(() => {
    // Handle typing
    if (animate) {
      frameCountRef.current += 1
      if (frameCountRef.current >= typingSpeed && indexRef.current < text.length) {
        displayedTextRef.current += text[indexRef.current]
        indexRef.current += 1
        frameCountRef.current = 0
        setForceUpdate({}) // Trigger re-render
      } else if (indexRef.current === text.length && !callbackCalledRef.current) {
        if (callback) {
          callback()
          callbackCalledRef.current = true
        }
      }

      // Handle cursor blinking
      cursorFrameRef.current += 1
      if (cursorFrameRef.current >= cursorBlinkRate) {
        setCursor(prev => prev === cursorOnChar ? cursorOffChar : cursorOnChar)
        cursorFrameRef.current = 0
      }
    } else {
      displayedTextRef.current = text
      setCursor(cursorOnChar)
    }
  })

  return (
    <CoordinateText
      position={position || { x: 50, y: 50 }}
      color={color || COLORS.ORANGE}
      text={`${displayedTextRef.current}${animate ? cursor : ''}`}
      align={align || "left"}
      anchorY={"top"}
      maxWidth={50}
    />
  )
}