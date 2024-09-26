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

  // after last message, rotate the group of terminals and bring in more help/info
  // to hopefully answer questions about cyberspace

  return (
    <div className="cyberspace-info">
      <div id="info">
        <Canvas style={style} onClick={nextMessage}>
          <ambientLight intensity={2.0} />
          <OrbitControls />
          <group>
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
                text={"NOSTR is the underlying decentralized\nmessaging layer of cyberspace. Each NOSTR\nidentity can act as an avatar in cyberspace;\nits home coordinate is its hex pubkey.\nOperators direct their avatar and ONOSENDAI\ngenerates NOSTR events containing proof of\nwork which are then signed and broadcast to\nupdate the state of cyberspace."} 
                position={{x: 30, y: 25}} 
                color={COLORS.LIGHT_PURPLE}
                callback={nextMessage} 
              />
            }
            { messageIncrement > 3 && 
              <Terminal 
                animate={messageIncrement === 4}
                text={"ONOSENDAI is the first implementation of the\ncyberspace protocol which was founded on the\nkey insight that proof of work is the only\nmechanism that can make a metaverse more than\na glorified video game. Nothing happens in\ncyberspace unless real energy is expended in\nthe real world. Nobody controls cyberspace\nbecause it is simply a protocol that derives\na state from NOSTR events broadcast across\nan ever-shifting mesh of global relays.\nThere is no authority or privilege in this\nmetaverse. All that matters is proof of work.\nActions in cyberspace are consequential.\nTerritory is finite. Act accordingly."} 
                position={{x: 1, y: 3}} 
                color={COLORS.LOGO_TEAL}
                callback={nextMessage} 
              />
            }
            { messageIncrement > 4 && 
              <Terminal 
                animate={messageIncrement === 5}
                text={"This is the fulfillment of the SF visionaries\nwho foresaw not a game but a new meaningful\nworld only accessible through technology. It\nis a digital world where the rules are\nenforced by the laws of physics. In my humble\nopinion, it is a world that is not meant to\ncompete with the real world, but to extend it,\nand by doing so, extend our freedoms and\ncapabilities as humans."} 
                position={{x: 30, y: -32}} 
                color={COLORS.RED}
                callback={nextMessage} 
              />
            }
            { messageIncrement > 5 && 
              <Terminal 
                animate={messageIncrement === 6}
                text={"Welcome to cyberspace!\n\n\n\narkinox\n\nblock 862903"} 
                position={{x: 1, y: -55}} 
                color={COLORS.GRID_CROSS}
                callback={nextMessage} 
              />
            }
            { messageIncrement > 6 && 
              <Terminal 
                animate={messageIncrement === 7}
                text={"INFO:\n"} 
                position={{x: 1, y: -76}} 
                color={COLORS.ORANGE}
                callback={nextMessage} 
              />
            }
            { messageIncrement > 7 && 
              <Terminal 
                onClick={() => window.open('https://straylight.cafe', '_blank')}
                animate={messageIncrement === 8}
                text={"> Official ONOSENDAI and futurism community:\n\nhttps://straylight.cafe     (click here)\n\nWe are abandoning the ONOSENDAI Telegram group\nin favor of a Ditto instance powered by NOSTR\nand hosted by arkinox. Come share your cyberspace\nexperiences and ask questions!"} 
                position={{x: 1, y: -85}} 
                color={COLORS.ORANGE}
                callback={nextMessage} 
              />
            }
            { messageIncrement > 8 && 
              <Terminal 
                animate={messageIncrement === 9}
                text={"> Official cyberspace protocol website:\n\nhttps://cyberspace.international\n\nProliferation, outreach, onboarding, and resources.\nComing soon."} 
                position={{x: 1, y: -105}} 
                color={COLORS.ORANGE}
                callback={nextMessage} 
              />
            }
          </group>
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
  onClick?: () => void
  callback?: () => void
}

function Terminal({ animate, text, position, color, align, onClick, callback }: TerminalProps) {
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
    <group onClick={onClick}>
      <CoordinateText
        position={position || { x: 50, y: 50 }}
        color={color || COLORS.ORANGE}
        text={`${displayedTextRef.current}${animate ? cursor : ''}`}
        align={align || "left"}
        anchorY={"top"}
        maxWidth={50}
      />
    </group>
  )
}