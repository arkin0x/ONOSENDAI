import { OrbitControls, Text } from "@react-three/drei"
import { useSpring, animated } from '@react-spring/three'
import { useCallback, useContext, useState } from "react"
import { UIState } from "../types/UI"
import { UIContext } from "../providers/UIProvider"
import CyberspaceViewer from "./Cyberspace/CyberspaceViewer"
import { useNavigate } from "react-router-dom"
import CyberspaceMap from "./Map/CyberspaceMap"
import "../scss/Interface.scss"
import "../scss/Dashboard.scss"
import CyberspaceGlobal from "./Global/CyberspaceGlobal"
import { Canvas, useThree } from "@react-three/fiber"
import { BufferGeometry, Camera, Float32BufferAttribute, LineBasicMaterial, MeshBasicMaterial, Shape, ShapeGeometry, Vector3 } from "three"
import COLORS from "../data/Colors"
import { Bloom, EffectComposer } from '@react-three/postprocessing'

export const Interface = () => {
  const navigate = useNavigate()

  const logOut = () => {
    navigate("/logout")
  }

  const { uiState, setUIState } = useContext(UIContext)

  const getInterface = useCallback(() => {
    switch (uiState) {
      case UIState.cyberspace:
        return <CyberspaceViewer />
      case UIState.map:
        return <CyberspaceMap />
      case UIState.global:
        return <CyberspaceGlobal />
      default:
        break
    }
  }, [uiState])

  return (
    <div id="interface">
      <div id="interface-body">{getInterface()}</div>
      <div id="interface-header">
        <Canvas style={{height: "10svh"}} camera={{ fov: 90, position: [0,0,20] }}>
          <OrbitControls enablePan={false} enableZoom={false} enableRotate={false} />
          <ambientLight intensity={2.0} />
          <group>
            <NavText text="LOCAL" position={{x: 20, y: 0}} align="center" color={0xcebe00} onClick={() => setUIState(UIState.cyberspace)}/>
            <NavText text="SECTOR" position={{x: 55, y: 0}} align="center" color={COLORS.ORANGE} onClick={() => setUIState(UIState.map)}/>
            <NavText text="GLOBAL" position={{x: 90, y: 0}} align="center" color={COLORS.RED} onClick={() => setUIState(UIState.global)}/>
            <NavText text="LOGOUT" position={{x: 125, y: 0}} align="center" color={COLORS.PURPLE} onClick={logOut}/>
          </group>
          <EffectComposer>
            <Bloom mipmapBlur levels={5} intensity={5} luminanceThreshold={-1} luminanceSmoothing={0} />
          </EffectComposer>
        </Canvas>
      </div>
    </div>
  )
}

type CoordinateTextProps = {
  position: {
    x: number, // percent of viewport width
    y: number // percent of viewport height
  }
  rotation?: [number, number, number],
  text: string,
  align?: "left" | "center" | "right"
  color?: string | number
  fontSize?: number
  onClick?: () => void
}

const NavText: React.FC<CoordinateTextProps> = (props: CoordinateTextProps) => {
  const { viewport } = useThree()
  const [hover, setHover] = useState(false)

  // const x = viewport.width * props.position.x
  // const y = viewport.height * props.position.y
  // Use spring for smooth animation
  const { x } = useSpring({
    x: (hover ? 2 : 0 ),
    config: { tension: 500, friction: 30 } // Adjust the animation config as needed
  })


  // Calculate position based on viewport dimensions
  const position = new Vector3(-viewport.width / 2 + props.position.x, -viewport.height / 2 + props.position.y + 32, 0)

  // Define vertices for the rhombus
  const w = 6
  const vertices = new Float32Array([
    -w, -1, 0, // left
    -w/2, 1, 0,  // top
    w, 1, 0,  // right
    w/2, -1, 0 // bottom
  ])

  // Create BufferGeometry and set the vertices
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))

  // Create LineBasicMaterial
  const material = new LineBasicMaterial({ color: props.color || COLORS.BITCOIN })

  // Create a Shape for the rhombus
  const shape = new Shape()
  shape.moveTo(-w, -1)
  shape.lineTo(-w/2, 1)
  shape.lineTo(w, 1)
  shape.lineTo(w/2, -1)
  shape.lineTo(-w, -1)

  // Create ShapeGeometry
  const shapeGeometry = new ShapeGeometry(shape)

  return (
    <animated.group 
      position-x={x} // Use the animated y value
    >
      {/* Clickable shape behind the text */}
      <mesh
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
        onClick={props.onClick}
        geometry={shapeGeometry}
        position={position.clone().add(new Vector3(0, 3, 0))} // Position the shape slightly behind the text
        scale={[3,3,3]}
        material={new MeshBasicMaterial({ color: 'transparent', opacity: 0, transparent: true })} // Make the shape invisible
      />
      {/* <Plane
        args={[20, 7]} // Adjust the size of the plane as needed
        position={position.clone().add(new Vector3(0, 3, 0))} // Position the plane slightly behind the text
        rotation={[0, 0, 0]}
        material={new MeshBasicMaterial({ color: 0xffffff, opacity: 1, transparent: true })} // Make the plane invisible
      /> */}
      <Text
        anchorX={props.align || 'center'}
        anchorY="bottom"
        color={ props.color || COLORS.BITCOIN}
        font={'/fonts/MonaspaceKrypton-ExtraLight.otf'}
        fontSize={ props.fontSize || 5}
        frustumCulled={true}
        letterSpacing={0.02}
        lineHeight={1}
        material-toneMapped={false}
        maxWidth={300}
        position={position}
        rotation={props.rotation || [0, 0, 0]}
        scale={[1, 1, 1]}
        textAlign="center"
      >
        {props.text}
      </Text>
      <lineLoop geometry={geometry} material={material} position={position.clone().add(new Vector3(0,3, 0))} scale={3} />
      
    </animated.group>
  )
}
