import { OrbitControls, Text } from "@react-three/drei"
import { useCallback, useState } from "react"
import { UIState } from "../types/UI"
import CyberspaceViewer from "./Cyberspace/CyberspaceViewer"
import { useNavigate } from "react-router-dom"
import CyberspaceMap from "./Map/CyberspaceMap"
import CyberspaceGlobal from "./Global/CyberspaceGlobal"
import { Canvas, useThree } from "@react-three/fiber"
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, MeshBasicMaterial, Shape, ShapeGeometry, Vector3 } from "three"
import COLORS from "../data/Colors"
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import CyberspaceBuild from "./Build/CyberspaceBuild"
import { useUIStore } from "../store/UIStore"
import SectorScanner from "./Cyberspace/SectorScanner"
import CyberspaceInfo from "./Info/CyberspaceInfo"

export function Interface(){
  const navigate = useNavigate()

  const logOut = () => {
    navigate("/logout")
  }

  const { uiState, setUIState } = useUIStore()

  const getInterface = useCallback(() => {
    switch (uiState) {
      case UIState.cyberspace:
        return <CyberspaceViewer />
      case UIState.map:
        return <CyberspaceMap />
      case UIState.global:
        return <CyberspaceGlobal />
      case UIState.build:
        return <CyberspaceBuild />
      case UIState.info:
        return <CyberspaceInfo />
      default:
        break
    }
  }, [uiState])

  return (
    <div id="interface">
      <SectorScanner />
      <div id="interface-body">{getInterface()}</div>
      <div id="interface-header">
        <Canvas style={{height: "10svh"}} camera={{ fov: 90, position: [0,0,20] }}>
          <OrbitControls enablePan={false} enableZoom={false} enableRotate={false} />
          <ambientLight intensity={2.0} />
          <group>
            <NavText key={'local'} text="LOCAL" position={{x: 20, y: 0}} align="center" color={0xcebe00} onClick={() => setUIState(UIState.cyberspace)} current={uiState === UIState.cyberspace}/>
            <NavText key={'sector'} text="SECTOR" position={{x: 55, y: 0 }} align="center" color={COLORS.ORANGE} onClick={() => setUIState(UIState.map)} current={uiState === UIState.map}/>
            <NavText key={'global'} text="GLOBAL" position={{x: 90, y: 0}} align="center" color={COLORS.RED} onClick={() => setUIState(UIState.global)} current={uiState === UIState.global}/>
            <NavText key={'build'} text="BUILD" position={{x: 125, y: 0}} align="center" color={COLORS.PINK} onClick={() => setUIState(UIState.build)} current={uiState === UIState.build}/>
            <NavText key={'info'} text="INFO" position={{x: 160, y: 0, z: 0}} align="center" color={COLORS.LOGO_BLUE} onClick={() => setUIState(UIState.info)} current={uiState === UIState.info}/>
            <NavText key={'logout'} text="LOGOUT" position={{x: 195, y: 0, z: 0}} align="center" color={COLORS.LOGOUT} onClick={logOut}/>
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
    x: number // percent of viewport width
    y: number // percent of viewport height
    z?: number
  }
  rotation?: [number, number, number],
  text: string,
  align?: "left" | "center" | "right"
  color?: string | number
  fontSize?: number
  onClick?: () => void
  current?: boolean
  customWidth?: number
}

export const NavText: React.FC<CoordinateTextProps> = (props: CoordinateTextProps) => {
  const { viewport } = useThree()
  const [hover, setHover] = useState(false)

  // Calculate position based on viewport dimensions
  const position = new Vector3(-viewport.width / 2 + props.position.x, -viewport.height / 2 + props.position.y + 32, 0)

  // Define vertices for the rhombus
  const w = 6
  const customWidth = props.customWidth || 0
  const vertices = new Float32Array([
    -w -customWidth, -1, 0, // left
    -w/2 -customWidth, 1, 0,  // top
    w + customWidth, 1, 0,  // right
    w/2 + customWidth, -1, 0 // bottom
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
    <group>
      {/* Clickable shape behind the text */}
      <mesh
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
        onClick={props.onClick}
        geometry={shapeGeometry}
        position={position.clone().add(new Vector3(0, 3, 0))} // Position the shape slightly behind the text
        scale={[3,3,3]}
        material={new MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: true })} // Make the shape invisible
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
      { hover || props.current ? <lineLoop geometry={geometry} material={material} position={position.clone().add(new Vector3(0,3, 0))} scale={3} /> : null }
      
    </group>
  )
}
